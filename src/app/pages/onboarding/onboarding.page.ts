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
      subtitle: 'Which styling direction feels most relevant to you?',
      options: [
        { value: 'female', label: 'Womenswear', description: 'Womenswear styling and silhouettes.' },
        { value: 'male', label: 'Menswear', description: 'Menswear styling and silhouettes.' }
      ]
    },
    {
      key: 'fitPreference',
      title: 'Fit preference',
      subtitle: 'How do you like your clothes to fit?',
      options: [
        { value: 'tailored', label: 'Tailored', description: 'Closer-fitting clothes with a defined shape.' },
        { value: 'balanced', label: 'Balanced', description: 'A regular fit with room to move.' },
        { value: 'relaxed', label: 'Relaxed', description: 'Loose, roomy and comfortable.' }
      ]
    },
    {
      key: 'stylePreference',
      title: 'Your everyday style',
      subtitle: 'Pick the style you reach for most often.',
      options: [
        { value: 'minimal', label: 'Minimal', description: 'Simple pieces, clean lines and neutral colours.' },
        { value: 'classic', label: 'Classic', description: 'Familiar staples that stay in style.' },
        { value: 'polished', label: 'Polished', description: 'Coordinated pieces with a dressed-up finish.' },
        { value: 'casual', label: 'Casual', description: 'Easy combinations for everyday comfort.' },
        { value: 'creative', label: 'Creative', description: 'Colour, pattern and unexpected combinations.' }
      ]
    },
    {
      key: 'dailyContext',
      title: 'What do you dress for most?',
      subtitle: 'Choose a starting point. You can choose any occasion in Builder.',
      options: [
        { value: 'work', label: 'Work', description: 'Office days, meetings and professional settings.' },
        { value: 'weekend', label: 'Everyday & Weekends', description: 'Errands, outings and time with friends.' },
        { value: 'evening', label: 'Evenings & Events', description: 'Dinners, celebrations and special occasions.' },
        { value: 'active', label: 'Active Days', description: 'Exercise, outdoor activities and being on the move.' }
      ]
    }
  ];

  stepIndex = 0;
  values: Partial<Record<PersonalDetailsKey, string>> = {};
  message = '';
  isBusy = false;
  isReviewing = false;
  returnToReview = false;
  animationDirection: 'slide-forward' | 'slide-backward' = 'slide-forward';
  private returnUrl = '/tabs/wardrobe';

  ionViewWillEnter(): void {
    this.stepIndex = 0;
    this.isReviewing = false;
    this.returnToReview = false;
    this.message = '';
    this.values = {};
    this.returnUrl = this.auth.hasCompletedPersonalDetails
      ? this.route.snapshot.queryParamMap.get('returnUrl') || '/tabs/wardrobe'
      : '/tabs/getting-started';
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

  get canContinue(): boolean {
    return !this.isBusy && (this.isReviewing ? !!this.buildRequest() : this.currentStep.options.some((option) => option.value === this.values[this.currentStep.key]));
  }

  get canLeave(): boolean {
    return this.auth.hasCompletedPersonalDetails;
  }

  get submitLabel(): string {
    if (this.isBusy) return 'Saving...';
    if (this.isReviewing) return this.canLeave ? 'Save Changes' : 'Save & Get Started';
    return this.isFinalStep || this.returnToReview ? 'Review Preferences' : 'Continue';
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  selectedValue(key: PersonalDetailsKey): string {
    return this.values[key] ?? '';
  }

  choose(key: PersonalDetailsKey, value: string): void {
    if (this.isBusy || !this.steps.find((step) => step.key === key)?.options.some((option) => option.value === value)) return;
    this.values = { ...this.values, [key]: value };
    this.message = '';
    void lightImpact();
  }

  answerLabel(key: PersonalDetailsKey): string {
    return this.steps.find((step) => step.key === key)?.options.find((option) => option.value === this.values[key])?.label ?? 'Not chosen';
  }

  editAnswer(index: number): void {
    if (this.isBusy || !this.steps[index]) return;
    this.stepIndex = index;
    this.isReviewing = false;
    this.returnToReview = true;
    this.message = '';
  }

  handleBack(): void {
    if (this.isBusy) return;
    if (this.returnToReview) {
      this.returnToReview = false;
      this.isReviewing = true;
      return;
    }
    if (this.isReviewing) {
      this.isReviewing = false;
      this.stepIndex = this.steps.length - 1;
      return;
    }
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
    if (this.isBusy) return;
    if (!this.canContinue) {
      this.message = 'Choose one option to continue.';
      return;
    }

    if (this.isReviewing) {
      await this.save();
      return;
    }

    if (!this.isFinalStep && !this.returnToReview) {
      this.animationDirection = 'slide-forward';
      this.stepIndex += 1;
      this.message = '';
      void lightImpact();
      return;
    }

    this.isReviewing = true;
    this.returnToReview = false;
    this.message = '';
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
    if (!this.steps.every((step) => step.options.some((option) => option.value === this.values[step.key]))) {
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
