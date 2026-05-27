import { Component, inject } from '@angular/core';
import { GeneratedOutfitDto, WardrobeItemDto, WardrobeLookupsDto } from '../../models';
import { WardrobeApiService } from '../../wardrobe-api.service';
import {
  AI_DISCLOSURE_TEXT,
  colourSwatch,
  ensureAiConsent,
  isActivewearBottomSubcategory,
  isActivewearTopSubcategory,
  lookupLabel,
  readMessage
} from '../page-helpers';

type BuilderMode = 'generate' | 'manual';
type GeneratedOutfitSaveState = 'idle' | 'saving' | 'saved' | 'failed';

@Component({
  selector: 'app-builder',
  standalone: false,
  templateUrl: './builder.page.html',
  styleUrls: ['./builder.page.scss']
})
export class BuilderPage {
  private readonly api = inject(WardrobeApiService);
  builderMode: BuilderMode = 'generate';
  query = '';
  readonly occasionOptions = ['Work', 'Dinner', 'Brunch', 'Weekend'];
  readonly dressCodeOptions = ['Smart casual', 'Relaxed', 'Polished', 'Active'];
  readonly avoidOptions = ['No heels', 'No jacket', 'No dress'];
  readonly loadingRows = [0, 1];
  occasion = 'Dinner';
  dressCode = 'Smart casual';
  selectedAvoids = ['No heels'];
  items: WardrobeItemDto[] = [];
  lookups: WardrobeLookupsDto | null = null;
  results: GeneratedOutfitDto[] = [];
  requiredItemId: string | null = null;
  manualName = 'Manual outfit';
  manualItemIds: string[] = [];
  message = '';
  hasGeneratedSearchRun = false;
  isBuildingOutfits = false;
  isSavingManualOutfit = false;
  private lastGeneratedPrompt = '';
  private readonly savingGeneratedOutfitKeys = new Set<string>();
  private readonly savedGeneratedOutfitKeys = new Set<string>();
  private readonly failedGeneratedOutfitKeys = new Set<string>();

  get isBusy(): boolean {
    return this.isBuildingOutfits || this.isSavingManualOutfit;
  }

  get canGenerate(): boolean {
    return !!this.buildOutfitQuery();
  }

  get loadingStatus(): string {
    if (this.requiredItemId) {
      return `Matching outfits with ${this.nameFor(this.requiredItemId)}...`;
    }

    return 'Building outfit suggestions...';
  }

  async ionViewWillEnter(): Promise<void> {
    this.message = '';
    try {
      this.lookups ??= await this.api.getLookups();
      this.items = await this.api.getItems();
      this.manualItemIds = this.manualItemIds.filter((id) => this.items.some((item) => item.id === id));
      if (this.requiredItemId && !this.items.some((item) => item.id === this.requiredItemId)) {
        this.requiredItemId = null;
      }
    } catch (error) {
      this.message = readMessage(error, 'Could not load wardrobe items.');
    }
  }

  setBuilderMode(mode: BuilderMode): void {
    this.builderMode = mode;
    this.message = '';
  }

  clearQuery(): void {
    this.query = '';
  }

  setOccasion(value: string): void {
    this.occasion = value;
  }

  setDressCode(value: string): void {
    this.dressCode = value;
  }

  toggleAvoid(value: string): void {
    if (this.selectedAvoids.includes(value)) {
      this.selectedAvoids = this.selectedAvoids.filter((entry) => entry !== value);
      return;
    }

    this.selectedAvoids = [...this.selectedAvoids, value];
  }

  isAvoidSelected(value: string): boolean {
    return this.selectedAvoids.includes(value);
  }

  clearAvoids(): void {
    this.selectedAvoids = [];
  }

  selectRequiredItem(id: string | null): void {
    this.requiredItemId = id;
  }

  clearRequiredItem(): void {
    this.requiredItemId = null;
  }

  toggleManualItem(id: string): void {
    if (this.manualItemIds.includes(id)) {
      this.manualItemIds = this.manualItemIds.filter((value) => value !== id);
      return;
    }

    this.manualItemIds = [...this.manualItemIds, id];
  }

  clearManualSelection(): void {
    this.manualItemIds = [];
  }

  selectAllItems(): void {
    this.manualItemIds = this.items.map((item) => item.id);
  }

  async search(): Promise<void> {
    if (!await ensureAiConsent(
      'Wardrobe AI uses Google Gemini to interpret your outfit request and generate outfit suggestions from your wardrobe. Do you want to continue with AI processing for this device?'))
    {
      this.message = 'Gemini consent is required before Wardrobe AI can build outfit suggestions.';
      return;
    }

    this.isBuildingOutfits = true;
    this.message = '';
    this.hasGeneratedSearchRun = true;
    this.results = [];
    this.savedGeneratedOutfitKeys.clear();
    this.failedGeneratedOutfitKeys.clear();
    try {
      this.lookups ??= await this.api.getLookups();
      this.items = await this.api.getItems();
      const prompt = this.buildOutfitQuery();
      this.lastGeneratedPrompt = prompt;
      this.results = await this.api.searchOutfits(prompt, this.requiredItemId);
      if (!this.results.length) {
        this.message = '';
      }
    } catch (error) {
      this.results = [];
      this.message = readMessage(error, 'Could not build an outfit from the current wardrobe.');
    } finally {
      this.isBuildingOutfits = false;
    }
  }

  async saveManual(): Promise<void> {
    if (!this.manualCanSave) {
      this.message = this.manualHint || 'Add more clothing items to build complete outfits.';
      return;
    }

    this.isSavingManualOutfit = true;
    this.message = '';
    try {
      await this.api.saveOutfit(this.manualName.trim() || 'Manual outfit', null, 'Built manually from selected wardrobe items.', this.manualItemIds);
      this.message = 'Outfit saved.';
    } catch (error) {
      this.message = readMessage(error, 'Could not save outfit.');
    } finally {
      this.isSavingManualOutfit = false;
    }
  }

  async save(outfit: GeneratedOutfitDto): Promise<void> {
    const key = this.generatedOutfitKey(outfit);
    if (this.savingGeneratedOutfitKeys.has(key)) {
      return;
    }

    this.savingGeneratedOutfitKeys.add(key);
    this.savedGeneratedOutfitKeys.delete(key);
    this.failedGeneratedOutfitKeys.delete(key);
    this.message = '';
    try {
      await this.api.saveOutfit(outfit.title, this.lastGeneratedPrompt || this.buildOutfitQuery(), outfit.explanation, outfit.itemIds, outfit.imageUrl);
      this.savedGeneratedOutfitKeys.add(key);
    } catch {
      this.failedGeneratedOutfitKeys.add(key);
    } finally {
      this.savingGeneratedOutfitKeys.delete(key);
    }
  }

  imageFor(id: string): string {
    return this.items.find((x) => x.id === id)?.image.displayUrl ?? '';
  }

  nameFor(id: string): string {
    return this.items.find((x) => x.id === id)?.name ?? 'Wardrobe item';
  }

  label(id: string | null): string {
    if (!id || !this.lookups) return '';
    return lookupLabel(this.lookups, id);
  }

  coloursFor(item: WardrobeItemDto): string[] {
    return [item.primaryColourId, ...item.secondaryColourIds].filter(Boolean).slice(0, 4);
  }

  colourSwatch(id: string): string {
    return colourSwatch(id);
  }

  isManualSelected(id: string): boolean {
    return this.manualItemIds.includes(id);
  }

  get manualCanSave(): boolean {
    return this.isValidManualOutfit(this.selectedManualItems());
  }

  get manualHint(): string {
    const selected = this.selectedManualItems();
    if (!selected.length) {
      return '';
    }

    if (!selected.some((item) => this.manualCategory(item) === 'footwear')) {
      return 'Add shoes to complete the outfit.';
    }

    if (!this.isValidManualOutfit(selected)) {
      return 'Choose a top and bottom (including activewear variants), a dress, or one piece, with one pair of shoes.';
    }

    return '';
  }

  private selectedManualItems(): WardrobeItemDto[] {
    return this.manualItemIds
      .map((id) => this.items.find((item) => item.id === id))
      .filter((item): item is WardrobeItemDto => !!item);
  }

  private isValidManualOutfit(items: WardrobeItemDto[]): boolean {
    const count = (predicate: (item: WardrobeItemDto) => boolean): number => items.filter(predicate).length;
    const tops = count((item) => this.manualCategory(item) === 'tops');
    const bottoms = count((item) => this.manualCategory(item) === 'bottoms');
    const dresses = count((item) => this.manualCategory(item) === 'dresses');
    const onePieces = count((item) => this.manualCategory(item) === 'one_pieces');
    const footwear = count((item) => this.manualCategory(item) === 'footwear');
    const outerwear = count((item) => this.manualCategory(item) === 'outerwear');
    const bags = count((item) => this.manualCategory(item) === 'bags');
    const accessories = count((item) => this.manualCategory(item) === 'accessories');
    const supportedItems = tops + bottoms + dresses + onePieces + footwear + outerwear + bags + accessories;

    if (supportedItems !== items.length || footwear !== 1 || outerwear > 1 || bags > 1) {
      return false;
    }

    return (tops === 1 && bottoms === 1 && dresses === 0 && onePieces === 0)
      || (dresses === 1 && tops === 0 && bottoms === 0 && onePieces === 0)
      || (onePieces === 1 && tops === 0 && bottoms === 0 && dresses === 0);
  }

  trackById(_: number, item: WardrobeItemDto): string {
    return item.id;
  }

  isSavingGeneratedOutfit(outfit: GeneratedOutfitDto): boolean {
    return this.savingGeneratedOutfitKeys.has(this.generatedOutfitKey(outfit));
  }

  generatedSaveState(outfit: GeneratedOutfitDto): GeneratedOutfitSaveState {
    const key = this.generatedOutfitKey(outfit);
    if (this.savingGeneratedOutfitKeys.has(key)) {
      return 'saving';
    }

    if (this.savedGeneratedOutfitKeys.has(key)) {
      return 'saved';
    }

    if (this.failedGeneratedOutfitKeys.has(key)) {
      return 'failed';
    }

    return 'idle';
  }

  generatedSaveLabel(outfit: GeneratedOutfitDto): string {
    switch (this.generatedSaveState(outfit)) {
      case 'saving':
        return 'Saving...';
      case 'saved':
        return 'Saved';
      default:
        return 'Save outfit';
    }
  }

  private buildOutfitQuery(): string {
    return [
      this.dressCode,
      this.occasion,
      this.selectedAvoids.length ? `Avoid ${this.selectedAvoids.join(', ').toLowerCase()}` : '',
      this.query.trim()
    ].filter(Boolean).join('. ');
  }

  private manualCategory(item: WardrobeItemDto): string | null {
    if (item.categoryId === 'activewear') {
      if (this.isActivewearTop(item)) return 'tops';
      if (this.isActivewearBottom(item)) return 'bottoms';
      return null;
    }

    if (item.categoryId === 'tops' || item.categoryId === 'knitwear') {
      return 'tops';
    }

    if (item.categoryId === 'one_pieces') {
      return 'one_pieces';
    }

    return item.categoryId === 'accessories'
      || item.categoryId === 'bags'
      || item.categoryId === 'bottoms'
      || item.categoryId === 'dresses'
      || item.categoryId === 'footwear'
      || item.categoryId === 'outerwear'
      ? item.categoryId
      : null;
  }

  private isActivewearTop(item: WardrobeItemDto): boolean {
    return isActivewearTopSubcategory(item.subcategoryId);
  }

  private isActivewearBottom(item: WardrobeItemDto): boolean {
    return isActivewearBottomSubcategory(item.subcategoryId);
  }

  private generatedOutfitKey(outfit: GeneratedOutfitDto): string {
    return `${outfit.title}::${outfit.itemIds.join(',')}::${outfit.imageUrl ?? ''}`;
  }
}
