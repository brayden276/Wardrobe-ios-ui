import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { LoginPage } from './login.page';
import { AuthService } from '../../auth.service';

describe('LoginPage', () => {
  let component: LoginPage;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockActivatedRoute: any;

  beforeEach(() => {
    mockAuthService = jasmine.createSpyObj<AuthService>(
      'AuthService',
      ['login', 'register', 'restore'],
      { session: null, hasCompletedPersonalDetails: false }
    );
    mockAuthService.login.and.returnValue(Promise.resolve());
    mockAuthService.register.and.returnValue(Promise.resolve());
    mockAuthService.restore.and.returnValue(Promise.resolve());

    mockRouter = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    mockRouter.navigateByUrl.and.returnValue(Promise.resolve(true));

    mockActivatedRoute = {
      snapshot: {
        queryParamMap: {
          get: (key: string) => null
        }
      }
    };

    TestBed.configureTestingModule({
      providers: [
        LoginPage,
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ]
    });

    component = TestBed.inject(LoginPage);
  });

  it('should create the component with default login mode', () => {
    expect(component).toBeTruthy();
    expect(component.mode).toBe('login');
    expect(component.email).toBe('');
    expect(component.password).toBe('');
    expect(component.displayName).toBe('');
    expect(component.isBusy).toBeFalse();
    expect(component.hasSubmitted).toBeFalse();
  });

  describe('Form Validation Rules', () => {
    describe('emailValidationMessage', () => {
      it('should return error when email is empty or whitespace', () => {
        component.email = '';
        expect(component.emailValidationMessage).toBe('Email is required.');

        component.email = '   ';
        expect(component.emailValidationMessage).toBe('Email is required.');
      });

      it('should return error when email format is invalid', () => {
        component.email = 'plainaddress';
        expect(component.emailValidationMessage).toBe('Enter a valid email address.');

        component.email = 'test@domain';
        expect(component.emailValidationMessage).toBe('Enter a valid email address.');

        component.email = '@domain.com';
        expect(component.emailValidationMessage).toBe('Enter a valid email address.');
      });

      it('should return empty string when email is valid', () => {
        component.email = 'user@example.com';
        expect(component.emailValidationMessage).toBe('');

        component.email = '  valid.email@sub.domain.org  ';
        expect(component.emailValidationMessage).toBe('');
      });
    });

    describe('passwordValidationMessage', () => {
      it('should return error when password is empty', () => {
        component.password = '';
        expect(component.passwordValidationMessage).toBe('Password is required.');
      });

      it('should return empty string when password is provided', () => {
        component.password = 'Secret123!';
        expect(component.passwordValidationMessage).toBe('');
      });
    });

    describe('displayNameValidationMessage', () => {
      it('should return empty string in login mode even if displayName is empty', () => {
        component.mode = 'login';
        component.displayName = '';
        expect(component.displayNameValidationMessage).toBe('');
      });

      it('should return error in register mode when displayName is empty or whitespace', () => {
        component.mode = 'register';
        component.displayName = '';
        expect(component.displayNameValidationMessage).toBe('Name is required to create an account.');

        component.displayName = '   ';
        expect(component.displayNameValidationMessage).toBe('Name is required to create an account.');
      });

      it('should return empty string in register mode when displayName is provided', () => {
        component.mode = 'register';
        component.displayName = 'Jane Doe';
        expect(component.displayNameValidationMessage).toBe('');
      });
    });

    describe('canSubmit', () => {
      it('should return false in login mode when email or password is invalid', () => {
        component.mode = 'login';
        component.email = '';
        component.password = 'Secret123';
        expect(component.canSubmit).toBeFalse();

        component.email = 'invalid-email';
        component.password = 'Secret123';
        expect(component.canSubmit).toBeFalse();

        component.email = 'user@example.com';
        component.password = '';
        expect(component.canSubmit).toBeFalse();
      });

      it('should return true in login mode when email and password are valid', () => {
        component.mode = 'login';
        component.email = 'user@example.com';
        component.password = 'Secret123';
        expect(component.canSubmit).toBeTrue();
      });

      it('should return false in register mode when displayName is missing', () => {
        component.mode = 'register';
        component.email = 'user@example.com';
        component.password = 'Secret123';
        component.displayName = '';
        expect(component.canSubmit).toBeFalse();
      });

      it('should return true in register mode when all fields are valid', () => {
        component.mode = 'register';
        component.email = 'user@example.com';
        component.password = 'Secret123';
        component.displayName = 'Jane Doe';
        expect(component.canSubmit).toBeTrue();
      });

      it('should return false when isBusy is true regardless of field validity', () => {
        component.mode = 'login';
        component.email = 'user@example.com';
        component.password = 'Secret123';
        component.isBusy = true;
        expect(component.canSubmit).toBeFalse();
      });
    });

    describe('showValidation getters', () => {
      it('should show email validation message when submitted or email is blurred and non-empty', () => {
        component.hasSubmitted = false;
        (component as any).emailBlurred = false;
        component.email = '';
        expect(component.showEmailValidationMessage).toBeFalse();

        component.email = 'user@';
        expect(component.showEmailValidationMessage).toBeFalse();

        (component as any).emailBlurred = true;
        expect(component.showEmailValidationMessage).toBeTrue();

        component.email = '';
        (component as any).emailBlurred = false;
        component.hasSubmitted = true;
        expect(component.showEmailValidationMessage).toBeTrue();
      });

      it('should show password validation message when submitted or password is non-empty', () => {
        component.hasSubmitted = false;
        component.password = '';
        expect(component.showPasswordValidationMessage).toBeFalse();

        component.password = 'p';
        expect(component.showPasswordValidationMessage).toBeTrue();

        component.password = '';
        component.hasSubmitted = true;
        expect(component.showPasswordValidationMessage).toBeTrue();
      });

      it('should show displayName validation message only in register mode when submitted or non-empty', () => {
        component.mode = 'login';
        component.hasSubmitted = true;
        component.displayName = 'Test';
        expect(component.showDisplayNameValidationMessage).toBeFalse();

        component.mode = 'register';
        component.hasSubmitted = false;
        component.displayName = '';
        expect(component.showDisplayNameValidationMessage).toBeFalse();

        component.displayName = 'Test';
        expect(component.showDisplayNameValidationMessage).toBeTrue();

        component.displayName = '';
        component.hasSubmitted = true;
        expect(component.showDisplayNameValidationMessage).toBeTrue();
      });
    });
  });

  describe('Mode Toggle and UI labels', () => {
    it('setAuthMode() should change mode, reset messages and submitted flag', () => {
      component.mode = 'login';
      component.message = 'An error occurred';
      component.hasSubmitted = true;

      component.setAuthMode('register');

      expect(component.mode).toBe('register');
      expect(component.message).toBe('');
      expect(component.hasSubmitted).toBeFalse();
    });

    it('setAuthMode() should do nothing when setting current mode', () => {
      component.mode = 'login';
      component.message = 'Existing message';

      component.setAuthMode('login');

      expect(component.mode).toBe('login');
      expect(component.message).toBe('Existing message');
    });

    it('toggleMode() should toggle between login and register', () => {
      expect(component.mode).toBe('login');

      component.toggleMode();
      expect(component.mode).toBe('register');

      component.toggleMode();
      expect(component.mode).toBe('login');
    });

    it('should return corresponding labels and hints based on mode', () => {
      component.mode = 'login';
      expect(component.authSubmitLabel).toBe('Sign in');
      expect(component.authStatusMessage).toBe('Signing in...');
      expect(component.authModeHint).toBe('Sign in to review your wardrobe.');

      component.mode = 'register';
      expect(component.authSubmitLabel).toBe('Create account');
      expect(component.authStatusMessage).toBe('Creating your account...');
      expect(component.authModeHint).toBe('Create your account to get started.');
    });

    it('messageKind should return noticeKind for current message', () => {
      component.message = 'Invalid email or password.';
      expect(component.messageKind).toBe('error');

      component.message = 'Saved successfully.';
      expect(component.messageKind).toBe('success');
    });
  });

  describe('submit()', () => {
    it('should set validation message and not call AuthService when form is invalid', async () => {
      component.mode = 'login';
      component.email = 'invalid-email';
      component.password = '';

      await component.submit();

      expect(component.hasSubmitted).toBeTrue();
      expect(component.message).toBe('Enter a valid email address.');
      expect(mockAuthService.login).not.toHaveBeenCalled();
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });

    it('should call AuthService.login and navigate to /onboarding on success when personal details not completed', async () => {
      component.mode = 'login';
      component.email = 'user@example.com';
      component.password = 'Password123!';

      await component.submit();

      expect(component.hasSubmitted).toBeTrue();
      expect(mockAuthService.login).toHaveBeenCalledWith('user@example.com', 'Password123!');
      expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/onboarding');
      expect(component.isBusy).toBeFalse();
    });

    it('should call AuthService.login and navigate to /tabs/wardrobe on success when personal details completed', async () => {
      Object.defineProperty(mockAuthService, 'hasCompletedPersonalDetails', {
        get: () => true,
        configurable: true
      });

      component.mode = 'login';
      component.email = 'user@example.com';
      component.password = 'Password123!';

      await component.submit();

      expect(mockAuthService.login).toHaveBeenCalledWith('user@example.com', 'Password123!');
      expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tabs/wardrobe');
      expect(component.isBusy).toBeFalse();
    });

    it('should call AuthService.register in register mode with displayName trimmed', async () => {
      component.mode = 'register';
      component.email = 'newuser@example.com';
      component.password = 'Password123!';
      component.displayName = '  Alex Smith  ';

      await component.submit();

      expect(mockAuthService.register).toHaveBeenCalledWith('newuser@example.com', 'Password123!', 'Alex Smith');
      expect(mockRouter.navigateByUrl).toHaveBeenCalled();
      expect(component.isBusy).toBeFalse();
    });

    it('should display error message and not navigate when login fails', async () => {
      mockAuthService.login.and.returnValue(
        Promise.reject({ error: { message: 'Invalid credentials.' } })
      );

      component.mode = 'login';
      component.email = 'user@example.com';
      component.password = 'WrongPassword';

      await component.submit();

      expect(component.message).toBe('Invalid credentials.');
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
      expect(component.isBusy).toBeFalse();
    });
  });

  describe('ionViewWillEnter', () => {
    it('should not navigate when no active session exists', async () => {
      Object.defineProperty(mockAuthService, 'session', { value: null, configurable: true });

      await component.ionViewWillEnter();

      expect(mockAuthService.restore).toHaveBeenCalled();
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });

    it('should redirect to /tabs/wardrobe when session exists and personal details are completed', async () => {
      const mockSession = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        user: { id: '1', email: 'user@example.com', displayName: 'User', personalDetails: null }
      };
      Object.defineProperty(mockAuthService, 'session', { value: mockSession, configurable: true });
      Object.defineProperty(mockAuthService, 'hasCompletedPersonalDetails', { value: true, configurable: true });

      await component.ionViewWillEnter();

      expect(mockAuthService.restore).toHaveBeenCalled();
      expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tabs/wardrobe');
    });

    it('should redirect to /onboarding when session exists and personal details are not completed', async () => {
      const mockSession = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        user: { id: '1', email: 'user@example.com', displayName: 'User', personalDetails: null }
      };
      Object.defineProperty(mockAuthService, 'session', { value: mockSession, configurable: true });
      Object.defineProperty(mockAuthService, 'hasCompletedPersonalDetails', { value: false, configurable: true });

      await component.ionViewWillEnter();

      expect(mockAuthService.restore).toHaveBeenCalled();
      expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/onboarding');
    });
  });
});
