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
  readonly session$ = this.sessionSubject.asObservable();

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

    const stored = await Preferences.get({ key: 'wardrobe-session' });
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

    if (!session.accessToken || !session.refreshToken || !session.user) {
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
        if (this.isUnauthorized(validationError)) {
          await this.clearSession();
        }
      }
    }
  }

  async getProviders(): Promise<AuthProviderDto[]> {
    return firstValueFrom(this.http.get<AuthProviderDto[]>(`${this.apiBaseUrl}/api/auth/providers`));
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    const response = await firstValueFrom(this.http.post<AuthResponse>(`${this.apiBaseUrl}/api/auth/register`, { email, password, displayName }));
    await this.setSession(response);
  }

  async login(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(this.http.post<AuthResponse>(`${this.apiBaseUrl}/api/auth/login`, { email, password }));
    await this.setSession(response);
  }

  async loginExternal(provider: string, identityToken: string): Promise<void> {
    const response = await firstValueFrom(this.http.post<AuthResponse>(`${this.apiBaseUrl}/api/auth/external`, { provider, identityToken }));
    await this.setSession(response);
  }

  async updatePersonalDetails(request: UpdatePersonalDetailsRequest): Promise<AuthUserDto> {
    if (this.session && this.isExpired(this.session) && !await this.refreshSession()) {
      throw new Error('Could not refresh your session. Sign in again or retry when connected.');
    }
    const requestSession = this.session;
    if (!requestSession?.accessToken) {
      throw new Error('Sign in before saving personal details.');
    }

    const user = await firstValueFrom(this.http.put<AuthUserDto>(`${this.apiBaseUrl}/api/auth/personal-details`, request, {
      headers: new HttpHeaders({ Authorization: `Bearer ${requestSession.accessToken}` })
    }).pipe(timeout(AuthService.authRequestTimeoutMs)));

    const session = this.session;
    if (!session || session.refreshToken !== requestSession.refreshToken) {
      throw new Error('Your session changed. Please try again.');
    }
    await this.storeSession({ ...session, user });

    return user;
  }

  async requestPasswordReset(email: string): Promise<StatusMessageDto> {
    return firstValueFrom(this.http.post<StatusMessageDto>(`${this.apiBaseUrl}/api/auth/password/forgot`, { email }));
  }

  async resetPassword(token: string, newPassword: string): Promise<StatusMessageDto> {
    return firstValueFrom(this.http.post<StatusMessageDto>(`${this.apiBaseUrl}/api/auth/password/reset`, { token, newPassword }));
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<StatusMessageDto> {
    if (!this.session) throw new Error('Sign in before changing your password.');
    if (this.isExpired(this.session) && !await this.refreshSession()) {
      throw new Error('Could not refresh your session. Sign in again or retry when connected.');
    }
    const requestSession = this.session;
    if (!requestSession) throw new Error('Sign in before changing your password.');
    const response = await firstValueFrom(this.http.put<StatusMessageDto>(`${this.apiBaseUrl}/api/auth/password`,
      { currentPassword, newPassword }, this.authOptions()).pipe(timeout(AuthService.authRequestTimeoutMs)));
    if (this.session?.refreshToken !== requestSession.refreshToken) {
      throw new Error('Your session changed. Please try again.');
    }
    await this.clearLocalSession(requestSession.user.id, requestSession.refreshToken);
    if (this.session) throw new Error('Your session changed. Please try again.');
    return response;
  }

  async updateProfile(request: UpdateProfileRequest): Promise<AuthUserDto> {
    const user = await firstValueFrom(this.http.put<AuthUserDto>(`${this.apiBaseUrl}/api/auth/profile`, request, this.authOptions()));
    const session = this.session;
    if (session) await this.storeSession({ ...session, user });
    return user;
  }

  async logout(): Promise<void> {
    const session = this.session;
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
      await this.clearLocalSession(session?.user.id);
    }
  }

  async deleteAccount(): Promise<void> {
    const userId = this.session?.user.id;
    const token = this.token;
    try {
      if (token) {
        await firstValueFrom(this.http.delete(`${this.apiBaseUrl}/api/auth/account`, {
          headers: new HttpHeaders({ Authorization: `Bearer ${token}` })
        }));
      }
    } finally {
      await this.clearLocalSession(userId);
    }
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
      if (this.session?.refreshToken !== refreshToken) {
        return false;
      }
      await this.setSession(response);
      return true;
    } catch (error) {
      if (this.isUnauthorized(error) && this.session?.refreshToken === refreshToken) {
        await this.clearSession();
      }

      return false;
    }
  }

  private async validateSession(): Promise<void> {
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
    if (!session) {
      return;
    }

    await this.storeSession({ ...session, user });
  }

  private authOptions(): { headers: HttpHeaders } {
    const token = this.token;
    return { headers: token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders() };
  }

  private async clearLocalSession(userId = this.session?.user.id, expectedRefreshToken?: string): Promise<void> {
    const isCurrentSession = () => expectedRefreshToken === undefined || this.session?.refreshToken === expectedRefreshToken;
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
    try {
      await Preferences.remove({ key: 'wardrobe-session' });
    } finally {
      // Only emit on a real transition: notifying when there was no session
      // would bounce the user to /login without anything having changed
      // (e.g. a 401 fired before restore() finished loading the stored session).
      if (this.sessionSubject.value !== null) {
        this.sessionSubject.next(null);
      }
    }
  }

  private async setSession(response: AuthResponse): Promise<void> {
    const session = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      tokenType: response.tokenType,
      expiresAt: response.expiresAt,
      user: response.user
    };
    await this.storeSession(session);
  }

  private async storeSession(session: Session): Promise<void> {
    await Preferences.set({ key: 'wardrobe-session', value: JSON.stringify(session) });
    this.sessionSubject.next(session);
  }
}
