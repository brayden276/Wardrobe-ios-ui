import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { GeneratedOutfitDto, OutfitDto, WardrobeItemDto, WardrobeLookupsDto } from '../../models';
import { WardrobeApiService } from '../../wardrobe-api.service';
import {
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

interface BuilderItemCard {
  item: WardrobeItemDto;
  imageUrl: string;
  label: string;
  colours: string[];
  isRequired: boolean;
  isManualSelected: boolean;
}

interface GeneratedOutfitCard {
  outfit: GeneratedOutfitDto;
  key: string;
  imageUrl: string | null;
  isPriority: boolean;
  saveState: GeneratedOutfitSaveState;
  saveLabel: string;
  saveStatusMessage: string;
  missingCategorySummary: string;
  relaxedConstraintSummary: string;
  itemNames: string[];
  items: WardrobeItemDto[];
  isWornToday?: boolean;
}

@Component({
  selector: 'app-builder',
  standalone: false,
  templateUrl: './builder.page.html',
  styleUrls: ['./builder.page.scss']
})
export class BuilderPage {
  private readonly api = inject(WardrobeApiService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly router = inject(Router);
  builderMode: BuilderMode = 'generate';
  query = '';
  readonly occasionOptions = ['Work', 'Dinner', 'Brunch', 'Weekend'];
  readonly dressCodeOptions = ['Smart casual', 'Relaxed', 'Polished', 'Active'];
  readonly avoidOptions = ['No heels', 'No jacket', 'No dress'];
  occasion = 'Dinner';
  dressCode = 'Smart casual';
  selectedAvoids: string[] = [];
  requiredItemId: string | null = null;
  manualName = 'Manual outfit';
  manualItemIds: string[] = [];
  manualCanSave = false;
  manualHint = '';
  wardrobeHint = '';
  items: WardrobeItemDto[] = [];
  results: GeneratedOutfitDto[] = [];
  lookups: WardrobeLookupsDto | null = null;
  lastGeneratedPrompt = '';
  message = '';
  isLoadingWardrobe = false;
  isBuildingOutfits = false;
  isSavingManualOutfit = false;
  hasGeneratedSearchRun = false;
  private savingGeneratedOutfitKeys = new Set<string>();
  private savedGeneratedOutfitKeys = new Set<string>();
  private savedGeneratedOutfits = new Map<string, OutfitDto>();
  private wornGeneratedOutfitKeys = new Set<string>();
  private failedGeneratedOutfitKeys = new Set<string>();
  private readonly builderItemRenderIncrement = 60;
  private readonly generatedOutfitImagePreloadLimit = 4;
  visibleBuilderItemCount = this.builderItemRenderIncrement;
  includeItems: BuilderItemCard[] = [];
  manualItems: BuilderItemCard[] = [];
  resultCards: GeneratedOutfitCard[] = [];
  private itemById = new Map<string, WardrobeItemDto>();
  private itemNameById = new Map<string, string>();
  private manualItemIdSet = new Set<string>();

  get isBusy(): boolean {
    return this.isLoadingWardrobe
      || this.isBuildingOutfits
      || this.isSavingManualOutfit
      || this.savingGeneratedOutfitKeys.size > 0;
  }

  get canShowMoreBuilderItems(): boolean {
    return this.visibleBuilderItemCount < this.items.length;
  }

  showMoreBuilderItems(): void {
    this.visibleBuilderItemCount = Math.min(this.items.length, this.visibleBuilderItemCount + this.builderItemRenderIncrement);
    this.updateBuilderItemViews();
  }

  get canGenerate(): boolean {
    return !this.isLoadingWardrobe && this.items.length > 0 && !!this.buildOutfitQuery();
  }

  get loadingStatus(): string {
    if (this.requiredItemId) {
      return `Matching outfits with ${this.itemNameById.get(this.requiredItemId) ?? 'Wardrobe item'}...`;
    }

    return 'Building outfit suggestions...';
  }

  isAnchorPickerOpen = false;

  get requiredItem(): WardrobeItemDto | null {
    return this.requiredItemId ? this.itemById.get(this.requiredItemId) ?? null : null;
  }

  openAnchorPicker(): void {
    this.isAnchorPickerOpen = true;
    void lightImpact();
  }

  closeAnchorPicker(): void {
    this.isAnchorPickerOpen = false;
  }

  selectAnchorItem(item: WardrobeItemDto): void {
    this.selectRequiredItem(item.id);
    this.closeAnchorPicker();
    void lightImpact();
  }

  applyPromptInspiration(text: string): void {
    this.query = text;
    void lightImpact();
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  async ionViewWillEnter(): Promise<void> {
    this.message = '';
    this.isLoadingWardrobe = true;
    try {
      const [lookups, items] = await Promise.all([
        this.lookups ? Promise.resolve(this.lookups) : this.api.getLookups(),
        this.api.getItems()
      ]);
      this.lookups = lookups;
      this.items = items;
      this.rebuildItemIndexes();
      this.pruneBuilderSelections();
      this.updateBuilderItemViews();
    } catch (error) {
      this.message = readMessage(error, 'Could not load wardrobe items.');
    } finally {
      this.isLoadingWardrobe = false;
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
    this.updateBuilderItemViews();
    void lightImpact();
  }

  clearRequiredItem(): void {
    this.requiredItemId = null;
    this.updateBuilderItemViews();
  }

  toggleManualItem(id: string): void {
    if (this.manualItemIdSet.has(id)) {
      this.manualItemIds = this.manualItemIds.filter((value) => value !== id);
      this.manualItemIdSet.delete(id);
      this.updateBuilderItemViews();
      void lightImpact();
      return;
    }

    this.manualItemIds = [...this.manualItemIds, id];
    this.manualItemIdSet.add(id);
    this.updateBuilderItemViews();
    void lightImpact();
  }

  clearManualSelection(): void {
    this.manualItemIds = [];
    this.manualItemIdSet.clear();
    this.updateBuilderItemViews();
  }

  selectAllItems(): void {
    this.manualItemIds = this.items.map((item) => item.id);
    this.manualItemIdSet = new Set(this.manualItemIds);
    this.updateBuilderItemViews();
  }

  toggleSelectAllManual(): void {
    if (this.manualItemIds.length === this.items.length && this.items.length > 0) {
      this.clearManualSelection();
    } else {
      this.selectAllItems();
    }
  }

  clearResults(): void {
    this.results = [];
    this.resultCards = [];
  }

  async search(): Promise<void> {
    if (this.isBusy || !this.canGenerate) {
      return;
    }

    this.isBuildingOutfits = true;
    this.message = '';
    const prompt = this.buildOutfitQuery();
    const requiredItemId = this.requiredItemId;
    try {
      if (!await ensureAiConsentWithAlert(
        this.alertController,
        'Wardrobe AI uses Google Gemini to interpret your outfit request and generate outfit suggestions from your wardrobe. Do you want to continue with AI processing for this device?')) {
        this.message = 'Gemini consent is required before Wardrobe AI can build outfit suggestions.';
        void warningFeedback();
        return;
      }
      this.hasGeneratedSearchRun = true;
      const [lookups, items] = await Promise.all([
        this.lookups ? Promise.resolve(this.lookups) : this.api.getLookups(),
        this.api.getItems()
      ]);
      this.lookups = lookups;
      this.items = items;
      this.rebuildItemIndexes();
      this.pruneBuilderSelections();
      this.updateBuilderItemViews();
      const generatedOutfits = await this.api.searchOutfits(prompt, requiredItemId);
      const readyOutfits = generatedOutfits.filter((outfit) => !!outfit.displayImageUrl || !!outfit.imageUrl);
      if (readyOutfits.length) {
        void this.preloadGeneratedOutfitImages(readyOutfits);
      }
      this.lastGeneratedPrompt = prompt;
      this.savedGeneratedOutfitKeys.clear();
      this.savedGeneratedOutfits.clear();
      this.wornGeneratedOutfitKeys.clear();
      this.failedGeneratedOutfitKeys.clear();
      this.results = generatedOutfits;
      this.updateGeneratedOutfitCards();
      void lightImpact();
    } catch (error) {
      this.message = readMessage(error, 'Could not build an outfit from the current wardrobe.');
      void warningFeedback();
    } finally {
      this.isBuildingOutfits = false;
    }
  }

  async saveManual(): Promise<void> {
    if (this.isBusy) return;
    if (!this.manualCanSave) {
      this.message = this.manualHint || 'Add more clothing items to build complete outfits.';
      return;
    }

    this.isSavingManualOutfit = true;
    const selectedIds = [...this.manualItemIds];
    const selectedName = this.manualName;
    this.message = '';
    try {
      const selected = this.selectedManualItems();
      const explanation = this.isValidManualOutfit(selected)
        ? 'Built manually from selected wardrobe items.'
        : `Saved as a partial manual look from selected wardrobe items. ${this.manualHint}`;
      const saved = await this.api.saveOutfit(selectedName.trim() || 'Manual outfit', null, explanation.trim(), selectedIds);
      this.message = saved.imageUrl ? 'Outfit saved.' : 'Outfit saved. Its preview will appear in your lookbook when ready.';
      void successFeedback();
      this.manualItemIds = this.manualItemIds.filter(id => !selectedIds.includes(id));
      this.manualItemIdSet = new Set(this.manualItemIds);
      if (this.manualName === selectedName) this.manualName = 'Manual outfit';
      this.updateBuilderItemViews();
      const toast = await this.toastController.create({
        message: 'Outfit saved to lookbook.',
        duration: 3500,
        position: 'bottom',
        buttons: [
          {
            text: 'View',
            handler: () => {
              void this.router.navigate(['/tabs/outfits']);
            }
          }
        ]
      });
      await toast.present();
    } catch (error) {
      this.message = readMessage(error, 'Could not save outfit.');
      void warningFeedback();
    } finally {
      this.isSavingManualOutfit = false;
    }
  }

  async save(outfit: GeneratedOutfitDto): Promise<void> {
    const key = this.generatedOutfitKey(outfit);
    if (this.isBuildingOutfits || this.savingGeneratedOutfitKeys.has(key) || this.savedGeneratedOutfitKeys.has(key)) {
      return;
    }

    this.savingGeneratedOutfitKeys.add(key);
    this.savedGeneratedOutfitKeys.delete(key);
    this.failedGeneratedOutfitKeys.delete(key);
    this.updateGeneratedOutfitCards();
    this.message = '';
    try {
      await this.getOrSaveGeneratedOutfit(outfit, key);
      this.updateGeneratedOutfitCards();
      void successFeedback();
    } catch (error) {
      this.failedGeneratedOutfitKeys.add(key);
      this.updateGeneratedOutfitCards();
      this.message = readMessage(error, 'Could not save outfit.');
      void warningFeedback();
    } finally {
      this.savingGeneratedOutfitKeys.delete(key);
      this.updateGeneratedOutfitCards();
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
    return this.itemNameById.get(id) ?? 'Wardrobe item';
  }

  label(id: string | null): string {
    if (!id || !this.lookups) return '';
    return lookupLabel(this.lookups, id);
  }

  coloursFor(item: WardrobeItemDto): string[] {
    return [item.primaryColourId, ...(item.secondaryColourIds ?? [])].filter(Boolean).slice(0, 4);
  }


  isManualSelected(id: string): boolean {
    return this.manualItemIdSet.has(id);
  }

  private buildManualHint(): string {
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
      .map((id) => this.itemById.get(id))
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

  trackByItemCardId(_: number, card: BuilderItemCard): string {
    return card.item.id;
  }

  trackByGeneratedOutfitKey(_: number, card: GeneratedOutfitCard): string {
    return card.key;
  }

  trackByValue(_: number, value: string): string {
    return value;
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

  shouldPrioritiseGeneratedOutfit(index: number): boolean {
    return index < this.generatedOutfitImagePreloadLimit;
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

  private async preloadGeneratedOutfitImages(outfits: GeneratedOutfitDto[]): Promise<void> {
    const imageUrls = outfits
      .map((outfit) => outfit.displayImageUrl || outfit.imageUrl)
      .filter((url): url is string => !!url)
      .slice(0, this.generatedOutfitImagePreloadLimit);

    await Promise.all(imageUrls.map((url) => this.preloadImage(url)));
  }

  private preloadImage(url: string): Promise<void> {
    return new Promise((resolve) => {
      const image = new Image();
      let isFinished = false;
      let timeoutId = 0;
      const finish = (): void => {
        if (isFinished) {
          return;
        }

        isFinished = true;
        window.clearTimeout(timeoutId);
        resolve();
      };
      const decodeThenFinish = (): void => {
        if (typeof image.decode !== 'function') {
          finish();
          return;
        }

        image.decode().then(finish).catch(finish);
      };

      timeoutId = window.setTimeout(finish, 8000);
      image.onload = decodeThenFinish;
      image.onerror = finish;
      image.src = url;

      if (image.complete && image.naturalWidth > 0) {
        decodeThenFinish();
      }
    });
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

  private rebuildItemIndexes(): void {
    this.itemById = new Map(this.items.map((item) => [item.id, item]));
    this.itemNameById = new Map(this.items.map((item) => [item.id, item.name]));
    const categories = new Set(this.items.map((item) => item.categoryId === 'shoes' ? 'footwear' : this.manualCategory(item)));
    const hasBase = categories.has('dresses') || categories.has('one_pieces')
      || (categories.has('tops') && categories.has('bottoms'));
    if (!this.items.length || (hasBase && categories.has('footwear'))) {
      this.wardrobeHint = '';
    } else {
      const missing = [
        ...(!hasBase ? [categories.has('tops') ? 'bottoms or a dress' : categories.has('bottoms') ? 'a top or a dress' : 'a top and bottoms, or a dress'] : []),
        ...(!categories.has('footwear') ? ['shoes'] : [])
      ];
      this.wardrobeHint = `For a complete look, add ${missing.join(' and ')}. You can still use the pieces you have or save a partial look in Manual Canvas.`;
    }
  }

  private pruneBuilderSelections(): void {
    this.manualItemIds = this.manualItemIds.filter((id) => this.itemById.has(id));
    this.manualItemIdSet = new Set(this.manualItemIds);
    if (this.requiredItemId && !this.itemById.has(this.requiredItemId)) {
      this.requiredItemId = null;
    }
  }

  private updateBuilderItemViews(): void {
    const visibleItems = this.items.slice(0, this.visibleBuilderItemCount);
    const includeItems = this.requiredItemId && !visibleItems.some((item) => item.id === this.requiredItemId)
      ? [this.itemById.get(this.requiredItemId), ...visibleItems].filter((item): item is WardrobeItemDto => !!item)
      : visibleItems;

    const visibleIds = new Set(visibleItems.map((item) => item.id));
    const selectedOutsideVisibleRange = this.manualItemIds
      .map((id) => this.itemById.get(id))
      .filter((item): item is WardrobeItemDto => !!item && !visibleIds.has(item.id))
      .slice(0, 20);
    const manualItems = this.manualItemIds.length
      ? [...selectedOutsideVisibleRange, ...visibleItems]
      : visibleItems;

    this.includeItems = includeItems.map((item) => this.toBuilderItemCard(item));
    this.manualItems = manualItems.map((item) => this.toBuilderItemCard(item));
    this.manualCanSave = this.manualItemIds.length > 0;
    this.manualHint = this.buildManualHint();
  }

  private toBuilderItemCard(item: WardrobeItemDto): BuilderItemCard {
    return {
      item,
      imageUrl: this.itemImageUrl(item),
      label: this.label(item.subcategoryId),
      colours: this.coloursFor(item),
      isRequired: this.requiredItemId === item.id,
      isManualSelected: this.manualItemIdSet.has(item.id)
    };
  }

  private updateGeneratedOutfitCards(): void {
    this.resultCards = this.results.map((outfit, index) => {
      const saveState = this.generatedSaveState(outfit);
      return {
        outfit,
        key: this.generatedOutfitKey(outfit),
        imageUrl: outfit.displayImageUrl || outfit.imageUrl,
        isPriority: index < this.generatedOutfitImagePreloadLimit,
        saveState,
        saveLabel: this.generatedSaveLabelForState(outfit, saveState),
        saveStatusMessage: this.generatedSaveStatusMessageForState(outfit, saveState),
        isWornToday: this.wornGeneratedOutfitKeys.has(this.generatedOutfitKey(outfit)),
        missingCategorySummary: this.missingCategorySummary(outfit),
        relaxedConstraintSummary: this.relaxedConstraintSummary(outfit),
        itemNames: outfit.itemIds.map((id) => this.nameFor(id)),
        items: outfit.itemIds.map((id) => this.itemById.get(id)).filter(Boolean) as WardrobeItemDto[]
      };
    });
  }

  async wearGeneratedOutfit(card: GeneratedOutfitCard): Promise<void> {
    const key = card.key;
    if (this.isBuildingOutfits || this.savingGeneratedOutfitKeys.has(key) || this.wornGeneratedOutfitKeys.has(key)) return;
    this.savingGeneratedOutfitKeys.add(key);
    this.updateGeneratedOutfitCards();
    try {
      const saved = await this.getOrSaveGeneratedOutfit(card.outfit, key);
      await this.api.markWorn(saved.id);
      this.wornGeneratedOutfitKeys.add(key);
      void successFeedback();
    } catch (error) {
      if (!this.savedGeneratedOutfits.has(key)) this.failedGeneratedOutfitKeys.add(key);
      this.message = readMessage(error, 'Could not log outfit as worn.');
      void warningFeedback();
    } finally {
      this.savingGeneratedOutfitKeys.delete(key);
      this.updateGeneratedOutfitCards();
    }
  }

  private async getOrSaveGeneratedOutfit(outfit: GeneratedOutfitDto, key: string): Promise<OutfitDto> {
    const existing = this.savedGeneratedOutfits.get(key);
    if (existing) return existing;
    const saved = await this.api.saveOutfit(
      outfit.title, this.lastGeneratedPrompt || this.buildOutfitQuery(), outfit.explanation,
      outfit.itemIds, outfit.imageUrl || outfit.displayImageUrl || null);
    if (!saved?.id) throw new Error('Could not confirm the saved outfit. Check your lookbook before saving again.');
    this.savedGeneratedOutfits.set(key, saved);
    this.savedGeneratedOutfitKeys.add(key);
    this.failedGeneratedOutfitKeys.delete(key);
    return saved;
  }

  private generatedSaveLabelForState(outfit: GeneratedOutfitDto, saveState: GeneratedOutfitSaveState): string {
    switch (saveState) {
      case 'saving':
        return 'Saving...';
      case 'saved':
        return 'Saved';
      default:
        return outfit.isComplete ? 'Save outfit' : 'Save anyway';
    }
  }

  private generatedSaveStatusMessageForState(outfit: GeneratedOutfitDto, saveState: GeneratedOutfitSaveState): string {
    switch (saveState) {
      case 'saving':
        return `Saving "${outfit.title}"...`;
      case 'saved':
        return this.wornGeneratedOutfitKeys.has(this.generatedOutfitKey(outfit)) ? 'Worn today.' : 'Saved to outfits.';
      case 'failed':
        return 'Could not save.';
      default:
        return '';
    }
  }

  viewGarmentDetail(itemId: string): void {
    void lightImpact();
    void this.router.navigate(['/tabs/wardrobe', itemId]);
  }
}
