import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { AuthService } from '../../auth.service';
import { DeviceImageCacheService } from '../../device-image-cache.service';
import { AiUsageCostSummaryDto, UpdatePersonalDetailsRequest, UserPersonalDetailsDto } from '../../models';
import { WardrobeApiService } from '../../wardrobe-api.service';
import {
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_OF_USE_URL,
  clearAiConsent,
  confirmAction,
  ensureAiConsentWithAlert,
  hasAiConsent,
  lightImpact,
  noticeKind,
  NoticeKind,
  readMessage,
  successFeedback,
  warningFeedback
} from '../page-helpers';

@Component({
  selector: 'app-settings',
  standalone: false,
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss']
})
export class SettingsPage {
  readonly auth = inject(AuthService);
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly deviceImageCache = inject(DeviceImageCacheService);
  readonly privacyPolicyUrl = PRIVACY_POLICY_URL;
  readonly termsUrl = TERMS_OF_USE_URL;
  readonly supportUrl = SUPPORT_URL;
  private readonly personalDetailLabels: Record<string, Record<string, string>> = {
    gender: {
      male: 'Menswear',
      female: 'Womenswear'
    },
    fitPreference: {
      tailored: 'Tailored',
      balanced: 'Balanced',
      relaxed: 'Relaxed'
    },
    stylePreference: {
      minimal: 'Minimal',
      classic: 'Classic',
      polished: 'Polished',
      casual: 'Casual',
      creative: 'Creative'
    },
    dailyContext: {
      work: 'Work',
      weekend: 'Weekend',
      evening: 'Evening',
      active: 'Active'
    }
  };
  aiConsentAccepted = false;
  aiUsage: AiUsageCostSummaryDto | null = null;
  aiUsageLoadMessage = '';
  isLoadingAiUsage = false;
  busyAction: 'details' | 'password' | 'signout' | 'delete' | 'cache' | 'consent' | null = null;
  get isBusy(): boolean {
    return this.busyAction !== null;
  }
  busyMessage = '';
  message = '';
  isEditingPersonalDetails = false;
  isChangingPassword = false;
  passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
  passwordMessage = '';

  get canChangePassword(): boolean {
    const user = this.auth.session?.user;
    return user?.hasPassword ?? user?.provider === 'password';
  }

  startChangingPassword(): void {
    if (this.isBusy || !this.canChangePassword) return;
    this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
    this.passwordMessage = '';
    this.isChangingPassword = true;
  }

  cancelChangingPassword(): void {
    if (this.isBusy) return;
    this.clearPasswordForm();
  }

  ionViewDidLeave(): void {
    this.clearPasswordForm();
  }

  private clearPasswordForm(): void {
    this.passwordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
    this.passwordMessage = '';
    this.isChangingPassword = false;
  }

  async savePassword(): Promise<void> {
    if (this.isBusy || !this.canChangePassword) return;
    const { currentPassword, newPassword, confirmPassword } = this.passwordForm;
    if (!currentPassword || newPassword.length < 8 || newPassword.length > 128) {
      this.passwordMessage = 'Enter your current password and a new password of 8–128 characters.';
      return;
    }
    if (newPassword !== confirmPassword) {
      this.passwordMessage = 'New passwords do not match.';
      return;
    }

    this.busyAction = 'password';
    this.busyMessage = 'Changing password...';
    this.passwordMessage = '';
    try {
      await this.auth.changePassword(currentPassword, newPassword);
      this.clearPasswordForm();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.passwordMessage = (error as { status?: number })?.status === 401
        ? 'Your current password could not be verified. Check it and try again.'
        : readMessage(error, 'Could not change your password. Please try again.');
    } finally {
      this.busyAction = null;
      this.busyMessage = '';
    }
  }
  personalDetailsForm: UpdatePersonalDetailsRequest = {
    gender: 'female',
    fitPreference: 'balanced',
    stylePreference: 'classic',
    dailyContext: 'weekend'
  };

  async ionViewWillEnter(): Promise<void> {
    this.aiConsentAccepted = await hasAiConsent();
    this.message = '';
    await this.loadAiUsage();
  }

  goBack(): void {
    this.router.navigateByUrl('/tabs/analytics');
  }

  async loadAiUsage(): Promise<void> {
    this.aiUsageLoadMessage = '';
    this.isLoadingAiUsage = true;
    try {
      this.aiUsage = await this.api.getAiUsageCostSummary();
    } catch {
      this.aiUsage = null;
      this.aiUsageLoadMessage = 'Could not load AI processing activity right now.';
    } finally {
      this.isLoadingAiUsage = false;
    }
  }

  get sessionExpiresAtLabel(): string {
    const expiresAt = this.auth.session?.expiresAt;
    if (!expiresAt) {
      return '';
    }

    const parsed = Date.parse(expiresAt);
    if (Number.isNaN(parsed)) {
      return '';
    }

    return `on ${new Date(parsed).toLocaleString()}`;
  }

  get aiUsageTotalLabel(): string {
    const value = this.aiUsage?.totalCostUsd ?? 0;
    return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  get personalDetails(): UserPersonalDetailsDto | null {
    return this.auth.session?.user?.personalDetails ?? null;
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  personalDetailLabel(group: string, value: string): string {
    return this.personalDetailLabels[group]?.[value] ?? value;
  }

  startEditingPersonalDetails(): void {
    const details = this.personalDetails;
    if (details) {
      this.personalDetailsForm = {
        gender: details.gender,
        fitPreference: details.fitPreference,
        stylePreference: details.stylePreference,
        dailyContext: details.dailyContext
      };
    }
    this.isEditingPersonalDetails = true;
    this.message = '';
    void lightImpact();
  }

  cancelEditingPersonalDetails(): void {
    this.isEditingPersonalDetails = false;
  }

  async savePersonalDetails(): Promise<void> {
    this.busyAction = 'details';
    this.busyMessage = 'Saving personal details...';
    try {
      await this.auth.updatePersonalDetails(this.personalDetailsForm);
      this.isEditingPersonalDetails = false;
      this.message = 'Personal details saved.';
      void successFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not save personal details.');
      void warningFeedback();
    } finally {
      this.busyAction = null;
      this.busyMessage = '';
    }
  }

  async logout(): Promise<void> {
    if (this.isBusy) {
      return;
    }

    const confirmed = await confirmAction(this.alertController, {
      title: 'Sign out?',
      message: 'Are you sure you want to sign out?',
      confirmLabel: 'Sign out'
    });
    if (!confirmed) {
      return;
    }

    this.busyAction = 'signout';
    this.busyMessage = 'Signing out...';
    this.message = '';
    try {
      await this.auth.logout();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.message = readMessage(error, 'Could not sign out. Check your connection and try again.');
      void warningFeedback();
    } finally {
      this.busyAction = null;
      this.busyMessage = '';
    }
  }

  async clearImageCache(): Promise<void> {
    if (this.isBusy) {
      return;
    }

    this.busyAction = 'cache';
    this.busyMessage = 'Clearing image cache...';
    this.message = '';
    try {
      await this.deviceImageCache.clearCache();
      void successFeedback();
      const toast = await this.toastController.create({
        message: 'Local image cache cleared.',
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
      this.message = 'Local image cache cleared.';
    } catch (error) {
      this.message = readMessage(error, 'Could not clear image cache.');
      void warningFeedback();
    } finally {
      this.busyAction = null;
      this.busyMessage = '';
    }
  }

  async resetAiConsent(): Promise<void> {
    if (!this.aiConsentAccepted) {
      return;
    }

    const confirmed = await confirmAction(this.alertController, {
      title: 'Require consent again?',
      message: 'This device will ask before sending wardrobe photos or outfit requests to Google Gemini again.',
      confirmLabel: 'Require consent'
    });
    if (!confirmed) {
      return;
    }

    this.busyAction = 'consent';
    this.busyMessage = 'Clearing Gemini consent...';
    this.message = '';
    try {
      await clearAiConsent();
      this.aiConsentAccepted = false;
      this.message = 'Gemini consent was cleared for this device.';
      void successFeedback();
    } finally {
      this.busyAction = null;
      this.busyMessage = '';
    }
  }

  async grantAiConsent(): Promise<void> {
    if (this.isBusy) {
      return;
    }

    const granted = await ensureAiConsentWithAlert(this.alertController, 'Settings');
    if (granted) {
      this.aiConsentAccepted = true;
      this.message = 'Gemini consent was granted.';
      void successFeedback();
    }
  }

  async deleteAccount(): Promise<void> {
    if (this.isBusy) {
      return;
    }

    const confirmed = await confirmAction(this.alertController, {
      title: 'Delete account?',
      message: 'This permanently removes your account, wardrobe items, saved outfits, uploaded images, and related cloud data.',
      confirmLabel: 'Delete account',
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    this.busyAction = 'delete';
    this.busyMessage = 'Deleting account and wardrobe data...';
    this.message = '';
    try {
      await this.auth.deleteAccount();
      await clearAiConsent();
      void successFeedback();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.message = readMessage(error, 'Could not delete your account. Try again.');
      void warningFeedback();
    } finally {
      this.busyAction = null;
      this.busyMessage = '';
    }
  }
}
