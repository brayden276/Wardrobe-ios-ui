import { Component, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { GeneratedOutfitDto, WardrobeItemDto, WardrobeLookupsDto } from '../../models';
import { WardrobeApiService } from '../../wardrobe-api.service';
import {
  colourSwatch,
  ensureAiConsentWithAlert,
  isActivewearBottomSubcategory,
  isActivewearTopSubcategory,
  lightImpact,
  lookupLabel,
  noticeKind,
  NoticeKind,
  readMessage,
  successFeedback,
  warningFeedback
} from '../page-helpers';

type BuilderMode = 'generate' | 'manual';
type GeneratedOutfitSaveState = 'idle' | 'saving' | 'saved' | 'failed';
type BuilderProcessingKind = 'loadingWardrobe' | 'buildingOutfits' | 'savingGeneratedOutfit' | 'savingManualOutfit';

@Component({
  selector: 'app-builder',
  standalone: false,
  templateUrl: './builder.page.html',
  styleUrls: ['./builder.page.scss']
})
export class BuilderPage {
  private readonly api = inject(WardrobeApiService);
  private readonly alertController = inject(AlertController);
  builderMode: BuilderMode = 'generate';
  query = '';
  readonly occasionOptions = ['Work', 'Dinner', 'Brunch', 'Weekend'];
  readonly dressCodeOptions = ['Smart casual', 'Relaxed', 'Polished', 'Active'];
  readonly avoidOptions = ['No heels', 'No jacket', 'No dress'];
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
  isLoadingWardrobe = true;
  isBuildingOutfits = false;
  isSavingManualOutfit = false;
  processingKind: BuilderProcessingKind | null = null;
  processingStepIndex = 0;
  private lastGeneratedPrompt = '';
  private readonly savingGeneratedOutfitKeys = new Set<string>();
  private readonly savedGeneratedOutfitKeys = new Set<string>();
  private readonly failedGeneratedOutfitKeys = new Set<string>();
  private readonly builderItemRenderIncrement = 60;
  visibleBuilderItemCount = this.builderItemRenderIncrement;
  private readonly processingStepsByKind: Record<BuilderProcessingKind, string[]> = {
    loadingWardrobe: ['Loading wardrobe items', 'Loading outfit options', 'Preparing builder'],
    buildingOutfits: ['Reading request', 'Matching wardrobe items', 'Building outfit combinations', 'Preparing suggestions'],
    savingGeneratedOutfit: ['Collecting selected item images', 'Composing outfit preview', 'Generating outfit image', 'Saving outfit'],
    savingManualOutfit: ['Collecting selected item images', 'Composing outfit preview', 'Generating outfit image', 'Saving outfit']
  };

  get isBusy(): boolean {
    return this.isLoadingWardrobe
      || this.isBuildingOutfits
      || this.isSavingManualOutfit
      || this.savingGeneratedOutfitKeys.size > 0;
  }

  get includeItems(): WardrobeItemDto[] {
    const visibleItems = this.items.slice(0, this.visibleBuilderItemCount);
    if (!this.requiredItemId || visibleItems.some((item) => item.id === this.requiredItemId)) {
      return visibleItems;
    }

    const requiredItem = this.items.find((item) => item.id === this.requiredItemId);
    return requiredItem ? [requiredItem, ...visibleItems] : visibleItems;
  }

  get manualItems(): WardrobeItemDto[] {
    const visibleItems = this.items.slice(0, this.visibleBuilderItemCount);
    if (!this.manualItemIds.length) {
      return visibleItems;
    }

    const visibleIds = new Set(visibleItems.map((item) => item.id));
    const selectedOutsideVisibleRange = this.selectedManualItems()
      .filter((item) => !visibleIds.has(item.id))
      .slice(0, 20);
    return [...selectedOutsideVisibleRange, ...visibleItems];
  }

  get canShowMoreBuilderItems(): boolean {
    return this.visibleBuilderItemCount < this.items.length;
  }

  showMoreBuilderItems(): void {
    this.visibleBuilderItemCount = Math.min(this.items.length, this.visibleBuilderItemCount + this.builderItemRenderIncrement);
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

  get isFullPageProcessing(): boolean {
    return this.processingKind !== null;
  }

  get processingTitle(): string {
    switch (this.processingKind) {
      case 'loadingWardrobe':
        return 'Loading wardrobe';
      case 'buildingOutfits':
        return 'Building outfit ideas';
      case 'savingGeneratedOutfit':
      case 'savingManualOutfit':
        return 'Generating outfit image';
      default:
        return '';
    }
  }

  get processingDetail(): string {
    switch (this.processingKind) {
      case 'loadingWardrobe':
        return 'Loading the items and options needed for the builder.';
      case 'buildingOutfits':
        return this.loadingStatus;
      case 'savingGeneratedOutfit':
        return 'Using the selected clothing item images to generate the saved outfit preview.';
      case 'savingManualOutfit':
        return 'Using your selected clothing item images to generate the saved outfit preview.';
      default:
        return '';
    }
  }

  get processingSteps(): string[] {
    return this.processingKind ? this.processingStepsByKind[this.processingKind] : [];
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  processingStepState(index: number): string {
    if (!this.processingKind) {
      return '';
    }

    if (index < this.processingStepIndex) {
      return 'complete';
    }

    return index === this.processingStepIndex ? 'active' : 'pending';
  }

  async ionViewWillEnter(): Promise<void> {
    this.message = '';
    this.isLoadingWardrobe = true;
    this.startProcessing('loadingWardrobe');
    try {
      const [lookups, items] = await Promise.all([
        this.lookups ? Promise.resolve(this.lookups) : this.api.getLookups(),
        this.api.getItems()
      ]);
      this.setProcessingStep(2);
      this.lookups = lookups;
      this.items = items;
      this.manualItemIds = this.manualItemIds.filter((id) => this.items.some((item) => item.id === id));
      if (this.requiredItemId && !this.items.some((item) => item.id === this.requiredItemId)) {
        this.requiredItemId = null;
      }
    } catch (error) {
      this.message = readMessage(error, 'Could not load wardrobe items.');
    } finally {
      this.isLoadingWardrobe = false;
      this.stopProcessing('loadingWardrobe');
    }
  }

  setBuilderMode(mode: BuilderMode): void {
    this.builderMode = mode;
    this.message = '';
    void lightImpact();
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
      void lightImpact();
      return;
    }

    this.selectedAvoids = [...this.selectedAvoids, value];
    void lightImpact();
  }

  isAvoidSelected(value: string): boolean {
    return this.selectedAvoids.includes(value);
  }

  clearAvoids(): void {
    this.selectedAvoids = [];
  }

  selectRequiredItem(id: string | null): void {
    this.requiredItemId = id;
    void lightImpact();
  }

  clearRequiredItem(): void {
    this.requiredItemId = null;
  }

  toggleManualItem(id: string): void {
    if (this.manualItemIds.includes(id)) {
      this.manualItemIds = this.manualItemIds.filter((value) => value !== id);
      void lightImpact();
      return;
    }

    this.manualItemIds = [...this.manualItemIds, id];
    void lightImpact();
  }

  clearManualSelection(): void {
    this.manualItemIds = [];
  }

  selectAllItems(): void {
    this.manualItemIds = this.items.map((item) => item.id);
  }

  async search(): Promise<void> {
    if (!await ensureAiConsentWithAlert(
      this.alertController,
      'Wardrobe AI uses Google Gemini to interpret your outfit request and generate outfit suggestions from your wardrobe. Do you want to continue with AI processing for this device?'))
    {
      this.message = 'Gemini consent is required before Wardrobe AI can build outfit suggestions.';
      void warningFeedback();
      return;
    }

    this.isBuildingOutfits = true;
    this.startProcessing('buildingOutfits');
    this.message = '';
    this.hasGeneratedSearchRun = true;
    this.results = [];
    this.savedGeneratedOutfitKeys.clear();
    this.failedGeneratedOutfitKeys.clear();
    try {
      const [lookups, items] = await Promise.all([
        this.lookups ? Promise.resolve(this.lookups) : this.api.getLookups(),
        this.api.getItems()
      ]);
      this.setProcessingStep(1);
      this.lookups = lookups;
      this.items = items;
      const prompt = this.buildOutfitQuery();
      this.lastGeneratedPrompt = prompt;
      this.setProcessingStep(2);
      const generatedOutfits = await this.api.searchOutfits(prompt, this.requiredItemId);
      this.results = generatedOutfits.filter((outfit) => !!outfit.displayImageUrl || !!outfit.imageUrl);
      this.setProcessingStep(3);
      if (!this.results.length) {
        this.message = generatedOutfits.length
          ? 'Could not generate outfit previews for that request. Try again with a different outfit brief.'
          : '';
      }
      void lightImpact();
    } catch (error) {
      this.results = [];
      this.message = readMessage(error, 'Could not build an outfit from the current wardrobe.');
      void warningFeedback();
    } finally {
      this.isBuildingOutfits = false;
      this.stopProcessing('buildingOutfits');
    }
  }

  async saveManual(): Promise<void> {
    if (!this.manualCanSave) {
      this.message = this.manualHint || 'Add more clothing items to build complete outfits.';
      return;
    }

    this.isSavingManualOutfit = true;
    this.startProcessing('savingManualOutfit');
    this.message = '';
    try {
      const selected = this.selectedManualItems();
      this.setProcessingStep(1);
      const explanation = this.isValidManualOutfit(selected)
        ? 'Built manually from selected wardrobe items.'
        : `Saved as a partial manual look from selected wardrobe items. ${this.manualHint}`;
      this.setProcessingStep(2);
      await this.api.saveOutfit(this.manualName.trim() || 'Manual outfit', null, explanation.trim(), this.manualItemIds);
      this.setProcessingStep(3);
      this.message = 'Outfit saved.';
      void successFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not save outfit.');
      void warningFeedback();
    } finally {
      this.isSavingManualOutfit = false;
      this.stopProcessing('savingManualOutfit');
    }
  }

  async save(outfit: GeneratedOutfitDto): Promise<void> {
    const key = this.generatedOutfitKey(outfit);
    if (this.savingGeneratedOutfitKeys.has(key)) {
      return;
    }

    this.savingGeneratedOutfitKeys.add(key);
    this.startProcessing('savingGeneratedOutfit');
    this.savedGeneratedOutfitKeys.delete(key);
    this.failedGeneratedOutfitKeys.delete(key);
    this.message = '';
    try {
      this.setProcessingStep(1);
      this.setProcessingStep(2);
      await this.api.saveOutfit(
        outfit.title,
        this.lastGeneratedPrompt || this.buildOutfitQuery(),
        outfit.explanation,
        outfit.itemIds,
        outfit.imageUrl || outfit.displayImageUrl || null);
      this.setProcessingStep(3);
      this.savedGeneratedOutfitKeys.add(key);
      void successFeedback();
    } catch (error) {
      this.failedGeneratedOutfitKeys.add(key);
      this.message = readMessage(error, 'Could not save outfit.');
      void warningFeedback();
    } finally {
      this.savingGeneratedOutfitKeys.delete(key);
      this.stopProcessing('savingGeneratedOutfit');
    }
  }

  imageFor(id: string): string {
    const item = this.items.find((x) => x.id === id);
    return item ? this.itemImageUrl(item) : '';
  }

  itemImageUrl(item: WardrobeItemDto): string {
    return item.image.thumbnailUrl || item.image.displayUrl;
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
    return this.manualItemIds.length > 0;
  }

  get manualHint(): string {
    const selected = this.selectedManualItems();
    if (!selected.length) {
      return '';
    }

    if (!selected.some((item) => this.manualCategory(item) === 'footwear')) {
      return 'Partial look: add shoes later if you want this to be complete.';
    }

    if (!this.isValidManualOutfit(selected)) {
      return 'Partial look: this saves as selected, even if it is not a classic top-bottom, dress, or one-piece outfit.';
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
        return 'Generating...';
      case 'saved':
        return 'Saved';
      default:
        return outfit.isComplete ? 'Save outfit' : 'Save anyway';
    }
  }

  generatedSaveStatusMessage(outfit: GeneratedOutfitDto): string {
    switch (this.generatedSaveState(outfit)) {
      case 'saving':
        return `Generating image for "${outfit.title}"...`;
      case 'saved':
        return 'Saved to outfits.';
      case 'failed':
        return 'Could not save.';
      default:
        return '';
    }
  }

  missingCategorySummary(outfit: GeneratedOutfitDto): string {
    return outfit.missingCategories?.length ? outfit.missingCategories.join(', ') : '';
  }

  relaxedConstraintSummary(outfit: GeneratedOutfitDto): string {
    return outfit.relaxedConstraints?.length ? outfit.relaxedConstraints.join(' ') : '';
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

  private startProcessing(kind: BuilderProcessingKind): void {
    this.processingKind = kind;
    this.processingStepIndex = 0;
  }

  private setProcessingStep(index: number): void {
    if (!this.processingKind) {
      return;
    }

    this.processingStepIndex = Math.min(index, this.processingSteps.length - 1);
  }

  private stopProcessing(kind: BuilderProcessingKind): void {
    if (this.processingKind !== kind) {
      return;
    }

    this.processingKind = null;
    this.processingStepIndex = 0;
  }
}
