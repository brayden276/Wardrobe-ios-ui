import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import type { AlertController } from '@ionic/angular';
import { ApiMessage, UpdateWardrobeItemRequest, WardrobeLookupsDto } from '../models';

export function emptyItemForm(): UpdateWardrobeItemRequest {
  return {
    name: '',
    categoryId: '',
    subcategoryId: '',
    primaryColourId: '',
    secondaryColourIds: [],
    patternId: null,
    visibleMaterialId: null,
    necklineId: null,
    sleeveLengthId: null,
    fitId: null,
    lengthId: null,
    bottomShapeId: null,
    riseId: null
  };
}

const lookupLabelCache = new WeakMap<WardrobeLookupsDto, Map<string, string>>();

export function lookupLabel(lookups: WardrobeLookupsDto, id: string | null): string {
  if (!id) return '';
  let labels = lookupLabelCache.get(lookups);
  if (!labels) {
    const subcategories = lookups.categories.reduce((values, category) => values.concat(category.subcategories), [] as { id: string; label: string }[]);
    const all = [
      ...lookups.categories,
      ...subcategories,
      ...lookups.colours,
      ...lookups.patterns,
      ...lookups.visibleMaterials,
      ...lookups.necklines,
      ...lookups.sleeveLengths,
      ...lookups.fits,
      ...lookups.garmentLengths,
      ...lookups.bottomShapes,
      ...lookups.rises
    ];
    labels = new Map(all.map((x) => [x.id, x.label]));
    lookupLabelCache.set(lookups, labels);
  }

  return labels.get(id) ?? id.replace(/_/g, ' ');
}

export function colourSwatch(id: string): string {
  const colours: Record<string, string> = {
    black: '#0e0d0c',
    white: '#f8f4ec',
    grey: '#9a958e',
    cream: '#eadfc9',
    beige: '#d6c4a8',
    brown: '#8a5f3d',
    navy: '#202c45',
    blue: '#496c8f',
    green: '#687158',
    red: '#9e4137',
    pink: '#d8a2a8',
    purple: '#796184',
    yellow: '#d7b657',
    orange: '#c97845',
    metallic: '#b7a47d',
    multi: 'linear-gradient(135deg, #0e0d0c 0 25%, #eadfc9 25% 50%, #9e4137 50% 75%, #687158 75%)'
  };
  return colours[id] ?? '#c4b8a8';
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ACTIVEWEAR_TOP_SUBCATEGORIES = new Set([
  'active_tops',
  'active_top',
  'top_activewear',
  'activewear_top',
  'activewear_tops',
  'tops_activewear',
  'athletic_top',
  'athletic_tops',
  'sports_bra',
  'active_tee',
  'active_tshirt',
  'sports_top',
  'sport_top',
  'sport_tops'
]);

const ACTIVEWEAR_BOTTOM_SUBCATEGORIES = new Set([
  'active_bottoms',
  'active_bottom',
  'bottom_activewear',
  'activewear_bottom',
  'activewear_bottoms',
  'bottoms_activewear',
  'athletic_bottom',
  'athletic_bottoms',
  'active_short',
  'active_shorts',
  'sport_bottom',
  'sports_bottom',
  'sports_bottoms',
  'legging',
  'leggings',
  'joggers'
]);

export function isActivewearTopSubcategory(subcategoryId: string): boolean {
  const normalised = subcategoryId.trim().toLowerCase();
  if (ACTIVEWEAR_TOP_SUBCATEGORIES.has(normalised)) {
    return true;
  }

  return /(^|[_-])(top|jersey|tank|shirt|tshirt|tee|vest|hoodie|sweatshirt|bra|polo|sleeveless)($|[_-])/i.test(normalised);
}

export function isActivewearBottomSubcategory(subcategoryId: string): boolean {
  const normalised = subcategoryId.trim().toLowerCase();
  if (ACTIVEWEAR_BOTTOM_SUBCATEGORIES.has(normalised)) {
    return true;
  }

  return /(^|[_-])(bottom|short|shorts|legging|leggings|pant|pants|trouser|tights|jogger|joggers)($|[_-])/i.test(normalised);
}

const AI_CONSENT_KEY = 'wardrobe-ai-gemini-consent';
export const PRIVACY_POLICY_URL = 'https://wardrobe.ai/privacy';
export const TERMS_OF_USE_URL = 'https://wardrobe.ai/terms';
export const SUPPORT_URL = 'mailto:support@wardrobe.ai';
export const AI_DISCLOSURE_TEXT = 'Wardrobe AI uses Google Gemini to classify wardrobe photos, generate cleaned display images, and suggest outfits from your saved wardrobe. Avoid uploading photos or prompts that you do not want processed by that provider.';
export const MAX_BATCH_UPLOAD_COUNT = 10;
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const IMAGE_COMPRESSION_TRIGGER_BYTES = 1.5 * 1024 * 1024;
export const IMAGE_MIN_SIDE = 600;
export const IMAGE_COMPRESSION_MAX_SIDES = [2200, 1800, 1400, 1000];
export const IMAGE_COMPRESSION_QUALITIES = [0.82, 0.72, 0.62];
export const MIME_IMAGE_OUTPUT_EXTENSION = 'jpeg';

export async function hasAiConsent(): Promise<boolean> {
  const stored = await Preferences.get({ key: AI_CONSENT_KEY });
  return stored.value === 'accepted';
}

export async function ensureAiConsentWithAlert(alertController: AlertController, prompt: string): Promise<boolean> {
  if (await hasAiConsent()) {
    return true;
  }

  const confirmed = await confirmAction(alertController, {
    title: 'Allow Gemini processing?',
    message: prompt,
    confirmLabel: 'Allow'
  });
  if (!confirmed) {
    return false;
  }

  await Preferences.set({ key: AI_CONSENT_KEY, value: 'accepted' });
  return true;
}

export async function clearAiConsent(): Promise<void> {
  await Preferences.remove({ key: AI_CONSENT_KEY });
}

export interface ConfirmActionOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export type NoticeKind = 'info' | 'success' | 'error' | 'offline';

export async function confirmAction(alertController: AlertController, options: ConfirmActionOptions): Promise<boolean> {
  let choice = false;

  const alert = await alertController.create({
    header: options.title,
    message: options.message,
    buttons: [
      {
        text: options.cancelLabel ?? 'Cancel',
        role: 'cancel',
        handler: () => {
          choice = false;
        }
      },
      {
        text: options.confirmLabel,
        role: options.destructive ? 'destructive' : undefined,
        cssClass: options.destructive ? 'destructive-alert-button' : undefined,
        handler: () => {
          choice = true;
        }
      }
    ]
  });

  await alert.present();
  await alert.onDidDismiss();
  return choice;
}

export function noticeKind(message: string, forceError = false): NoticeKind {
  if (!message) {
    return 'info';
  }

  const normalised = message.toLowerCase();
  if (normalised.includes('could not reach') || normalised.includes('check your connection')) {
    return 'offline';
  }

  if (forceError || /(could not|failed|required|not available|must be|no valid|timed out)/.test(normalised)) {
    return 'error';
  }

  if (/(saved|deleted|marked|ready|added|cleared)/.test(normalised)) {
    return 'success';
  }

  return 'info';
}

export async function lightImpact(): Promise<void> {
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Haptics are best-effort and unavailable in some browser runtimes.
  }
}

export async function successFeedback(): Promise<void> {
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // Haptics are best-effort and unavailable in some browser runtimes.
  }
}

export async function warningFeedback(): Promise<void> {
  try {
    await Haptics.notification({ type: NotificationType.Warning });
  } catch {
    // Haptics are best-effort and unavailable in some browser runtimes.
  }
}

export function readMessage(error: unknown, fallback: string): string {
  const candidate = error as { error?: ApiMessage; status?: number; message?: string };
  if (candidate.status === 0) {
    return 'Could not reach Wardrobe AI. Check your connection and try again.';
  }

  return candidate.error?.message ?? candidate.message ?? fallback;
}
