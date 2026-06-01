import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../auth.service';
import {
  PersonalDetailsDailyContext,
  PersonalDetailsFitPreference,
  PersonalDetailsGender,
  PersonalDetailsStylePreference,
  UpdatePersonalDetailsRequest
} from '../../models';
import { lightImpact, noticeKind, NoticeKind, readMessage, successFeedback, warningFeedback } from '../page-helpers';

type PersonalDetailsKey = keyof UpdatePersonalDetailsRequest;

interface PersonalDetailsOption {
  value: string;
  label: string;
}

interface PersonalDetailsStep {
  key: PersonalDetailsKey;
  title: string;
  options: PersonalDetailsOption[];
}

@Component({
  selector: 'app-onboarding',
  standalone: false,
  templateUrl: './onboarding.page.html',
  styleUrls: ['./onboarding.page.scss']
})
export class OnboardingPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly steps: PersonalDetailsStep[] = [
    {
      key: 'gender',
      title: 'Wardrobe direction',
      options: [
        { value: 'male', label: 'Male' },
        { value: 'female', label: 'Female' }
      ]
    },
    {
      key: 'fitPreference',
      title: 'Fit preference',
      options: [
        { value: 'tailored', label: 'Tailored' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'relaxed', label: 'Relaxed' }
      ]
    },
    {
      key: 'stylePreference',
      title: 'Style lean',
      options: [
        { value: 'minimal', label: 'Minimal' },
        { value: 'classic', label: 'Classic' },
        { value: 'polished', label: 'Polished' },
        { value: 'casual', label: 'Casual' },
        { value: 'creative', label: 'Creative' }
      ]
    },
    {
      key: 'dailyContext',
      title: 'Usual context',
      options: [
        { value: 'work', label: 'Work' },
        { value: 'weekend', label: 'Weekend' },
        { value: 'evening', label: 'Evening' },
        { value: 'active', label: 'Active' }
      ]
    }
  ];

  stepIndex = 0;
  values: Partial<Record<PersonalDetailsKey, string>> = {};
  message = '';
  isBusy = false;
  private returnUrl = '/tabs/wardrobe';

  ionViewWillEnter(): void {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/tabs/wardrobe';
    const personalDetails = this.auth.session?.user?.personalDetails;
    if (personalDetails) {
      this.values = {
        gender: personalDetails.gender,
        fitPreference: personalDetails.fitPreference,
        stylePreference: personalDetails.stylePreference,
        dailyContext: personalDetails.dailyContext
      };
    }
  }

  get currentStep(): PersonalDetailsStep {
    return this.steps[this.stepIndex];
  }

  get isFinalStep(): boolean {
    return this.stepIndex === this.steps.length - 1;
  }

  get progressPercent(): number {
    return ((this.stepIndex + 1) / this.steps.length) * 100;
  }

  get canContinue(): boolean {
    return !!this.values[this.currentStep.key] && !this.isBusy;
  }

  get canLeave(): boolean {
    return this.auth.hasCompletedPersonalDetails;
  }

  get submitLabel(): string {
    return this.isBusy ? 'Saving...' : this.isFinalStep ? 'Save details' : 'Continue';
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  selectedValue(key: PersonalDetailsKey): string {
    return this.values[key] ?? '';
  }

  choose(key: PersonalDetailsKey, value: string): void {
    this.values = { ...this.values, [key]: value };
    this.message = '';
    void lightImpact();
  }

  previous(): void {
    if (this.stepIndex === 0 || this.isBusy) {
      return;
    }

    this.stepIndex -= 1;
    this.message = '';
    void lightImpact();
  }

  async advance(): Promise<void> {
    if (!this.canContinue) {
      this.message = 'Choose one option to continue.';
      return;
    }

    if (!this.isFinalStep) {
      this.stepIndex += 1;
      this.message = '';
      void lightImpact();
      return;
    }

    await this.save();
  }

  async close(): Promise<void> {
    if (!this.canLeave || this.isBusy) {
      return;
    }

    await this.router.navigateByUrl(this.returnUrl);
  }

  private async save(): Promise<void> {
    const request = this.buildRequest();
    if (!request) {
      this.message = 'Complete each step before saving.';
      return;
    }

    this.isBusy = true;
    this.message = '';
    try {
      await this.auth.updatePersonalDetails(request);
      void successFeedback();
      await this.router.navigateByUrl(this.returnUrl);
    } catch (error) {
      this.message = readMessage(error, 'Could not save personal details.');
      void warningFeedback();
    } finally {
      this.isBusy = false;
    }
  }

  private buildRequest(): UpdatePersonalDetailsRequest | null {
    const gender = this.values.gender;
    const fitPreference = this.values.fitPreference;
    const stylePreference = this.values.stylePreference;
    const dailyContext = this.values.dailyContext;
    if (!gender || !fitPreference || !stylePreference || !dailyContext) {
      return null;
    }

    return {
      gender: gender as PersonalDetailsGender,
      fitPreference: fitPreference as PersonalDetailsFitPreference,
      stylePreference: stylePreference as PersonalDetailsStylePreference,
      dailyContext: dailyContext as PersonalDetailsDailyContext
    };
  }
}
