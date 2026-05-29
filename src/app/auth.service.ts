import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { apiBaseUrl } from './api-url';
import { AuthProviderDto, AuthResponse, AuthUserDto } from './models';

interface Session {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: string;
  user: AuthUserDto;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
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

  async restore(): Promise<void> {
    if (this.restorePromise) {
      return this.restorePromise;
    }

    this.restorePromise = this.restoreCore();
    return this.restorePromise;
  }

  private async restoreCore(): Promise<void> {
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

  async logout(): Promise<void> {
    await this.clearSession();
  }

  async deleteAccount(): Promise<void> {
    const token = this.token;
    if (!token) {
      await this.clearSession();
      return;
    }

    await firstValueFrom(this.http.delete(`${this.apiBaseUrl}/api/auth/account`, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` })
    }));
    await this.clearSession();
  }

  async handleUnauthorized(error: unknown): Promise<void> {
    if (this.isUnauthorized(error)) {
      await this.clearSession();
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
      const response = await firstValueFrom(this.http.post<AuthResponse>(`${this.apiBaseUrl}/api/auth/refresh`, { refreshToken }));
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

    const user = await firstValueFrom(this.http.get<AuthUserDto>(`${this.apiBaseUrl}/api/auth/me`, {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` })
    }));

    const session = this.session;
    if (!session) {
      return;
    }

    await this.storeSession({ ...session, user });
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
    this.sessionSubject.next(null);
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
