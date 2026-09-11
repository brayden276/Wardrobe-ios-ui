import { CommonModule } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Preferences } from '@capacitor/preferences';
import { IonicModule } from '@ionic/angular';
import { apiBaseUrl } from '../../api-url';
import { AuthService } from '../../auth.service';
import { DeviceImageCacheService } from '../../device-image-cache.service';
import { AuthResponse } from '../../models';
import { OfflineDataService } from '../../offline-data.service';
import { SettingsPage } from './settings.page';

describe('Settings password change', () => {
  let page: SettingsPage;
  let auth: AuthService;
  let http: HttpTestingController;
  let navigate: jasmine.Spy;
  const baseUrl = apiBaseUrl();
  const response: AuthResponse = {
    user: { id: 'user-1', email: 'user@example.com', displayName: 'User', provider: 'password', hasPassword: true },
    accessToken: 'access-token', refreshToken: 'refresh-token', tokenType: 'Bearer',
    expiresAt: new Date(Date.now() + 3600_000).toISOString()
  };
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  async function login(session = response): Promise<void> {
    const pending = auth.login('user@example.com', 'Original123!');
    http.expectOne(`${baseUrl}/api/auth/login`).flush(session);
    await pending;
  }

  function fillForm(): void {
    page.startChangingPassword();
    page.passwordForm = { currentPassword: 'Original123!', newPassword: 'Replacement123!', confirmPassword: 'Replacement123!' };
  }

  beforeEach(async () => {
    await Preferences.clear();
    TestBed.configureTestingModule({
      declarations: [SettingsPage],
      imports: [CommonModule, FormsModule, IonicModule.forRoot({ animated: false }), RouterTestingModule],
      providers: [
        SettingsPage, provideHttpClient(), provideHttpClientTesting(),
        { provide: OfflineDataService, useValue: { clearUser: () => Promise.resolve() } },
        { provide: DeviceImageCacheService, useValue: { clearCache: () => Promise.resolve() } }
      ]
    });
    page = TestBed.inject(SettingsPage);
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    await login();
  });

  afterEach(async () => {
    http.verify();
    await Preferences.clear();
  });

  it('changes the password, clears credentials and sensitive fields, then returns to sign-in', async () => {
    fillForm();
    const saving = page.savePassword();
    await page.savePassword();
    const request = http.expectOne(`${baseUrl}/api/auth/password`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-token');
    expect(request.request.body).toEqual({ currentPassword: 'Original123!', newPassword: 'Replacement123!' });
    request.flush({ status: 'updated', message: 'Your password was updated.' });
    await saving;
    expect(auth.session).toBeNull();
    expect((await Preferences.get({ key: 'wardrobe-session' })).value).toBeNull();
    expect(page.passwordForm).toEqual({ currentPassword: '', newPassword: '', confirmPassword: '' });
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(page.isBusy).toBeFalse();
  });

  it('validates current password, length and confirmation without making requests', async () => {
    fillForm();
    for (const [currentPassword, newPassword, confirmPassword] of [
      ['', 'Replacement123!', 'Replacement123!'],
      ['Original123!', 'short', 'short'],
      ['Original123!', 'x'.repeat(129), 'x'.repeat(129)],
      ['Original123!', 'Replacement123!', 'Mismatch123!']
    ]) {
      page.passwordForm = { currentPassword, newPassword, confirmPassword };
      await page.savePassword();
      expect(page.passwordMessage).not.toBe('');
    }
    http.expectNone(`${baseUrl}/api/auth/password`);
    expect(auth.session).not.toBeNull();
  });

  it('preserves the session after an incorrect current password and allows a retry', async () => {
    fillForm();
    const failed = page.savePassword();
    http.expectOne(`${baseUrl}/api/auth/password`).flush(null, { status: 401, statusText: 'Unauthorized' });
    await failed;
    expect(auth.session).not.toBeNull();
    expect(page.passwordMessage).toContain('current password');
    expect(page.isChangingPassword).toBeTrue();
    expect(navigate).not.toHaveBeenCalled();
    http.expectNone(`${baseUrl}/api/auth/refresh`);
    const retry = page.savePassword();
    http.expectOne(`${baseUrl}/api/auth/password`).flush({ status: 'updated', message: 'Updated' });
    await retry;
    expect(auth.session).toBeNull();
  });

  it('refreshes an expired session before submitting the current password', async () => {
    await login({ ...response, expiresAt: '2020-01-01T00:00:00Z' });
    fillForm();
    const saving = page.savePassword();
    http.expectNone(`${baseUrl}/api/auth/password`);
    http.expectOne(`${baseUrl}/api/auth/refresh`).flush({ ...response, accessToken: 'renewed-token' });
    await settle();
    const request = http.expectOne(`${baseUrl}/api/auth/password`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer renewed-token');
    request.flush({ status: 'updated', message: 'Updated' });
    await saving;
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('preserves the form and session when refreshing fails temporarily', async () => {
    await login({ ...response, expiresAt: '2020-01-01T00:00:00Z' });
    fillForm();
    const saving = page.savePassword();
    http.expectOne(`${baseUrl}/api/auth/refresh`).flush(null, { status: 503, statusText: 'Unavailable' });
    await saving;
    expect(page.passwordMessage).toContain('refresh');
    expect(page.isChangingPassword).toBeTrue();
    expect(auth.session).not.toBeNull();
    http.expectNone(`${baseUrl}/api/auth/password`);
  });

  it('clears password fields on cancellation and navigation away', () => {
    fillForm();
    page.cancelChangingPassword();
    expect(Object.values(page.passwordForm)).toEqual(['', '', '']);
    fillForm();
    page.ionViewDidLeave();
    expect(Object.values(page.passwordForm)).toEqual(['', '', '']);
    expect(page.isChangingPassword).toBeFalse();
  });

  it('supports linked password credentials and hides the form for external-only accounts', async () => {
    await login({ ...response, user: { ...response.user, provider: 'google', hasPassword: true } });
    expect(page.canChangePassword).toBeTrue();
    await login({ ...response, user: { ...response.user, provider: 'google', hasPassword: false } });
    expect(page.canChangePassword).toBeFalse();
    page.startChangingPassword();
    expect(page.isChangingPassword).toBeFalse();
  });

  it('renders accessible password fields from the account action', async () => {
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    const action = [...fixture.nativeElement.querySelectorAll('button')].find((button: any) => button.textContent.includes('Change Password')) as HTMLButtonElement;
    action.click();
    fixture.detectChanges();
    const fields = [...fixture.nativeElement.querySelectorAll('ion-input')] as HTMLIonInputElement[];
    expect(fields.map((field) => field.type)).toEqual(['password', 'password', 'password']);
    expect(fields.map((field) => field.autocomplete)).toEqual(['current-password', 'new-password', 'new-password']);
    expect(fields.map((field) => field.label)).toEqual(['Current password', 'New password', 'Confirm new password']);
    fixture.destroy();
  });
});
