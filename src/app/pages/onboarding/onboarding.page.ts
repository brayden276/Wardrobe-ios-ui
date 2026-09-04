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
  description: string;
}

interface PersonalDetailsStep {
  key: PersonalDetailsKey;
  title: string;
  subtitle: string;
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
      subtitle: 'Calibrates standard garment sizing and silhouette recommendations.',
      options: [
        { value: 'female', label: 'Womenswear', description: 'Curated silhouettes, styling, and cuts tailored for women.' },
        { value: 'male', label: 'Menswear', description: 'Structured shoulders, tailored proportions, and menswear staples.' }
      ]
    },
    {
      key: 'fitPreference',
      title: 'Fit preference',
      subtitle: 'Defines how clothes drape over your silhouette.',
      options: [
        { value: 'tailored', label: 'Tailored', description: 'Streamlined lines, contouring seams, and sharp definition.' },
        { value: 'balanced', label: 'Balanced', description: 'Standard proportional ease with comfortable, natural movement.' },
        { value: 'relaxed', label: 'Relaxed', description: 'Generous volume, drop shoulders, and effortless casual drape.' }
      ]
    },
    {
      key: 'stylePreference',
      title: 'Style lean',
      subtitle: 'Select the primary aesthetic formula for daily outfit suggestions.',
      options: [
        { value: 'minimal', label: 'Minimal', description: 'Neutral palettes, clean lines, and unadorned architectural cuts.' },
        { value: 'classic', label: 'Classic', description: 'Timeless sartorial staples, heritage fabrics, and refined balance.' },
        { value: 'polished', label: 'Polished', description: 'Sharp coordination, elevated footwear, and sharp sophistication.' },
        { value: 'casual', label: 'Casual', description: 'Unstructured comfort, tactile textures, and relaxed versatility.' },
        { value: 'creative', label: 'Creative', description: 'Expressive silhouette pairings, texture play, and bold contrasts.' }
      ]
    },
    {
      key: 'dailyContext',
      title: 'Usual context',
      subtitle: 'Where you spend the majority of your dressed hours.',
      options: [
        { value: 'work', label: 'Work & Professional', description: 'Smart offices, meetings, and corporate dressing.' },
        { value: 'weekend', label: 'Weekend & Leisure', description: 'Off-duty outings, dining, travel, and social events.' },
        { value: 'evening', label: 'Evening & Occasion', description: 'Dinner dates, gallery openings, and formal evening gatherings.' },
        { value: 'active', label: 'Active & Transit', description: 'High-movement schedules, outdoor routines, and athleisure utility.' }
      ]
    }
  ];

  stepIndex = 0;
  values: Partial<Record<PersonalDetailsKey, string>> = {};
  message = '';
  isBusy = false;
  animationDirection: 'slide-forward' | 'slide-backward' = 'slide-forward';
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

  selectAndAdvance(key: PersonalDetailsKey, value: string): void {
    this.choose(key, value);
  }

  handleBack(): void {
    if (this.stepIndex > 0) {
      this.animationDirection = 'slide-backward';
      this.previous();
    } else if (this.canLeave) {
      void this.close();
    }
  }

  previous(): void {
    if (this.stepIndex === 0 || this.isBusy) {
      return;
    }

    this.animationDirection = 'slide-backward';
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
      this.animationDirection = 'slide-forward';
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
