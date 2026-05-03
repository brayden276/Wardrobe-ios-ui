import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthResponse, AuthUserDto } from './models';

interface Session {
  accessToken: string;
  user: AuthUserDto;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  private restorePromise: Promise<void> | null = null;
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

    try {
      this.sessionSubject.next(JSON.parse(stored.value) as Session);
    } catch {
      await Preferences.remove({ key: 'wardrobe-session' });
      this.sessionSubject.next(null);
    }
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    const response = await firstValueFrom(this.http.post<AuthResponse>(`${environment.apiBaseUrl}/api/auth/register`, { email, password, displayName }));
    await this.setSession(response);
  }

  async login(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(this.http.post<AuthResponse>(`${environment.apiBaseUrl}/api/auth/login`, { email, password }));
    await this.setSession(response);
  }

  async logout(): Promise<void> {
    await Preferences.remove({ key: 'wardrobe-session' });
    this.sessionSubject.next(null);
  }

  private async setSession(response: AuthResponse): Promise<void> {
    const session = { accessToken: response.accessToken, user: response.user };
    await Preferences.set({ key: 'wardrobe-session', value: JSON.stringify(session) });
    this.sessionSubject.next(session);
  }
}
