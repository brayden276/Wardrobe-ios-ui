import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { AuthService } from '../../auth.service';
import { AiUsageCostSummaryDto } from '../../models';
import { WardrobeApiService } from '../../wardrobe-api.service';
import {
  AI_DISCLOSURE_TEXT,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_OF_USE_URL,
  clearAiConsent,
  confirmAction,
  hasAiConsent,
  lightImpact,
  noticeKind,
  NoticeKind,
  readMessage,
  successFeedback,
  warningFeedback
} from '../page-helpers';

type SettingsMode = 'account' | 'ai' | 'legal' | 'danger';

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
  readonly privacyPolicyUrl = PRIVACY_POLICY_URL;
  readonly termsUrl = TERMS_OF_USE_URL;
  readonly supportUrl = SUPPORT_URL;
  readonly aiDisclosure = AI_DISCLOSURE_TEXT;
  aiConsentAccepted = false;
  aiUsage: AiUsageCostSummaryDto | null = null;
  aiUsageLoadMessage = '';
  isLoadingAiUsage = false;
  isBusy = false;
  busyMessage = '';
  message = '';
  settingsMode: SettingsMode = 'account';

  async ionViewWillEnter(): Promise<void> {
    this.aiConsentAccepted = await hasAiConsent();
    this.message = '';
    await this.loadAiUsage();
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

  get settingsStatusMessage(): string {
    if (this.busyMessage) {
      return this.busyMessage;
    }

    if (this.isLoadingAiUsage) {
      return 'Loading AI processing activity...';
    }

    return '';
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  get aiUsageLoadKind(): NoticeKind {
    return noticeKind(this.aiUsageLoadMessage);
  }

  setSettingsMode(mode: SettingsMode): void {
    if (this.settingsMode === mode) {
      return;
    }

    this.settingsMode = mode;
    if (mode !== 'danger') {
      this.message = '';
    }
    void lightImpact();
  }

  async logout(): Promise<void> {
    this.isBusy = true;
    this.busyMessage = 'Signing out...';
    this.message = '';
    try {
      await this.auth.logout();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.message = readMessage(error, 'Could not sign out. Check your connection and try again.');
      void warningFeedback();
    } finally {
      this.isBusy = false;
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

    this.isBusy = true;
    this.busyMessage = 'Clearing Gemini consent...';
    this.message = '';
    try {
      await clearAiConsent();
      this.aiConsentAccepted = false;
      this.message = 'Gemini consent was cleared for this device.';
      void successFeedback();
    } finally {
      this.isBusy = false;
      this.busyMessage = '';
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

    this.isBusy = true;
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
      this.isBusy = false;
      this.busyMessage = '';
    }
  }
}
