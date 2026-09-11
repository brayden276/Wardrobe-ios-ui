import { CommonModule } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Preferences } from '@capacitor/preferences';
import { IonicModule } from '@ionic/angular';
import { apiBaseUrl } from '../../api-url';
import { AuthService } from '../../auth.service';
import { AuthResponse, UpdatePersonalDetailsRequest } from '../../models';
import { OnboardingPage } from './onboarding.page';

describe('Personal Style onboarding', () => {
  let page: OnboardingPage;
  let auth: AuthService;
  let http: HttpTestingController;
  let navigate: jasmine.Spy;
  const baseUrl = apiBaseUrl();
  const choices: UpdatePersonalDetailsRequest = { gender: 'female', fitPreference: 'relaxed', stylePreference: 'casual', dailyContext: 'weekend' };
  const session: AuthResponse = {
    user: { id: 'new-user', email: 'new@example.com', displayName: 'New User', personalDetails: null },
    accessToken: 'token', refreshToken: 'refresh-token', tokenType: 'Bearer', expiresAt: new Date(Date.now() + 3600_000).toISOString()
  };
  const completedUser = { ...session.user, personalDetails: { ...choices, completedAt: '2026-09-11T00:00:00Z' } };

  async function login(response = session): Promise<void> {
    const pending = auth.login('new@example.com', 'Password123!');
    http.expectOne(`${baseUrl}/api/auth/login`).flush(response);
    await pending;
  }

  async function answerQuestions(): Promise<void> {
    for (const step of page.steps) {
      page.choose(step.key, choices[step.key]);
      await page.advance();
    }
  }

  beforeEach(async () => {
    await Preferences.clear();
    TestBed.configureTestingModule({
      declarations: [OnboardingPage],
      imports: [CommonModule, IonicModule.forRoot(), RouterTestingModule],
      providers: [
        OnboardingPage, provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ returnUrl: '/tabs/settings' }) } } }
      ]
    });
    page = TestBed.inject(OnboardingPage);
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    await login();
    page.ionViewWillEnter();
  });

  afterEach(async () => {
    http.verify();
    await Preferences.clear();
  });

  it('reviews all answers before saving and sends first-time users to the guide', async () => {
    await answerQuestions();
    expect(page.isReviewing).toBeTrue();
    http.expectNone(`${baseUrl}/api/auth/personal-details`);
    expect(page.submitLabel).toBe('Save & Get Started');
    const saving = page.advance();
    const request = http.expectOne(`${baseUrl}/api/auth/personal-details`);
    expect(request.request.body).toEqual(choices);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token');
    request.flush(completedUser);
    await saving;
    expect(auth.hasCompletedPersonalDetails).toBeTrue();
    expect(navigate).toHaveBeenCalledWith('/tabs/getting-started');
    expect((await Preferences.get({ key: 'wardrobe-session' })).value).toContain('completedAt');
  });

  it('allows editing one answer from review without repeating the other questions', async () => {
    await answerQuestions();
    page.editAnswer(0);
    page.choose('gender', 'male');
    await page.advance();
    expect(page.isReviewing).toBeTrue();
    expect(page.answerLabel('gender')).toBe('Menswear');
    expect(page.values.fitPreference).toBe('relaxed');
    expect(navigate).not.toHaveBeenCalled();
    http.expectNone(`${baseUrl}/api/auth/personal-details`);
  });

  it('blocks missing or invalid answers and preserves choices when going back', async () => {
    page.choose('gender', 'invalid');
    await page.advance();
    expect(page.stepIndex).toBe(0);
    expect(page.canContinue).toBeFalse();
    page.choose('gender', 'female');
    await page.advance();
    page.handleBack();
    expect(page.selectedValue('gender')).toBe('female');
  });

  it('retains the review after a failed save and allows retry', async () => {
    await answerQuestions();
    const saving = page.advance();
    await page.advance();
    page.choose('gender', 'male');
    page.editAnswer(0);
    http.expectOne(`${baseUrl}/api/auth/personal-details`).flush({}, { status: 503, statusText: 'Unavailable' });
    await saving;
    expect(page.values.gender).toBe('female');
    expect(page.isReviewing).toBeTrue();
    expect(page.message).not.toBe('');
    expect(navigate).not.toHaveBeenCalled();
    const retry = page.advance();
    http.expectOne(`${baseUrl}/api/auth/personal-details`).flush(completedUser);
    await retry;
    expect(navigate).toHaveBeenCalledWith('/tabs/getting-started');
  });

  it('unlocks the review after a stalled save', fakeAsync(() => {
    page.values = { ...choices };
    page.isReviewing = true;
    void page.advance();
    const request = http.expectOne(`${baseUrl}/api/auth/personal-details`);
    tick(10_001);
    flushMicrotasks();
    expect(request.cancelled).toBeTrue();
    expect(page.isBusy).toBeFalse();
    expect(page.isReviewing).toBeTrue();
    expect(page.values).toEqual(choices);
  }));

  it('refreshes an expired sign-in before saving preferences', async () => {
    await login({ ...session, expiresAt: '2020-01-01T00:00:00Z' });
    page.values = { ...choices };
    page.isReviewing = true;
    const saving = page.advance();
    http.expectOne(`${baseUrl}/api/auth/refresh`).flush({ ...session, accessToken: 'renewed-token' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = http.expectOne(`${baseUrl}/api/auth/personal-details`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer renewed-token');
    request.flush(completedUser);
    await saving;
  });

  it('preserves the return destination for editing completed preferences and clears state for a different user', async () => {
    await login({ ...session, user: completedUser });
    page.ionViewWillEnter();
    expect(page.values).toEqual(choices);
    page.isReviewing = true;
    const saving = page.advance();
    http.expectOne(`${baseUrl}/api/auth/personal-details`).flush(completedUser);
    await saving;
    expect(navigate).toHaveBeenCalledWith('/tabs/settings');
    await login({ ...session, user: { ...session.user, id: 'another-user' } });
    page.ionViewWillEnter();
    expect(page.values).toEqual({});
    expect(page.isReviewing).toBeFalse();
  });

  it('renders native radio choices and a review with accessible edit buttons', async () => {
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(OnboardingPage);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    const radio: HTMLInputElement = fixture.nativeElement.querySelector('input[type="radio"]');
    radio.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.canContinue).toBeTrue();
    expect(radio.checked).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Next, we\'ll show you');
    fixture.componentInstance.values = { ...choices };
    fixture.componentInstance.isReviewing = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.review-row').length).toBe(4);
    expect(fixture.nativeElement.querySelector('.review-row button').getAttribute('aria-label')).toBe('Edit Wardrobe direction');
    fixture.destroy();
  });
});
