import { Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { ImageGenerationStreamUpdate, WardrobeItemDto, WardrobeLookupsDto } from '../../models';
import { ImageGenerationStatusStream, WardrobeApiService } from '../../wardrobe-api.service';
import {
  colourSwatch,
  isActivewearBottomSubcategory,
  isActivewearTopSubcategory,
  lookupLabel,
  readMessage
} from '../page-helpers';

@Component({
  selector: 'app-wardrobe',
  standalone: false,
  templateUrl: './wardrobe.page.html',
  styleUrls: ['./wardrobe.page.scss']
})
export class WardrobePage implements OnDestroy {
  private readonly api = inject(WardrobeApiService);
  @ViewChild(IonContent) private readonly content?: IonContent;
  @ViewChild('wardrobeGrid') private readonly wardrobeGrid?: ElementRef<HTMLElement>;
  items: WardrobeItemDto[] = [];
  lookups: WardrobeLookupsDto | null = null;
  categoryId: string | null = null;
  subcategoryId: string | null = null;
  colourId: string | null = null;
  patternId: string | null = null;
  visibleMaterialId: string | null = null;
  necklineId: string | null = null;
  sleeveLengthId: string | null = null;
  fitId: string | null = null;
  lengthId: string | null = null;
  bottomShapeId: string | null = null;
  riseId: string | null = null;
  includeArchived = false;
  filtersExpanded = false;
  search = '';
  isLoading = true;
  message = '';
  virtualStartIndex = 0;
  virtualEndIndex = 0;
  private loadDebounceHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly loadDebounceMs = 250;
  private readonly virtualColumns = 2;
  private readonly virtualRowHeight = 258;
  private readonly virtualOverscanRows = 3;
  private readonly firstPreloadItemCount = 2;
  private viewportHeight = 900;
  private activeLoad: Promise<void> | null = null;
  private hasPendingLoad = false;
  private hasPendingForceRefresh = false;
  private imageGenerationStatusStream: ImageGenerationStatusStream | null = null;
  private readonly itemImageGenerationPollingIntervalMs = 1800;
  private itemImageGenerationPollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingImageGeneration = false;

  get activeFilterSummary(): string {
    const filters: string[] = [];

    if (this.categoryId) {
      const category = this.lookups?.categories.find((option) => option.id === this.categoryId)?.label ?? this.categoryId;
      filters.push(`Category: ${category}`);
    }

    if (this.subcategoryId) {
      const current = this.subcategoryOptions.find((option) => option.id === this.subcategoryId);
      filters.push(`Subcategory: ${current?.label ?? this.subcategoryId}`);
    }

    if (this.colourId) {
      const colour = this.lookups?.colours.find((option) => option.id === this.colourId)?.label ?? this.colourId;
      filters.push(`Colour: ${colour}`);
    }

    if (this.patternId) {
      const pattern = this.lookups?.patterns.find((option) => option.id === this.patternId)?.label ?? this.patternId;
      filters.push(`Pattern: ${pattern}`);
    }

    if (this.includeArchived) {
      filters.push('Include archived');
    }

    const search = this.search.trim();
    if (search) {
      filters.push(`Search: ${search}`);
    }

    if (!filters.length) {
      return 'No filters selected.';
    }

    return filters.join(' · ');
  }

  get visibleItems(): WardrobeItemDto[] {
    return this.items.slice(this.virtualStartIndex, this.virtualEndIndex);
  }

  get virtualTopSpacerHeight(): number {
    return Math.floor(this.virtualStartIndex / this.virtualColumns) * this.virtualRowHeight;
  }

  get virtualBottomSpacerHeight(): number {
    const totalRows = Math.ceil(this.items.length / this.virtualColumns);
    const renderedEndRow = Math.ceil(this.virtualEndIndex / this.virtualColumns);
    return Math.max(0, (totalRows - renderedEndRow) * this.virtualRowHeight);
  }

  toggleFilters(): void {
    this.filtersExpanded = !this.filtersExpanded;
  }

  get hasFilters(): boolean {
    return !!(
      this.categoryId
      || this.subcategoryId
      || this.colourId
      || this.patternId
      || this.visibleMaterialId
      || this.necklineId
      || this.sleeveLengthId
      || this.fitId
      || this.lengthId
      || this.bottomShapeId
      || this.riseId
      || this.search.trim()
      || this.includeArchived
    );
  }

  get subcategoryOptions(): { id: string; label: string }[] {
    if (!this.lookups) {
      return [];
    }

    if (!this.categoryId) {
      return this.lookups.categories.reduce<{ id: string; label: string }[]>(
        (options, category) => options.concat(category.subcategories),
        []);
    }

    return this.lookups.categories.find((category) => category.id === this.categoryId)?.subcategories ?? [];
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  ngOnDestroy(): void {
    if (this.loadDebounceHandle) {
      clearTimeout(this.loadDebounceHandle);
    }
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();
  }

  async load(forceRefresh = false): Promise<void> {
    if (this.activeLoad) {
      this.hasPendingLoad = true;
      this.hasPendingForceRefresh = this.hasPendingForceRefresh || forceRefresh;
      return this.activeLoad;
    }

    do {
      forceRefresh = forceRefresh || this.hasPendingForceRefresh;
      this.hasPendingLoad = false;
      this.hasPendingForceRefresh = false;
      this.activeLoad = this.loadCore(forceRefresh);
      try {
        await this.activeLoad;
      } finally {
        this.activeLoad = null;
      }
      forceRefresh = false;
    } while (this.hasPendingLoad);
  }

  private async loadCore(forceRefresh: boolean): Promise<void> {
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();
    this.isLoading = true;
    this.message = '';
    try {
      const [lookups, items] = await Promise.all([
        this.lookups ? Promise.resolve(this.lookups) : this.api.getLookups(),
        this.api.getItems(this.buildItemFilterParams(), { forceRefresh })
      ]);
      this.lookups = lookups;
      this.items = items;
      this.resetVirtualWindow();
      await this.content?.scrollToTop(0);
      this.startImageGenerationStreaming();
    } catch (error) {
      this.message = readMessage(error, 'Could not load wardrobe. Please try again.');
      this.items = [];
      this.resetVirtualWindow();
    } finally {
      this.isLoading = false;
    }
  }

  onWardrobeScroll(event: CustomEvent<{ scrollTop: number }>): void {
    this.viewportHeight = Math.max(1, window.innerHeight || this.viewportHeight);
    this.updateVirtualWindow(event.detail.scrollTop);
  }

  private resetVirtualWindow(): void {
    this.virtualStartIndex = 0;
    this.virtualEndIndex = Math.min(this.items.length, this.virtualColumns * (Math.ceil(this.viewportHeight / this.virtualRowHeight) + this.virtualOverscanRows));
  }

  private updateVirtualWindow(scrollTop: number): void {
    if (!this.items.length) {
      this.virtualStartIndex = 0;
      this.virtualEndIndex = 0;
      return;
    }

    const gridOffsetTop = this.wardrobeGrid?.nativeElement.offsetTop ?? 0;
    const relativeScrollTop = Math.max(0, scrollTop - gridOffsetTop);
    const totalRows = Math.ceil(this.items.length / this.virtualColumns);
    const startRow = Math.max(0, Math.floor(relativeScrollTop / this.virtualRowHeight) - this.virtualOverscanRows);
    const visibleRows = Math.ceil(this.viewportHeight / this.virtualRowHeight) + this.virtualOverscanRows * 2;
    const endRow = Math.min(totalRows, startRow + visibleRows);

    this.virtualStartIndex = startRow * this.virtualColumns;
    this.virtualEndIndex = Math.min(this.items.length, endRow * this.virtualColumns);
  }

  private buildItemFilterParams(): Record<string, string | boolean> {
    return {
        categoryId: this.categoryId ?? '',
        subcategoryId: this.subcategoryId ?? '',
        colourId: this.colourId ?? '',
        patternId: this.patternId ?? '',
        visibleMaterialId: this.visibleMaterialId ?? '',
        necklineId: this.necklineId ?? '',
        sleeveLengthId: this.sleeveLengthId ?? '',
        fitId: this.fitId ?? '',
        lengthId: this.lengthId ?? '',
        bottomShapeId: this.bottomShapeId ?? '',
        riseId: this.riseId ?? '',
        search: this.search.trim(),
        includeArchived: this.includeArchived
      };
  }

  private startImageGenerationStreaming(): void {
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();

    if (!this.hasItemImageGenerationInProgress()) {
      return;
    }

    const trackingItemIds = this.items
      .filter((item) => this.isImageGenerationInProgress(item.imageGenerationStatus))
      .map((item) => item.id);

    const stream = this.api.streamImageGenerationStatuses(
      trackingItemIds,
      [],
      (updates) => this.applyImageGenerationStreamUpdates(updates),
      () => {
        this.imageGenerationStatusStream = null;
        this.startItemImageGenerationPolling();
      });

    if (stream === null) {
      this.startItemImageGenerationPolling();
      return;
    }

    this.imageGenerationStatusStream = stream;
  }

  private applyImageGenerationStreamUpdates(updates: ImageGenerationStreamUpdate[]): void {
    if (!updates.length || this.items.length === 0) {
      return;
    }

    const updateById = new Map<string, ImageGenerationStreamUpdate>(updates.filter((update) => update.kind === 'item').map((update) => [update.id, update]));
    this.items = this.items.map((item) => {
      const update = updateById.get(item.id);
      if (!update || update.status === item.imageGenerationStatus) {
        return item;
      }

      return { ...item, imageGenerationStatus: update.status };
    });

    if (!this.hasItemImageGenerationInProgress()) {
      this.stopItemImageGenerationStreaming();
      void this.refreshWardrobeItemsAfterImageGeneration();
    }
  }

  private async refreshWardrobeItemsAfterImageGeneration(): Promise<void> {
    try {
      this.items = await this.api.getItems(this.buildItemFilterParams(), { forceRefresh: true });
    } catch {
      // Ignore temporary network issues after image generation completes.
    }
  }

  private stopItemImageGenerationStreaming(): void {
    if (this.imageGenerationStatusStream) {
      this.imageGenerationStatusStream.close();
    }
    this.imageGenerationStatusStream = null;
  }

  private startItemImageGenerationPolling(): void {
    if (!this.hasItemImageGenerationInProgress()) {
      return;
    }

    this.itemImageGenerationPollTimeout = setTimeout(() => {
      void this.refreshItemImageGenerationStatuses();
    }, this.itemImageGenerationPollingIntervalMs);
  }

  private async refreshItemImageGenerationStatuses(): Promise<void> {
    if (this.isRefreshingImageGeneration) {
      this.startItemImageGenerationPolling();
      return;
    }

    if (!this.hasItemImageGenerationInProgress()) {
      return;
    }

    this.isRefreshingImageGeneration = true;
    try {
      this.items = await this.api.getItems(this.buildItemFilterParams(), { forceRefresh: true });
    } catch {
      // Ignore temporary network issues while polling for image-generation states.
    } finally {
      this.isRefreshingImageGeneration = false;
      this.startItemImageGenerationPolling();
    }
  }

  private stopItemImageGenerationPolling(): void {
    if (this.itemImageGenerationPollTimeout) {
      clearTimeout(this.itemImageGenerationPollTimeout);
    }
    this.itemImageGenerationPollTimeout = null;
    this.isRefreshingImageGeneration = false;
  }

  private hasItemImageGenerationInProgress(): boolean {
    return this.items.some((item) => this.isImageGenerationInProgress(item.imageGenerationStatus));
  }

  setCategory(categoryId: string | null): void {
    this.categoryId = categoryId;
    this.subcategoryId = null;
    this.scheduleLoad();
  }

  setSubcategory(subcategoryId: string | null): void {
    this.subcategoryId = subcategoryId;
    this.scheduleLoad();
  }

  setColour(colourId: string | null): void {
    this.colourId = colourId;
    this.scheduleLoad();
  }

  setPattern(patternId: string | null): void {
    this.patternId = patternId;
    this.scheduleLoad();
  }

  setIncludeArchived(includeArchived: boolean): void {
    this.includeArchived = includeArchived;
    this.scheduleLoad();
  }

  clearFilters(): void {
    this.categoryId = null;
    this.subcategoryId = null;
    this.colourId = null;
    this.patternId = null;
    this.visibleMaterialId = null;
    this.necklineId = null;
    this.sleeveLengthId = null;
    this.fitId = null;
    this.lengthId = null;
    this.bottomShapeId = null;
    this.riseId = null;
    this.includeArchived = false;
    this.search = '';
    this.filtersExpanded = false;
    this.scheduleLoad();
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

  trackById(_: number, item: WardrobeItemDto): string {
    return item.id;
  }

  wardrobeImageUrl(item: WardrobeItemDto): string {
    return item.image.thumbnailUrl || item.image.displayUrl;
  }

  shouldPrioritiseImage(index: number): boolean {
    return this.virtualStartIndex + index < this.firstPreloadItemCount;
  }

  imageGenerationMessage(item: WardrobeItemDto): string | null {
    switch (item.imageGenerationStatus) {
      case 'queued':
        return 'Image generation queued...';
      case 'generating':
        return 'Generating polished image...';
      case 'failed':
        return 'Image generation failed.';
      default:
        return null;
    }
  }

  isImageGenerationInProgress(status: string | null): boolean {
    return status === 'queued' || status === 'generating';
  }

  scheduleLoad(): void {
    if (this.loadDebounceHandle) {
      clearTimeout(this.loadDebounceHandle);
    }

    this.loadDebounceHandle = setTimeout(() => {
      this.loadDebounceHandle = null;
      void this.load();
    }, this.loadDebounceMs);
  }
}
