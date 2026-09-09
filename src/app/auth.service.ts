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
  private refreshPromise: Promise<boolean> | null = null;
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
    const token = this.token;
    if (!token) {
      throw new Error('Sign in before saving personal details.');
    }

    const user = await firstValueFrom(this.http.put<AuthUserDto>(`${this.apiBaseUrl}/api/auth/personal-details`, request, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` })
    }));

    const session = this.session;
    if (session) {
      await this.storeSession({ ...session, user });
    }

    return user;
  }

  async requestPasswordReset(email: string): Promise<StatusMessageDto> {
    return firstValueFrom(this.http.post<StatusMessageDto>(`${this.apiBaseUrl}/api/auth/password/forgot`, { email }));
  }

  async resetPassword(token: string, newPassword: string): Promise<StatusMessageDto> {
    return firstValueFrom(this.http.post<StatusMessageDto>(`${this.apiBaseUrl}/api/auth/password/reset`, { token, newPassword }));
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<StatusMessageDto> {
    const response = await firstValueFrom(this.http.put<StatusMessageDto>(`${this.apiBaseUrl}/api/auth/password`,
      { currentPassword, newPassword }, this.authOptions()));
    await this.clearLocalSession();
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
          await firstValueFrom(this.http.post(`${this.apiBaseUrl}/api/auth/logout`, { refreshToken: session.refreshToken }));
        } catch {
          // Best effort: local sign-out must succeed even if the server revoke call fails.
        }
      }
    } finally {
      if (session?.user.id) await this.offlineData.clearUser(session.user.id);
      await this.deviceImageCache.clearCache();
      await this.clearSession();
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
      if (userId) {
        await this.offlineData.clearUser(userId);
      }
      await this.deviceImageCache.clearCache();
      await this.clearSession();
    }
  }

  async handleUnauthorized(error: unknown): Promise<void> {
    if (this.isUnauthorized(error)) {
      await this.clearLocalSession();
    }
  }

  async refreshSession(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshCore().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async refreshCore(): Promise<boolean> {
    const refreshToken = this.session?.refreshToken;
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
      await this.setSession(response);
      return true;
    } catch (error) {
      if (this.isUnauthorized(error)) {
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

  private async clearLocalSession(): Promise<void> {
    const userId = this.session?.user.id;
    if (userId) await this.offlineData.clearUser(userId);
    await this.deviceImageCache.clearCache();
    await this.clearSession();
  }

  private isExpired(session: Session): boolean {
    const expiresAt = Date.parse(session.expiresAt);
    return Number.isNaN(expiresAt) || expiresAt <= Date.now() + 60_000;
  }

  private isUnauthorized(error: unknown): boolean {
    return (error as { status?: number }).status === 401;
  }

  private async clearSession(): Promise<void> {
    await Preferences.remove({ key: 'wardrobe-session' });
    // Only emit on a real transition: notifying when there was no session
    // would bounce the user to /login without anything having changed
    // (e.g. a 401 fired before restore() finished loading the stored session).
    if (this.sessionSubject.value !== null) {
      this.sessionSubject.next(null);
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
