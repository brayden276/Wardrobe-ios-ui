import { fakeAsync, flushMicrotasks, TestBed, tick as advanceTime } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Preferences } from '@capacitor/preferences';
import { AuthService } from './auth.service';
import { DeviceImageCacheService } from './device-image-cache.service';
import { OfflineDataService } from './offline-data.service';
import { apiBaseUrl } from './api-url';
import { AuthResponse, AuthUserDto, UpdatePersonalDetailsRequest } from './models';

describe('AuthService', () => {
  let service: AuthService;
  let httpTesting: HttpTestingController;
  const baseUrl = apiBaseUrl();
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const mockUser: AuthUserDto = {
    id: 'user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    personalDetails: null
  };

  const mockAuthResponse: AuthResponse = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    tokenType: 'Bearer',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    user: mockUser
  };

  beforeEach(async () => {
    await Preferences.clear();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    service = TestBed.inject(AuthService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(async () => {
    httpTesting.verify();
    await Preferences.clear();
  });

  it('should be created with initial null session', () => {
    expect(service).toBeTruthy();
    expect(service.session).toBeNull();
    expect(service.token).toBeNull();
    expect(service.hasCompletedPersonalDetails).toBeFalse();
  });

  describe('Session getters and observables', () => {
    it('should reflect completed personal details when user has personal details', async () => {
      const userWithDetails: AuthUserDto = {
        ...mockUser,
        personalDetails: {
          gender: 'female',
          fitPreference: 'balanced',
          stylePreference: 'classic',
          dailyContext: 'work',
          completedAt: new Date().toISOString()
        }
      };

      const loginPromise = service.login('test@example.com', 'Password123!');
      const req = httpTesting.expectOne(`${baseUrl}/api/auth/login`);
      req.flush({ ...mockAuthResponse, user: userWithDetails });
      await loginPromise;

      expect(service.hasCompletedPersonalDetails).toBeTrue();
      expect(service.token).toBe('test-access-token');
      expect(service.session?.user.displayName).toBe('Test User');
    });

    it('should emit session changes via session$', async () => {
      const emissions: (typeof service.session)[] = [];
      const sub = service.session$.subscribe((session) => emissions.push(session));

      const loginPromise = service.login('test@example.com', 'Password123!');
      const req = httpTesting.expectOne(`${baseUrl}/api/auth/login`);
      req.flush(mockAuthResponse);
      await loginPromise;

      const logoutPromise = service.logout();
      const logoutReq = httpTesting.expectOne(`${baseUrl}/api/auth/logout`);
      expect(logoutReq.request.method).toBe('POST');
      logoutReq.flush({});
      await logoutPromise;
      sub.unsubscribe();

      expect(emissions.length).toBe(3);
      expect(emissions[0]).toBeNull();
      expect(emissions[1]?.accessToken).toBe('test-access-token');
      expect(emissions[2]).toBeNull();
    });
  });

  describe('restore()', () => {
    it('restores once across repeated page visits without replacing a renewed session', async () => {
      await Preferences.set({ key: 'wardrobe-session', value: JSON.stringify(mockAuthResponse) });
      const restore = service.restore();
      await tick();
      httpTesting.expectOne(`${baseUrl}/api/auth/me`).flush(mockUser);
      await restore;

      const refresh = service.refreshSession();
      // Navigation while renewal is in flight must not reload stored credentials.
      await service.restore();
      httpTesting.expectNone(`${baseUrl}/api/auth/me`);
      httpTesting.expectOne(`${baseUrl}/api/auth/refresh`).flush({
        ...mockAuthResponse, accessToken: 'renewed-access', refreshToken: 'renewed-refresh'
      });
      await refresh;
      await service.restore();
      expect(service.token).toBe('renewed-access');
      httpTesting.expectNone(`${baseUrl}/api/auth/me`);
    });

    it('does not revalidate an already signed-in session on first restore', async () => {
      const login = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await login;
      await service.restore();
      expect(service.token).toBe(mockAuthResponse.accessToken);
      httpTesting.expectNone(`${baseUrl}/api/auth/me`);
    });

    it('should do nothing if no session is stored in Preferences', async () => {
      await service.restore();

      expect(service.session).toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });

    it('should clear session if stored session has invalid JSON', async () => {
      await Preferences.set({ key: 'wardrobe-session', value: 'invalid-json{' });

      await service.restore();

      expect(service.session).toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });

    it('should clear session if stored session is missing required fields', async () => {
      const invalidSession = JSON.stringify({ accessToken: 'token-only' });
      await Preferences.set({ key: 'wardrobe-session', value: invalidSession });

      await service.restore();

      expect(service.session).toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });

    it('should refresh session when stored session is expired', async () => {
      const expiredSession = {
        accessToken: 'expired-access-token',
        refreshToken: 'valid-refresh-token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() - 10_000).toISOString(),
        user: mockUser
      };
      await Preferences.set({ key: 'wardrobe-session', value: JSON.stringify(expiredSession) });

      const restorePromise = service.restore();
      await tick();

      const refreshReq = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
      expect(refreshReq.request.body).toEqual({ refreshToken: 'valid-refresh-token' });
      refreshReq.flush(mockAuthResponse);

      await restorePromise;

      expect(service.token).toBe('test-access-token');
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toContain('test-access-token');
    });

    it('should validate session with /api/auth/me when stored session is valid and not expired', async () => {
      const validSession = {
        ...mockAuthResponse,
        expiresAt: new Date(Date.now() + 3600_000).toISOString()
      };
      await Preferences.set({ key: 'wardrobe-session', value: JSON.stringify(validSession) });

      const restorePromise = service.restore();
      await tick();

      const meReq = httpTesting.expectOne(`${baseUrl}/api/auth/me`);
      expect(meReq.request.headers.get('Authorization')).toBe('Bearer test-access-token');
      const updatedUser: AuthUserDto = { ...mockUser, displayName: 'Updated Name' };
      meReq.flush(updatedUser);

      await restorePromise;

      expect(service.session?.user.displayName).toBe('Updated Name');
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toContain('Updated Name');
    });

    it('should refresh session when validateSession returns 401', async () => {
      const validSession = {
        ...mockAuthResponse,
        expiresAt: new Date(Date.now() + 3600_000).toISOString()
      };
      await Preferences.set({ key: 'wardrobe-session', value: JSON.stringify(validSession) });

      const restorePromise = service.restore();
      await tick();

      const meReq = httpTesting.expectOne(`${baseUrl}/api/auth/me`);
      meReq.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      await tick();

      const refreshReq = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
      refreshReq.flush({
        ...mockAuthResponse,
        accessToken: 'new-refreshed-token'
      });

      await tick();

      const meReq2 = httpTesting.expectOne(`${baseUrl}/api/auth/me`);
      expect(meReq2.request.headers.get('Authorization')).toBe('Bearer new-refreshed-token');
      meReq2.flush(mockUser);

      await restorePromise;

      expect(service.token).toBe('new-refreshed-token');
    });

    it('should clear session if re-validation after refresh also returns 401', async () => {
      const validSession = {
        ...mockAuthResponse,
        expiresAt: new Date(Date.now() + 3600_000).toISOString()
      };
      await Preferences.set({ key: 'wardrobe-session', value: JSON.stringify(validSession) });

      const restorePromise = service.restore();
      await tick();

      const meReq = httpTesting.expectOne(`${baseUrl}/api/auth/me`);
      meReq.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      await tick();

      const refreshReq = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
      refreshReq.flush(mockAuthResponse);

      await tick();

      const meReq2 = httpTesting.expectOne(`${baseUrl}/api/auth/me`);
      meReq2.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

      await restorePromise;

      expect(service.session).toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });

    it('should deduplicate concurrent restore() calls', async () => {
      const validSession = {
        ...mockAuthResponse,
        expiresAt: new Date(Date.now() + 3600_000).toISOString()
      };
      await Preferences.set({ key: 'wardrobe-session', value: JSON.stringify(validSession) });

      const p1 = service.restore();
      const p2 = service.restore();
      await tick();

      const req = httpTesting.expectOne(`${baseUrl}/api/auth/me`);
      req.flush(mockUser);

      await Promise.all([p1, p2]);
      expect(service.session?.user.displayName).toBe('Test User');
      httpTesting.expectNone(`${baseUrl}/api/auth/me`);
    });
  });

  describe('Authentication API methods', () => {
    it('getProviders() should call /api/auth/providers', async () => {
      const mockProviders = [{ provider: 'google', enabled: true, clientId: 'google-client-id' }];

      const promise = service.getProviders();
      const req = httpTesting.expectOne(`${baseUrl}/api/auth/providers`);
      expect(req.request.method).toBe('GET');
      req.flush(mockProviders);

      const result = await promise;
      expect(result).toEqual(mockProviders);
    });

    it('login() should send credentials, store session in Preferences, and update state', async () => {
      const loginPromise = service.login('user@test.com', 'Secret123');

      const req = httpTesting.expectOne(`${baseUrl}/api/auth/login`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'user@test.com', password: 'Secret123' });
      req.flush(mockAuthResponse);

      await loginPromise;

      expect(service.token).toBe('test-access-token');
      expect(service.session?.user.email).toBe('test@example.com');

      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).not.toBeNull();
      const parsed = JSON.parse(stored.value!);
      expect(parsed.accessToken).toBe('test-access-token');
      expect(parsed.user.id).toBe('user-123');
    });

    it('register() should send registration details, store session in Preferences, and update state', async () => {
      const registerPromise = service.register('new@test.com', 'Secret123', 'New User');

      const req = httpTesting.expectOne(`${baseUrl}/api/auth/register`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'new@test.com', password: 'Secret123', displayName: 'New User' });
      req.flush({
        ...mockAuthResponse,
        user: { ...mockUser, email: 'new@test.com', displayName: 'New User' }
      });

      await registerPromise;

      expect(service.token).toBe('test-access-token');
      expect(service.session?.user.displayName).toBe('New User');

      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toContain('New User');
    });

    it('loginExternal() should send provider and identity token, and store session', async () => {
      const externalPromise = service.loginExternal('apple', 'apple-token-xyz');

      const req = httpTesting.expectOne(`${baseUrl}/api/auth/external`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ provider: 'apple', identityToken: 'apple-token-xyz' });
      req.flush(mockAuthResponse);

      await externalPromise;

      expect(service.token).toBe('test-access-token');

      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toContain('test-access-token');
    });

    it('updatePersonalDetails() should throw error if not authenticated', async () => {
      const request: UpdatePersonalDetailsRequest = {
        gender: 'male',
        fitPreference: 'tailored',
        stylePreference: 'minimal',
        dailyContext: 'work'
      };

      await expectAsync(service.updatePersonalDetails(request)).toBeRejectedWithError('Sign in before saving personal details.');
    });

    it('updatePersonalDetails() should send PUT request with token and update session in Preferences', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      const request: UpdatePersonalDetailsRequest = {
        gender: 'female',
        fitPreference: 'relaxed',
        stylePreference: 'creative',
        dailyContext: 'weekend'
      };

      const updatedUser: AuthUserDto = {
        ...mockUser,
        personalDetails: {
          ...request,
          completedAt: new Date().toISOString()
        }
      };

      const updatePromise = service.updatePersonalDetails(request);
      const req = httpTesting.expectOne(`${baseUrl}/api/auth/personal-details`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-access-token');
      expect(req.request.body).toEqual(request);
      req.flush(updatedUser);

      const result = await updatePromise;

      expect(result).toEqual(updatedUser);
      expect(service.session?.user.personalDetails?.gender).toBe('female');

      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toContain('"gender":"female"');
    });

    it('logout() should remove session from Preferences and reset state', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      expect(service.token).toBe('test-access-token');

      const logoutPromise = service.logout();
      const logoutReq = httpTesting.expectOne(`${baseUrl}/api/auth/logout`);
      expect(logoutReq.request.method).toBe('POST');
      logoutReq.flush({});
      await logoutPromise;

      expect(service.session).toBeNull();
      expect(service.token).toBeNull();

      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });

    it('deleteAccount() should clear session immediately if no token is present', async () => {
      await service.deleteAccount();

      expect(service.session).toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });

    it('deleteAccount() should call DELETE /api/auth/account with Bearer token and clear session', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      const deletePromise = service.deleteAccount();
      const req = httpTesting.expectOne(`${baseUrl}/api/auth/account`);
      expect(req.request.method).toBe('DELETE');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-access-token');
      req.flush(null);

      await deletePromise;

      expect(service.session).toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });
  });

  describe('Sign-out failures', () => {
    for (const failedCache of ['offline', 'images']) {
      it(`should clear credentials and attempt both caches when ${failedCache} cleanup fails`, async () => {
        const loginPromise = service.login('test@example.com', 'Pass123');
        httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
        await loginPromise;

        const failure = new Error('Cache cleanup failed');
        const offlineCleanup = spyOn(TestBed.inject(OfflineDataService), 'clearUser').and.resolveTo();
        const imageCleanup = spyOn(TestBed.inject(DeviceImageCacheService), 'clearCache').and.resolveTo();
        (failedCache === 'offline' ? offlineCleanup : imageCleanup).and.rejectWith(failure);

        const logoutPromise = service.logout();
        httpTesting.expectOne(`${baseUrl}/api/auth/logout`).flush({});
        await expectAsync(logoutPromise).toBeRejectedWith(failure);

        expect(service.session).toBeNull();
        expect((await Preferences.get({ key: 'wardrobe-session' })).value).toBeNull();
        expect(offlineCleanup).toHaveBeenCalledOnceWith(mockUser.id);
        expect(imageCleanup).toHaveBeenCalledTimes(1);
      });
    }

    it('should clear in-memory credentials and attempt cache cleanup when credential removal fails', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      const failure = new Error('Credential removal failed');
      const remove = spyOn(Storage.prototype, 'removeItem').and.throwError(failure);
      const offlineCleanup = spyOn(TestBed.inject(OfflineDataService), 'clearUser').and.resolveTo();
      const imageCleanup = spyOn(TestBed.inject(DeviceImageCacheService), 'clearCache').and.resolveTo();

      await expectAsync(service.handleUnauthorized({ status: 401 })).toBeRejectedWith(failure);
      remove.and.callThrough();

      expect(service.token).toBeNull();
      expect(offlineCleanup).toHaveBeenCalledOnceWith(mockUser.id);
      expect(imageCleanup).toHaveBeenCalledTimes(1);
    });

    it('should finish local sign-out when server revocation times out', fakeAsync(() => {
      void service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      flushMicrotasks();

      let completed = false;
      void service.logout().then(() => { completed = true; });
      const request = httpTesting.expectOne(`${baseUrl}/api/auth/logout`);
      advanceTime(10_001);
      flushMicrotasks();

      expect(request.cancelled).toBeTrue();
      expect(completed).toBeTrue();
      expect(service.token).toBeNull();
    }));
  });

  describe('refreshSession() and 401 handling', () => {
    it('should ignore a refresh response received after sign-out', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      const refreshPromise = service.refreshSession();
      const refreshRequest = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
      const logoutPromise = service.logout();
      httpTesting.expectOne(`${baseUrl}/api/auth/logout`).flush({});
      await logoutPromise;

      refreshRequest.flush(mockAuthResponse);
      expect(await refreshPromise).toBeFalse();
      expect(service.session).toBeNull();
      expect((await Preferences.get({ key: 'wardrobe-session' })).value).toBeNull();
    });

    for (const outcome of ['success', 'unauthorized']) {
      it(`should preserve a newer sign-in when an earlier refresh returns ${outcome}`, async () => {
        const loginPromise = service.login('test@example.com', 'Pass123');
        httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
        await loginPromise;

        const refreshPromise = service.refreshSession();
        const refreshRequest = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
        const nextSession: AuthResponse = {
          ...mockAuthResponse,
          accessToken: 'next-access-token',
          refreshToken: 'next-refresh-token',
          user: { ...mockUser, id: 'next-user' }
        };
        const nextLogin = service.login('next@example.com', 'Pass456');
        httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(nextSession);
        await nextLogin;

        if (outcome === 'success') {
          refreshRequest.flush(mockAuthResponse);
        } else {
          refreshRequest.flush({}, { status: 401, statusText: 'Unauthorized' });
        }

        expect(await refreshPromise).toBeFalse();
        expect(service.session).toEqual(nextSession);
        expect(JSON.parse((await Preferences.get({ key: 'wardrobe-session' })).value!)).toEqual(nextSession);
      });
    }

    it('should deduplicate refreshes only within the current session', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;
      const oldRefresh = service.refreshSession();
      const oldRequest = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);

      const nextSession = { ...mockAuthResponse, refreshToken: 'next-refresh-token' };
      const nextLogin = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(nextSession);
      await nextLogin;
      const nextRefresh = service.refreshSession();
      const nextRequest = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
      expect(nextRequest.request.body).toEqual({ refreshToken: 'next-refresh-token' });

      oldRequest.flush({}, { status: 401, statusText: 'Unauthorized' });
      expect(await oldRefresh).toBeFalse();
      const duplicateRefresh = service.refreshSession();
      httpTesting.expectNone(`${baseUrl}/api/auth/refresh`);
      nextRequest.flush({ ...nextSession, accessToken: 'refreshed-next-token', refreshToken: 'rotated-next-token' });

      expect(await nextRefresh).toBeTrue();
      expect(await duplicateRefresh).toBeTrue();
      expect(service.token).toBe('refreshed-next-token');
      expect((await Preferences.get({ key: 'wardrobe-session' })).value).toContain('rotated-next-token');
    });

    it('refreshSession() should return false and clear session when no refresh token is stored', async () => {
      const refreshed = await service.refreshSession();

      expect(refreshed).toBeFalse();
      expect(service.session).toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });

    it('refreshSession() should refresh token, update session, and return true', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      const newResponse: AuthResponse = {
        ...mockAuthResponse,
        accessToken: 'new-token-456',
        refreshToken: 'new-refresh-789'
      };

      const refreshPromise = service.refreshSession();
      const req = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refreshToken: 'test-refresh-token' });
      req.flush(newResponse);

      const refreshed = await refreshPromise;

      expect(refreshed).toBeTrue();
      expect(service.token).toBe('new-token-456');

      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toContain('new-token-456');
    });

    it('refreshSession() should deduplicate concurrent refresh calls', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      const p1 = service.refreshSession();
      const p2 = service.refreshSession();

      const req = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
      req.flush(mockAuthResponse);

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1).toBeTrue();
      expect(res2).toBeTrue();
      httpTesting.expectNone(`${baseUrl}/api/auth/refresh`);
    });

    it('refreshSession() should clear session and return false when refresh endpoint returns 401', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      const refreshPromise = service.refreshSession();
      const req = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
      req.flush({ message: 'Invalid refresh token' }, { status: 401, statusText: 'Unauthorized' });

      const refreshed = await refreshPromise;

      expect(refreshed).toBeFalse();
      expect(service.session).toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });

    it('refreshSession() should return false without clearing session on non-401 error', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      const refreshPromise = service.refreshSession();
      const req = httpTesting.expectOne(`${baseUrl}/api/auth/refresh`);
      req.flush({ message: 'Internal Server Error' }, { status: 500, statusText: 'Server Error' });

      const refreshed = await refreshPromise;

      expect(refreshed).toBeFalse();
      expect(service.session).not.toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).not.toBeNull();
    });

    it('handleUnauthorized() should clear session when error status is 401', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      await service.handleUnauthorized({ status: 401 });

      expect(service.session).toBeNull();
      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).toBeNull();
    });

    it('handleUnauthorized() should not emit when there is no session to clear', async () => {
      const emissions: (typeof service.session)[] = [];
      const sub = service.session$.subscribe((session) => emissions.push(session));

      await service.handleUnauthorized({ status: 401 });
      sub.unsubscribe();

      expect(service.session).toBeNull();
      expect(emissions).toEqual([null]);
    });

    it('handleUnauthorized() should not clear session when error status is not 401', async () => {
      const loginPromise = service.login('test@example.com', 'Pass123');
      httpTesting.expectOne(`${baseUrl}/api/auth/login`).flush(mockAuthResponse);
      await loginPromise;

      await service.handleUnauthorized({ status: 500 });
      expect(service.session).not.toBeNull();

      await service.handleUnauthorized(new Error('Network failure'));
      expect(service.session).not.toBeNull();

      const stored = await Preferences.get({ key: 'wardrobe-session' });
      expect(stored.value).not.toBeNull();
    });
  });
});
