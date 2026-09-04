import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth.service';
import { EMAIL_PATTERN, lightImpact, noticeKind, NoticeKind, readMessage, successFeedback, warningFeedback } from '../page-helpers';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss']
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  mode: 'login' | 'register' = 'login';
  email = '';
  password = '';
  displayName = '';
  message = '';
  isBusy = false;
  hasSubmitted = false;
  emailBlurred = false;
  displayNameBlurred = false;
  showPassword = false;

  async ionViewWillEnter(): Promise<void> {
    await this.auth.restore();
    if (this.auth.session) {
      await this.router.navigateByUrl(this.auth.hasCompletedPersonalDetails ? '/tabs/wardrobe' : '/onboarding');
    }
  }

  get emailValidationMessage(): string {
    if (!this.email.trim()) {
      return 'Email is required.';
    }

    if (!EMAIL_PATTERN.test(this.email.trim())) {
      return 'Enter a valid email address.';
    }

    return '';
  }

  get passwordValidationMessage(): string {
    if (!this.password) {
      return 'Password is required.';
    }

    return '';
  }

  get displayNameValidationMessage(): string {
    if (this.mode !== 'register') {
      return '';
    }

    if (!this.displayName.trim()) {
      return 'Name is required to create an account.';
    }

    return '';
  }

  get canSubmit(): boolean {
    return (
      !this.isBusy
      && !this.emailValidationMessage
      && !this.passwordValidationMessage
      && !this.displayNameValidationMessage
    );
  }

  get showEmailValidationMessage(): boolean {
    return this.hasSubmitted || (this.emailBlurred && !!this.email.trim());
  }

  get showPasswordValidationMessage(): boolean {
    return this.hasSubmitted || !!this.password;
  }

  get showDisplayNameValidationMessage(): boolean {
    return this.mode === 'register' && (this.hasSubmitted || !!this.displayName.trim() || this.displayNameBlurred);
  }

  get activeErrorMessage(): string {
    if (!this.hasSubmitted) {
      if (this.emailBlurred && this.email.trim() && this.emailValidationMessage) {
        return this.emailValidationMessage;
      }
      return '';
    }
    return this.displayNameValidationMessage || this.emailValidationMessage || this.passwordValidationMessage || '';
  }

  focusInput(inputRef: any): void {
    inputRef?.setFocus?.();
  }

  setAuthMode(mode: 'login' | 'register'): void {
    if (this.mode === mode) {
      return;
    }

    this.mode = mode;
    this.message = '';
    this.hasSubmitted = false;
    this.emailBlurred = false;
    this.displayNameBlurred = false;
    void lightImpact();
  }

  toggleShowPassword(): void {
    this.showPassword = !this.showPassword;
    void lightImpact();
  }

  toggleMode(): void {
    this.setAuthMode(this.mode === 'login' ? 'register' : 'login');
  }

  get authSubmitLabel(): string {
    return this.mode === 'login' ? 'Sign in' : 'Create account';
  }

  get authStatusMessage(): string {
    return this.mode === 'login' ? 'Signing in...' : 'Creating your account...';
  }

  get authModeHint(): string {
    return this.mode === 'login' ? 'Sign in to review your wardrobe.' : 'Create your account to get started.';
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  async submit(): Promise<void> {
    this.hasSubmitted = true;
    if (!this.canSubmit) {
      this.message = this.emailValidationMessage || this.passwordValidationMessage || this.displayNameValidationMessage || 'Please complete all required fields.';
      return;
    }

    const email = this.email.trim();

    this.isBusy = true;
    this.message = '';
    try {
      if (this.mode === 'login') {
        await this.auth.login(email, this.password);
      } else {
        await this.auth.register(email, this.password, this.displayName.trim());
      }
      void successFeedback();
      await this.router.navigateByUrl(this.auth.hasCompletedPersonalDetails ? '/tabs/wardrobe' : '/onboarding');
    } catch (error) {
      this.message = readMessage(error, 'Could not sign in. Try again.');
      void warningFeedback();
    } finally {
      this.isBusy = false;
    }
  }
}
