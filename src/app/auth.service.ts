import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, firstValueFrom, timeout } from 'rxjs';
import { apiBaseUrl } from './api-url';
import { DeviceImageCacheService } from './device-image-cache.service';
import { AuthProviderDto, AuthResponse, AuthUserDto, StatusMessageDto, UpdatePersonalDetailsRequest, UpdateProfileRequest } from './models';
import { OfflineDataService } from './offline-data.service';

interface Session {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: string;
  user: AuthUserDto;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private static readonly authRequestTimeoutMs = 10_000;
  private readonly http = inject(HttpClient);
  private readonly deviceImageCache = inject(DeviceImageCacheService);
  private readonly offlineData = inject(OfflineDataService);
  private readonly apiBaseUrl = apiBaseUrl();
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  private restorePromise: Promise<void> | null = null;
  private refreshRequest: { token: string | null; promise: Promise<boolean> } | null = null;
  private sessionGeneration = 0;
  private sessionStorageQueue: Promise<void> = Promise.resolve();
  readonly session$ = this.sessionSubject.asObservable();

  get sessionVersion(): number {
    return this.sessionGeneration;
  }

  get session(): Session | null {
    return this.sessionSubject.value;
  }

  get token(): string | null {
    return this.session?.accessToken ?? null;
  }

  get hasCompletedPersonalDetails(): boolean {
    return !!this.session?.user?.personalDetails;
  }

  async restore(): Promise<void> {
    if (this.restorePromise) {
      return this.restorePromise;
    }

    // Restore storage once. Re-reading it on navigation can race token rotation
    // and replace the current session with credentials that have been revoked.
    this.restorePromise = this.restoreCore().catch((error) => {
      this.restorePromise = null;
      throw error;
    });
    return this.restorePromise;
  }

  private async restoreCore(): Promise<void> {
    if (this.session) {
      return;
    }

    const generation = this.sessionGeneration;
    const stored = await Preferences.get({ key: 'wardrobe-session' });
    if (generation !== this.sessionGeneration || this.session) return;
    if (!stored.value) {
      return;
    }

    let session: Session;
    try {
      session = JSON.parse(stored.value) as Session;
    } catch {
      await this.clearSession();
      return;
    }

    if (!session?.accessToken || !session.refreshToken || !session.user?.id) {
      await this.clearSession();
      return;
    }

    this.sessionSubject.next(session);
    if (this.isExpired(session)) {
      await this.refreshSession();
      return;
    }

    try {
      await this.validateSession();
      return;
    } catch (error) {
      if (generation !== this.sessionGeneration) return;
      if (!this.isUnauthorized(error)) {
        return;
      }

      const refreshed = await this.refreshSession();
      if (!refreshed) {
        return;
      }

      try {
        await this.validateSession();
      } catch (validationError) {
        if (generation === this.sessionGeneration && this.isUnauthorized(validationError)) {
          await this.clearSession();
        }
      }
    }
  }

  async getProviders(): Promise<AuthProviderDto[]> {
    return firstValueFrom(this.http.get<AuthProviderDto[]>(`${this.apiBaseUrl}/api/auth/providers`).pipe(timeout(AuthService.authRequestTimeoutMs)));
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    const generation = ++this.sessionGeneration;
    const response = await firstValueFrom(this.http.post<AuthResponse>(`${this.apiBaseUrl}/api/auth/register`, { email, password, displayName }).pipe(timeout(AuthService.authRequestTimeoutMs)));
    await this.setSession(response, generation, true);
  }

  async login(email: string, password: string): Promise<void> {
    const generation = ++this.sessionGeneration;
    const response = await firstValueFrom(this.http.post<AuthResponse>(`${this.apiBaseUrl}/api/auth/login`, { email, password }).pipe(timeout(AuthService.authRequestTimeoutMs)));
    await this.setSession(response, generation, true);
  }

  async loginExternal(provider: string, identityToken: string): Promise<void> {
    const generation = ++this.sessionGeneration;
    const response = await firstValueFrom(this.http.post<AuthResponse>(`${this.apiBaseUrl}/api/auth/external`, { provider, identityToken }).pipe(timeout(AuthService.authRequestTimeoutMs)));
    await this.setSession(response, generation, true);
  }

  async updatePersonalDetails(request: UpdatePersonalDetailsRequest): Promise<AuthUserDto> {
    return this.updateUser('/api/auth/personal-details', request);
  }

  private async updateUser(path: string, request: UpdatePersonalDetailsRequest | UpdateProfileRequest): Promise<AuthUserDto> {
    const generation = this.sessionGeneration;
    if (this.session && this.isExpired(this.session) && !await this.refreshSession()) {
      throw new Error('Could not refresh your session. Sign in again or retry when connected.');
    }
    const requestSession = this.session;
    if (generation !== this.sessionGeneration || !requestSession?.accessToken) {
      throw new Error('Sign in before saving personal details.');
    }

    const user = await firstValueFrom(this.http.put<AuthUserDto>(`${this.apiBaseUrl}${path}`, request, {
      headers: new HttpHeaders({ Authorization: `Bearer ${requestSession.accessToken}` })
    }).pipe(timeout(AuthService.authRequestTimeoutMs)));

    const session = this.session;
    if (!session || generation !== this.sessionGeneration) {
      throw new Error('Your session changed. Please try again.');
    }
    await this.storeUser(user, generation);

    return user;
  }

  async requestPasswordReset(email: string): Promise<StatusMessageDto> {
    return firstValueFrom(this.http.post<StatusMessageDto>(`${this.apiBaseUrl}/api/auth/password/forgot`, { email }).pipe(timeout(AuthService.authRequestTimeoutMs)));
  }

  async resetPassword(token: string, newPassword: string): Promise<StatusMessageDto> {
    return firstValueFrom(this.http.post<StatusMessageDto>(`${this.apiBaseUrl}/api/auth/password/reset`, { token, newPassword }).pipe(timeout(AuthService.authRequestTimeoutMs)));
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<StatusMessageDto> {
    const generation = this.sessionGeneration;
    if (!this.session) throw new Error('Sign in before changing your password.');
    if (this.isExpired(this.session) && !await this.refreshSession()) {
      throw new Error('Could not refresh your session. Sign in again or retry when connected.');
    }
    if (generation !== this.sessionGeneration) throw new Error('Your session changed. Please try again.');
    const requestSession = this.session;
    if (!requestSession) throw new Error('Sign in before changing your password.');
    const response = await firstValueFrom(this.http.put<StatusMessageDto>(`${this.apiBaseUrl}/api/auth/password`,
      { currentPassword, newPassword }, this.authOptions()).pipe(timeout(AuthService.authRequestTimeoutMs)));
    if (generation !== this.sessionGeneration) {
      throw new Error('Your session changed. Please try again.');
    }
    await this.clearLocalSession(requestSession.user.id, generation);
    if (this.session) throw new Error('Your session changed. Please try again.');
    return response;
  }

  async updateProfile(request: UpdateProfileRequest): Promise<AuthUserDto> {
    return this.updateUser('/api/auth/profile', request);
  }

  async logout(): Promise<void> {
    const session = this.session;
    const generation = this.sessionGeneration;
    try {
      if (session?.refreshToken && typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          await firstValueFrom(this.http.post(`${this.apiBaseUrl}/api/auth/logout`, { refreshToken: session.refreshToken })
            .pipe(timeout(AuthService.authRequestTimeoutMs)));
        } catch {
          // Best effort: local sign-out must succeed even if the server revoke call fails.
        }
      }
    } finally {
      await this.clearLocalSession(session?.user.id, generation);
    }
    if (this.session) throw new Error('Your session changed. Please try again.');
  }

  async deleteAccount(): Promise<void> {
    const generation = this.sessionGeneration;
    if (this.session && this.isExpired(this.session) && !await this.refreshSession()) {
      throw new Error('Could not refresh your session. Sign in again or retry when connected.');
    }
    if (generation !== this.sessionGeneration) throw new Error('Your session changed. Please try again.');
    const session = this.session;
    if (session) {
      await firstValueFrom(this.http.delete(`${this.apiBaseUrl}/api/auth/account`, {
        headers: new HttpHeaders({ Authorization: `Bearer ${session.accessToken}` })
      }).pipe(timeout(30_000)));
    }
    // A failed deletion must leave the account usable and the error visible.
    await this.clearLocalSession(session?.user.id, generation);
    if (this.session) throw new Error('Your session changed. Please try again.');
  }

  async handleUnauthorized(error: unknown): Promise<void> {
    if (this.isUnauthorized(error)) {
      await this.clearLocalSession();
    }
  }

  async refreshSession(): Promise<boolean> {
    const refreshToken = this.session?.refreshToken ?? null;
    if (this.refreshRequest?.token === refreshToken) {
      return this.refreshRequest.promise;
    }

    const promise = this.refreshCore(refreshToken).finally(() => {
      if (this.refreshRequest?.promise === promise) {
        this.refreshRequest = null;
      }
    });
    this.refreshRequest = { token: refreshToken, promise };
    return promise;
  }

  private async refreshCore(refreshToken: string | null): Promise<boolean> {
    const generation = this.sessionGeneration;
    if (!refreshToken) {
      await this.clearSession();
      return false;
    }

    try {
      const response = await firstValueFrom(
        this.http
          .post<AuthResponse>(`${this.apiBaseUrl}/api/auth/refresh`, { refreshToken })
          .pipe(timeout(AuthService.authRequestTimeoutMs))
      );
      // The request belongs to the session that started it. A late response
      // must not undo sign-out or replace credentials from a newer sign-in.
      if (generation !== this.sessionGeneration || this.session?.refreshToken !== refreshToken) {
        return false;
      }
      await this.setSession(response, generation);
      return true;
    } catch (error) {
      if (this.isUnauthorized(error) && generation === this.sessionGeneration && this.session?.refreshToken === refreshToken) {
        await this.clearSession();
      }

      return false;
    }
  }

  private async validateSession(): Promise<void> {
    const generation = this.sessionGeneration;
    const token = this.token;
    if (!token) {
      await this.clearSession();
      return;
    }

    const user = await firstValueFrom(
      this.http
        .get<AuthUserDto>(`${this.apiBaseUrl}/api/auth/me`, {
          headers: new HttpHeaders({ Authorization: `Bearer ${token}` })
        })
        .pipe(timeout(AuthService.authRequestTimeoutMs))
    );

    const session = this.session;
    if (!session || generation !== this.sessionGeneration) {
      return;
    }

    await this.storeUser(user, generation);
  }

  private authOptions(): { headers: HttpHeaders } {
    const token = this.token;
    return { headers: token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders() };
  }

  private async clearLocalSession(userId = this.session?.user.id, generation = this.sessionGeneration): Promise<void> {
    const isCurrentSession = () => generation === this.sessionGeneration;
    if (!isCurrentSession()) return;
    try {
      if (userId) await this.offlineData.clearUser(userId);
    } finally {
      try {
        if (isCurrentSession()) await this.deviceImageCache.clearCache();
      } finally {
        if (isCurrentSession()) await this.clearSession();
      }
    }
  }

  private isExpired(session: Session): boolean {
    const expiresAt = Date.parse(session.expiresAt);
    return Number.isNaN(expiresAt) || expiresAt <= Date.now() + 60_000;
  }

  private isUnauthorized(error: unknown): boolean {
    return (error as { status?: number }).status === 401;
  }

  private async clearSession(): Promise<void> {
    const generation = ++this.sessionGeneration;
    try {
      await this.queueSessionStorage(() => Preferences.remove({ key: 'wardrobe-session' }));
    } finally {
      // Only emit on a real transition: notifying when there was no session
      // would bounce the user to /login without anything having changed
      // (e.g. a 401 fired before restore() finished loading the stored session).
      if (generation === this.sessionGeneration && this.sessionSubject.value !== null) {
        this.sessionSubject.next(null);
      }
    }
  }

  private async setSession(response: AuthResponse, generation = this.sessionGeneration, startsSession = false): Promise<void> {
    const session = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      tokenType: response.tokenType,
      expiresAt: response.expiresAt,
      user: response.user
    };
    await this.queueSessionStorage(() => this.persistSession(session, generation, startsSession));
  }

  private async storeUser(user: AuthUserDto, generation: number): Promise<void> {
    await this.queueSessionStorage(async () => {
      const session = this.session;
      if (!session || session.user.id !== user.id) throw new Error('Your session changed. Please try again.');
      // Read the credentials after earlier queued token rotations have finished.
      await this.persistSession({ ...session, user }, generation);
    });
  }

  private async persistSession(session: Session, generation: number, startsSession = false): Promise<void> {
    if (generation !== this.sessionGeneration) throw new Error('Your session changed. Please try again.');
    await Preferences.set({ key: 'wardrobe-session', value: JSON.stringify(session) });
    if (generation !== this.sessionGeneration) {
      // This write finished after its session was superseded. Remove it before
      // the next queued write so a restart cannot restore rejected credentials.
      await Preferences.remove({ key: 'wardrobe-session' });
      throw new Error('Your session changed. Please try again.');
    }
    if (startsSession) this.sessionGeneration++;
    this.sessionSubject.next(session);
  }

  private queueSessionStorage(operation: () => Promise<void>): Promise<void> {
    const pending = this.sessionStorageQueue.then(operation);
    // Preserve ordering after a failed storage operation, while reporting it to its caller.
    this.sessionStorageQueue = pending.catch(() => {});
    return pending;
  }
}
