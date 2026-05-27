import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../auth.service';
import { AiUsageCostSummaryDto } from '../../models';
import { WardrobeApiService } from '../../wardrobe-api.service';
import {
  AI_DISCLOSURE_TEXT,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_OF_USE_URL,
  clearAiConsent,
  hasAiConsent,
  readMessage
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
  readonly privacyPolicyUrl = PRIVACY_POLICY_URL;
  readonly termsUrl = TERMS_OF_USE_URL;
  readonly supportUrl = SUPPORT_URL;
  readonly aiDisclosure = AI_DISCLOSURE_TEXT;
  aiConsentAccepted = false;
  aiUsage: AiUsageCostSummaryDto | null = null;
  isBusy = false;
  message = '';
  settingsMode: SettingsMode = 'account';

  async ionViewWillEnter(): Promise<void> {
    this.aiConsentAccepted = await hasAiConsent();
    this.message = '';
    try {
      this.aiUsage = await this.api.getAiUsageCostSummary();
    } catch {
      this.aiUsage = null;
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

  setSettingsMode(mode: SettingsMode): void {
    if (this.settingsMode === mode) {
      return;
    }

    this.settingsMode = mode;
    if (mode !== 'danger') {
      this.message = '';
    }
  }

  async logout(): Promise<void> {
    this.isBusy = true;
    await this.auth.logout();
    this.isBusy = false;
    await this.router.navigateByUrl('/login');
  }

  async resetAiConsent(): Promise<void> {
    if (!this.aiConsentAccepted || !window.confirm('Require consent again for Gemini wardrobe processing on this device?')) {
      return;
    }

    await clearAiConsent();
    this.aiConsentAccepted = false;
    this.message = 'Gemini consent was cleared for this device.';
  }

  async deleteAccount(): Promise<void> {
    const confirmed = window.confirm('Delete your Wardrobe AI account? This permanently removes your account, wardrobe items, saved outfits, uploaded images, and related cloud data.');
    if (!confirmed) {
      return;
    }

    this.isBusy = true;
    this.message = '';
    try {
      await this.auth.deleteAccount();
      await clearAiConsent();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.message = readMessage(error, 'Could not delete your account. Try again.');
    } finally {
      this.isBusy = false;
    }
  }
}
