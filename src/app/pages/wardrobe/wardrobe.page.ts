import { AfterViewChecked, AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ActionSheetController, AlertController, IonContent, ToastController } from '@ionic/angular';
import { ImageGenerationStreamUpdate, LookupOptionDto, WardrobeItemDto, WardrobeLookupsDto } from '../../models';
import { ImageGenerationStatusStream, WardrobeApiService } from '../../wardrobe-api.service';
import {
  confirmAction,
  colourSwatch,
  lightImpact,
  lookupLabel,
  noticeKind,
  NoticeKind,
  readMessage,
  successFeedback,
  warningFeedback
} from '../page-helpers';

interface WardrobeItemCard {
  item: WardrobeItemDto;
  imageUrl: string;
  label: string;
  colours: string[];
  statusMessage: string | null;
  isStatusInProgress: boolean;
  isPriorityImage: boolean;
  isSelected: boolean;
}

@Component({
  selector: 'app-wardrobe',
  standalone: false,
  templateUrl: './wardrobe.page.html',
  styleUrls: ['./wardrobe.page.scss']
})
export class WardrobePage implements AfterViewChecked, AfterViewInit, OnDestroy {
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alertController = inject(AlertController);
  private readonly actionSheetController = inject(ActionSheetController);
  private readonly toastController = inject(ToastController);
  private readonly zone = inject(NgZone);
  @ViewChild(IonContent) private readonly content?: IonContent;
  @ViewChild(IonContent, { read: ElementRef }) private readonly contentElement?: ElementRef<HTMLElement>;
  @ViewChild('wardrobeGrid') private readonly wardrobeGrid?: ElementRef<HTMLElement>;
  readonly skeletonPlaceholders = [0, 1, 2, 3, 4, 5];
  isFilterModalOpen = false;
  items: WardrobeItemDto[] = [];
  visibleItems: WardrobeItemDto[] = [];
  visibleItemCards: WardrobeItemCard[] = [];
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
  search = '';
  isLoading = true;
  message = '';
  isSelectionMode = false;
  isDeletingSelected = false;
  selectedItemIds = new Set<string>();
  virtualStartIndex = 0;
  virtualEndIndex = 0;
  virtualTopSpacerHeight = 0;
  virtualBottomSpacerHeight = 0;
  activeFilterSummary = 'No filters selected.';
  hasFilters = false;
  subcategoryOptions: LookupOptionDto[] = [];
  isLoadingMore = false;
  canLoadMore = false;
  private loadDebounceHandle: ReturnType<typeof setTimeout> | null = null;
  private virtualMetricsHandle: ReturnType<typeof requestAnimationFrame> | null = null;
  private wardrobeScrollHandle: ReturnType<typeof requestAnimationFrame> | null = null;
  private removeWardrobeScrollListener: (() => void) | null = null;
  private readonly loadDebounceMs = 250;
  private virtualColumns = 2;
  private virtualRowHeight = 258;
  private readonly virtualOverscanRows = 3;
  private readonly firstPreloadItemCount = 2;
  private readonly wardrobePageSize = 60;
  private viewportHeight = 900;
  private wardrobeScrollTop = 0;
  private pendingVirtualMetricsSync = true;
  private activeLoad: Promise<void> | null = null;
  private hasPendingLoad = false;
  private hasPendingForceRefresh = false;
  private hasPendingResetScroll = false;
  private imageGenerationStatusStream: ImageGenerationStatusStream | null = null;
  private readonly itemImageGenerationPollingIntervalMs = 1800;
  private itemImageGenerationPollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingImageGeneration = false;
  private itemLongPressHandle: ReturnType<typeof setTimeout> | null = null;
  private suppressNextItemClick = false;
  private readonly selectionLongPressMs = 450;
  private pointerStartX = 0;
  private pointerStartY = 0;

  get loadingMessage(): string {
    return this.items.length ? 'Refreshing wardrobe...' : 'Loading wardrobe...';
  }

  get selectedCount(): number {
    return this.selectedItemIds.size;
  }

  get activeFilterCount(): number {
    let count = 0;
    if (this.colourId) count++;
    if (this.patternId) count++;
    if (this.visibleMaterialId) count++;
    if (this.necklineId) count++;
    if (this.sleeveLengthId) count++;
    if (this.fitId) count++;
    if (this.lengthId) count++;
    if (this.bottomShapeId) count++;
    if (this.riseId) count++;
    if (this.includeArchived) count++;
    return count;
  }

  get isAllVisibleSelected(): boolean {
    return this.items.length > 0 && this.items.every((item) => this.selectedItemIds.has(item.id));
  }

  toggleSelectAll(): void {
    if (this.isAllVisibleSelected) {
      this.clearSelection();
    } else {
      for (const item of this.items) {
        this.selectedItemIds.add(item.id);
      }
      this.updateVisibleItemCards();
    }
    void lightImpact();
  }

  openFilterModal(): void {
    this.isFilterModalOpen = true;
    void lightImpact();
  }

  closeFilterModal(): void {
    this.isFilterModalOpen = false;
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  get canRetryMessage(): boolean {
    return this.messageKind === 'error' || this.messageKind === 'offline';
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.scheduleVirtualMetricsSync();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
    if (this.hasItemImageGenerationInProgress()) {
      this.startImageGenerationStreaming();
    }

    const newlyAddedParam = this.route.snapshot.queryParamMap.get('newlyAddedCount');
    if (newlyAddedParam) {
      const count = parseInt(newlyAddedParam, 10);
      if (count > 0) {
        void this.showNewlyAddedToast(count);
        void this.router.navigate([], { queryParams: {}, replaceUrl: true });
      }
    }
  }

  private async showNewlyAddedToast(count: number): Promise<void> {
    const toast = await this.toastController.create({
      message: count === 1 ? '✨ 1 garment added to your wardrobe' : `✨ ${count} garments added from your photo`,
      duration: 3000,
      position: 'bottom',
      color: 'dark'
    });
    await toast.present();
  }

  ionViewWillLeave(): void {
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();
  }

  ionViewDidLeave(): void {
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      const element = this.contentElement?.nativeElement;
      if (!element) {
        return;
      }

      const listener = (event: Event): void => {
        this.queueWardrobeScroll((event as CustomEvent<{ scrollTop: number }>).detail.scrollTop);
      };
      element.addEventListener('ionScroll', listener);
      this.removeWardrobeScrollListener = () => element.removeEventListener('ionScroll', listener);
    });
  }

  ngAfterViewChecked(): void {
    if (this.pendingVirtualMetricsSync) {
      this.scheduleVirtualMetricsSync();
    }
  }

  ngOnDestroy(): void {
    if (this.loadDebounceHandle) {
      clearTimeout(this.loadDebounceHandle);
    }
    if (this.virtualMetricsHandle !== null) {
      cancelAnimationFrame(this.virtualMetricsHandle);
    }
    if (this.wardrobeScrollHandle !== null) {
      cancelAnimationFrame(this.wardrobeScrollHandle);
    }
    this.removeWardrobeScrollListener?.();
    this.clearItemLongPress();
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();
  }

  async refreshWardrobe(event: Event): Promise<void> {
    try {
      await this.load(true, true);
    } finally {
      (event.target as { complete?: () => void } | null)?.complete?.();
    }
  }

  async load(forceRefresh = false, resetScroll = false): Promise<void> {
    if (this.activeLoad) {
      this.hasPendingLoad = true;
      this.hasPendingForceRefresh = this.hasPendingForceRefresh || forceRefresh;
      this.hasPendingResetScroll = this.hasPendingResetScroll || resetScroll;
      return this.activeLoad;
    }

    do {
      forceRefresh = forceRefresh || this.hasPendingForceRefresh;
      resetScroll = resetScroll || this.hasPendingResetScroll;
      this.hasPendingLoad = false;
      this.hasPendingForceRefresh = false;
      this.hasPendingResetScroll = false;
      this.activeLoad = this.loadCore(forceRefresh, resetScroll);
      try {
        await this.activeLoad;
      } finally {
        this.activeLoad = null;
      }
      forceRefresh = false;
      resetScroll = false;
    } while (this.hasPendingLoad);
  }

  private async loadCore(forceRefresh: boolean, resetScroll: boolean): Promise<void> {
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();
    this.isLoading = true;
    this.message = '';
    const hadLoadedItems = this.items.length > 0;
    try {
      const [lookups, items] = await Promise.all([
        this.lookups ? Promise.resolve(this.lookups) : this.api.getLookups(),
        this.api.getItems(this.buildPagedItemFilterParams(0), { forceRefresh })
      ]);
      this.lookups = lookups;
      this.items = items;
      this.canLoadMore = items.length === this.wardrobePageSize;
      this.updateFilterDerivedState();
      this.pruneSelectedItems();
      if (resetScroll || !hadLoadedItems) {
        this.resetVirtualWindow();
        await this.content?.scrollToTop(0);
        this.wardrobeScrollTop = 0;
      } else {
        this.updateVirtualWindow(this.wardrobeScrollTop, true);
      }
      this.startImageGenerationStreaming();
    } catch (error) {
      this.message = hadLoadedItems
        ? `${readMessage(error, 'Could not refresh wardrobe. Please try again.')} Showing last loaded wardrobe items.`
        : readMessage(error, 'Could not load wardrobe. Please try again.');
      this.canLoadMore = false;
      if (!hadLoadedItems) {
        this.items = [];
        this.resetVirtualWindow();
      }
    } finally {
      this.isLoading = false;
      this.scheduleVirtualMetricsSync();
    }
  }

  private queueWardrobeScroll(scrollTop: number): void {
    this.wardrobeScrollTop = scrollTop;
    if (this.wardrobeScrollHandle !== null) {
      return;
    }

    this.wardrobeScrollHandle = requestAnimationFrame(() => {
      this.wardrobeScrollHandle = null;
      if (!this.hasVirtualWindowChange(this.wardrobeScrollTop)) {
        return;
      }

      this.zone.run(() => {
        this.updateVirtualWindow(this.wardrobeScrollTop);
      });
    });
  }

  private resetVirtualWindow(): void {
    this.pendingVirtualMetricsSync = true;
    this.virtualStartIndex = 0;
    this.virtualEndIndex = Math.min(this.items.length, this.virtualColumns * (Math.ceil(this.viewportHeight / this.virtualRowHeight) + this.virtualOverscanRows));
    this.updateVirtualSpacerHeights();
    this.updateVisibleItemCards();
  }

  private scheduleVirtualMetricsSync(): void {
    this.pendingVirtualMetricsSync = true;
    if (this.virtualMetricsHandle !== null) {
      return;
    }

    this.virtualMetricsHandle = requestAnimationFrame(() => {
      this.virtualMetricsHandle = null;
      this.syncVirtualMetrics();
      this.pendingVirtualMetricsSync = false;
    });
  }

  private syncVirtualMetrics(): void {
    this.viewportHeight = Math.max(1, window.innerHeight || this.viewportHeight);
    const grid = this.wardrobeGrid?.nativeElement;
    if (!grid) {
      this.updateVirtualWindow(this.wardrobeScrollTop);
      return;
    }

    const styles = window.getComputedStyle(grid);
    const columnCount = styles.gridTemplateColumns
      .split(' ')
      .filter((value) => value && value !== 'none')
      .length;
    if (columnCount > 0) {
      this.virtualColumns = columnCount;
    }

    const firstCard = grid.querySelector<HTMLElement>('.item-card');
    if (firstCard) {
      const rowGap = Number.parseFloat(styles.rowGap || '0') || 0;
      const cardHeight = firstCard.getBoundingClientRect().height;
      if (cardHeight > 0) {
        this.virtualRowHeight = Math.max(1, Math.ceil(cardHeight + rowGap));
      }
    }

    this.updateVirtualWindow(this.wardrobeScrollTop);
  }

  private updateVirtualWindow(scrollTop: number, force = false): void {
    if (!this.items.length) {
      this.virtualStartIndex = 0;
      this.virtualEndIndex = 0;
      this.updateVirtualSpacerHeights();
      this.updateVisibleItemCards();
      return;
    }

    const gridOffsetTop = this.wardrobeGrid?.nativeElement.offsetTop ?? 0;
    const relativeScrollTop = Math.max(0, scrollTop - gridOffsetTop);
    const totalRows = Math.ceil(this.items.length / this.virtualColumns);
    const startRow = Math.max(0, Math.floor(relativeScrollTop / this.virtualRowHeight) - this.virtualOverscanRows);
    const visibleRows = Math.ceil(this.viewportHeight / this.virtualRowHeight) + this.virtualOverscanRows * 2;
    const endRow = Math.min(totalRows, startRow + visibleRows);
    const nextStartIndex = startRow * this.virtualColumns;
    const nextEndIndex = Math.min(this.items.length, endRow * this.virtualColumns);

    if (!force && this.virtualStartIndex === nextStartIndex && this.virtualEndIndex === nextEndIndex) {
      return;
    }

    this.virtualStartIndex = nextStartIndex;
    this.virtualEndIndex = nextEndIndex;
    this.updateVirtualSpacerHeights();
    this.updateVisibleItemCards();
  }

  private hasVirtualWindowChange(scrollTop: number): boolean {
    if (!this.items.length) {
      return this.virtualStartIndex !== 0 || this.virtualEndIndex !== 0;
    }

    const gridOffsetTop = this.wardrobeGrid?.nativeElement.offsetTop ?? 0;
    const relativeScrollTop = Math.max(0, scrollTop - gridOffsetTop);
    const totalRows = Math.ceil(this.items.length / this.virtualColumns);
    const startRow = Math.max(0, Math.floor(relativeScrollTop / this.virtualRowHeight) - this.virtualOverscanRows);
    const visibleRows = Math.ceil(this.viewportHeight / this.virtualRowHeight) + this.virtualOverscanRows * 2;
    const endRow = Math.min(totalRows, startRow + visibleRows);
    const nextStartIndex = startRow * this.virtualColumns;
    const nextEndIndex = Math.min(this.items.length, endRow * this.virtualColumns);
    return this.virtualStartIndex !== nextStartIndex || this.virtualEndIndex !== nextEndIndex;
  }

  private updateVirtualSpacerHeights(): void {
    this.virtualTopSpacerHeight = Math.floor(this.virtualStartIndex / this.virtualColumns) * this.virtualRowHeight;
    const totalRows = Math.ceil(this.items.length / this.virtualColumns);
    const renderedEndRow = Math.ceil(this.virtualEndIndex / this.virtualColumns);
    this.virtualBottomSpacerHeight = Math.max(0, (totalRows - renderedEndRow) * this.virtualRowHeight);
  }

  private updateVisibleItemCards(): void {
    this.visibleItems = this.items.slice(this.virtualStartIndex, this.virtualEndIndex);
    this.visibleItemCards = this.visibleItems.map((item, index) => {
      const statusMessage = this.imageGenerationMessage(item);
      return {
        item,
        imageUrl: this.wardrobeImageUrl(item),
        label: this.label(item.subcategoryId),
        colours: this.coloursFor(item),
        statusMessage,
        isStatusInProgress: this.isImageGenerationInProgress(item.imageGenerationStatus),
        isPriorityImage: this.virtualStartIndex + index < this.firstPreloadItemCount,
        isSelected: this.selectedItemIds.has(item.id)
      };
    });
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

  private buildPagedItemFilterParams(offset: number): Record<string, string | number | boolean> {
    return {
      ...this.buildItemFilterParams(),
      limit: this.wardrobePageSize,
      offset
    };
  }

  async loadMore(event?: Event): Promise<void> {
    if (this.isLoadingMore || this.isLoading || !this.canLoadMore || this.canRetryMessage) {
      this.completeInfiniteScroll(event);
      return;
    }

    this.isLoadingMore = true;
    try {
      const nextItems = await this.api.getItems(this.buildPagedItemFilterParams(this.items.length));
      this.items = [...this.items, ...nextItems];
      this.canLoadMore = nextItems.length === this.wardrobePageSize;
      this.pruneSelectedItems();
      this.updateVirtualWindow(this.wardrobeScrollTop, true);
      this.startImageGenerationStreaming();
    } catch (error) {
      this.message = readMessage(error, 'Could not load more wardrobe items.');
      this.canLoadMore = false;
    } finally {
      this.isLoadingMore = false;
      this.completeInfiniteScroll(event);
      this.scheduleVirtualMetricsSync();
    }
  }

  private completeInfiniteScroll(event?: Event): void {
    (event?.target as { complete?: () => void } | null)?.complete?.();
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
    this.updateVisibleItemCards();

    if (!this.hasItemImageGenerationInProgress()) {
      this.stopItemImageGenerationStreaming();
      void this.refreshWardrobeItemsAfterImageGeneration();
    }
  }

  private async refreshWardrobeItemsAfterImageGeneration(): Promise<void> {
    try {
      this.items = await this.api.getItems(this.buildPagedItemFilterParams(0), { forceRefresh: true });
      this.canLoadMore = this.items.length === this.wardrobePageSize;
      this.pruneSelectedItems();
      this.resetVirtualWindow();
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
    if (!this.api.isOnline || !this.hasItemImageGenerationInProgress()) {
      return;
    }

    this.itemImageGenerationPollTimeout = setTimeout(() => {
      void this.refreshItemImageGenerationStatuses();
    }, this.itemImageGenerationPollingIntervalMs);
  }

  private async refreshItemImageGenerationStatuses(): Promise<void> {
    if (!this.api.isOnline) {
      this.isRefreshingImageGeneration = false;
      return;
    }

    if (this.isRefreshingImageGeneration) {
      this.startItemImageGenerationPolling();
      return;
    }

    if (!this.hasItemImageGenerationInProgress()) {
      return;
    }

    this.isRefreshingImageGeneration = true;
    try {
      this.items = await this.api.getItems(this.buildPagedItemFilterParams(0), { forceRefresh: true });
      this.canLoadMore = this.items.length === this.wardrobePageSize;
      this.pruneSelectedItems();
      this.resetVirtualWindow();
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
    this.updateFilterDerivedState();
    this.scheduleLoad();
  }

  setSubcategory(subcategoryId: string | null): void {
    this.subcategoryId = subcategoryId;
    this.updateFilterDerivedState();
    this.scheduleLoad();
  }

  setColour(colourId: string | null): void {
    this.colourId = colourId;
    this.updateFilterDerivedState();
    this.scheduleLoad();
  }

  setPattern(patternId: string | null): void {
    this.patternId = patternId;
    this.updateFilterDerivedState();
    this.scheduleLoad();
  }

  setIncludeArchived(includeArchived: boolean): void {
    this.includeArchived = includeArchived;
    this.updateFilterDerivedState();
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
    this.updateFilterDerivedState();
    this.scheduleVirtualMetricsSync();
    this.scheduleLoad();
  }

  onAdvancedFilterChanged(): void {
    this.updateFilterDerivedState();
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

  trackByCardId(_: number, card: WardrobeItemCard): string {
    return card.item.id;
  }

  trackByOptionId(_: number, option: LookupOptionDto): string {
    return option.id;
  }

  trackByValue(_: number, value: string | number): string | number {
    return value;
  }

  enterSelectionMode(): void {
    this.isSelectionMode = true;
    this.message = '';
    this.updateVisibleItemCards();
    void lightImpact();
  }

  cancelSelectionMode(): void {
    this.clearItemLongPress();
    this.isSelectionMode = false;
    this.selectedItemIds.clear();
    this.message = '';
    this.updateVisibleItemCards();
    void lightImpact();
  }

  clearSelection(): void {
    this.selectedItemIds.clear();
    this.updateVisibleItemCards();
  }

  onItemCardClick(item: WardrobeItemDto): void {
    this.clearItemLongPress();
    if (this.suppressNextItemClick) {
      this.suppressNextItemClick = false;
      return;
    }

    if (this.isSelectionMode) {
      this.toggleItemSelection(item.id);
      return;
    }

    void this.router.navigate(['/tabs/wardrobe', item.id]);
  }

  toggleItemSelection(itemId: string): void {
    if (this.selectedItemIds.has(itemId)) {
      this.selectedItemIds.delete(itemId);
      this.updateVisibleItemCards();
      void lightImpact();
      return;
    }

    this.selectedItemIds.add(itemId);
    this.updateVisibleItemCards();
    void lightImpact();
  }

  beginItemPress(item: WardrobeItemDto, event?: PointerEvent): void {
    if (this.isSelectionMode || this.isLoading || this.isDeletingSelected) {
      return;
    }

    if (event) {
      this.pointerStartX = event.clientX;
      this.pointerStartY = event.clientY;
    }

    this.clearItemLongPress();
    this.itemLongPressHandle = setTimeout(() => {
      this.itemLongPressHandle = null;
      this.suppressNextItemClick = true;
      this.enterSelectionMode();
      this.selectedItemIds.add(item.id);
      this.updateVisibleItemCards();
    }, this.selectionLongPressMs);
  }

  onItemPointerMove(event: PointerEvent): void {
    if (!this.itemLongPressHandle) {
      return;
    }

    const deltaX = Math.abs(event.clientX - this.pointerStartX);
    const deltaY = Math.abs(event.clientY - this.pointerStartY);
    if (deltaX > 10 || deltaY > 10) {
      this.clearItemLongPress();
    }
  }

  endItemPress(): void {
    this.clearItemLongPress();
  }

  cancelItemPress(): void {
    this.clearItemLongPress();
  }

  suppressContextMenu(event: Event): void {
    if (this.isSelectionMode || this.suppressNextItemClick) {
      event.preventDefault();
    }
  }

  async openItemContextMenu(item: WardrobeItemDto): Promise<void> {
    void lightImpact();
    const actionSheet = await this.actionSheetController.create({
      header: item.name,
      buttons: [
        {
          text: 'View Details',
          icon: 'eye-outline',
          handler: () => {
            void this.router.navigate(['/tabs/wardrobe', item.id]);
          }
        },
        {
          text: 'Mark Worn Today',
          icon: 'sparkles-outline',
          handler: () => {
            void this.quickMarkWorn(item);
          }
        },
        {
          text: 'Edit Item',
          icon: 'create-outline',
          handler: () => {
            void this.router.navigate(['/tabs/wardrobe', item.id], { queryParams: { mode: 'edit' } });
          }
        },
        {
          text: item.isArchived ? 'Unarchive Item' : 'Archive Item',
          icon: item.isArchived ? 'archive-outline' : 'archive',
          handler: () => {
            void this.quickToggleArchive(item);
          }
        },
        {
          text: 'Delete Item',
          role: 'destructive',
          icon: 'trash-outline',
          handler: () => {
            void this.quickDeleteItem(item);
          }
        },
        {
          text: 'Cancel',
          role: 'cancel',
          icon: 'close'
        }
      ]
    });
    await actionSheet.present();
  }

  async quickMarkWorn(item: WardrobeItemDto): Promise<void> {
    try {
      await this.api.markItemWorn(item.id);
      const index = this.items.findIndex((i) => i.id === item.id);
      if (index !== -1) {
        const current = this.items[index];
        this.items[index] = {
          ...current,
          wearCount: current.wearCount + 1,
          lastWornAt: new Date().toISOString()
        };
        this.updateVisibleItemCards();
      }
      void successFeedback();
      const toast = await this.toastController.create({
        message: `Marked "${item.name}" as worn today.`,
        duration: 2000,
        position: 'bottom',
        cssClass: 'ios-toast'
      });
      await toast.present();
    } catch (error) {
      this.message = readMessage(error, 'Could not mark item as worn.');
      void warningFeedback();
    }
  }

  async quickToggleArchive(item: WardrobeItemDto): Promise<void> {
    try {
      const isArchiving = !item.isArchived;
      const updated = await this.api.updateItem(item.id, {
        name: item.name,
        categoryId: item.categoryId,
        subcategoryId: item.subcategoryId,
        primaryColourId: item.primaryColourId,
        secondaryColourIds: item.secondaryColourIds,
        patternId: item.patternId,
        visibleMaterialId: item.visibleMaterialId,
        necklineId: item.necklineId,
        sleeveLengthId: item.sleeveLengthId,
        fitId: item.fitId,
        lengthId: item.lengthId,
        bottomShapeId: item.bottomShapeId,
        riseId: item.riseId,
        isArchived: isArchiving
      });
      const index = this.items.findIndex((i) => i.id === item.id);
      if (index !== -1) {
        this.items[index] = { ...this.items[index], isArchived: updated.isArchived };
        this.updateVisibleItemCards();
      }
      void successFeedback();
      const toast = await this.toastController.create({
        message: isArchiving ? `Archived "${item.name}".` : `Unarchived "${item.name}".`,
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
    } catch (error) {
      this.message = readMessage(error, 'Could not update archive status.');
      void warningFeedback();
    }
  }

  async quickDeleteItem(item: WardrobeItemDto): Promise<void> {
    const confirmed = await confirmAction(this.alertController, {
      title: 'Delete wardrobe item?',
      message: `Permanently remove "${item.name}" from your wardrobe and outfit suggestions?`,
      confirmLabel: 'Delete',
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    try {
      await this.api.deleteItem(item.id);
      this.items = this.items.filter((i) => i.id !== item.id);
      this.pruneSelectedItems();
      this.resetVirtualWindow();
      void successFeedback();
      const toast = await this.toastController.create({
        message: `Deleted "${item.name}".`,
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
    } catch (error) {
      this.message = readMessage(error, 'Could not delete item.');
      void warningFeedback();
    }
  }

  async deleteSelectedItems(): Promise<void> {
    if (!this.selectedItemIds.size || this.isDeletingSelected) {
      return;
    }

    const ids = Array.from(this.selectedItemIds);
    const confirmed = await confirmAction(this.alertController, {
      title: ids.length === 1 ? 'Delete selected item?' : 'Delete selected items?',
      message: ids.length === 1
        ? 'This removes the selected item from wardrobe results and outfit generation.'
        : `This removes ${ids.length} selected items from wardrobe results and outfit generation.`,
      confirmLabel: ids.length === 1 ? 'Delete item' : 'Delete items',
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    this.isDeletingSelected = true;
    this.message = '';
    try {
      const result = await this.api.deleteItems(ids);
      this.selectedItemIds.clear();
      this.isSelectionMode = false;
      await this.load(true, true);
      this.message = result.deletedCount === 1
        ? 'Deleted 1 wardrobe item.'
        : `Deleted ${result.deletedCount} wardrobe items.`;
      void successFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not delete selected wardrobe items.');
      void warningFeedback();
    } finally {
      this.isDeletingSelected = false;
      this.updateVisibleItemCards();
    }
  }

  wardrobeImageUrl(item: WardrobeItemDto): string {
    return item.image.thumbnailUrl || item.image.displayUrl;
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
    this.updateFilterDerivedState();
    if (this.loadDebounceHandle) {
      clearTimeout(this.loadDebounceHandle);
    }

    this.loadDebounceHandle = setTimeout(() => {
      this.loadDebounceHandle = null;
      void this.load(false, true);
    }, this.loadDebounceMs);
  }

  private updateFilterDerivedState(): void {
    this.subcategoryOptions = this.resolveSubcategoryOptions();
    this.hasFilters = !!(
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
    this.activeFilterSummary = this.buildActiveFilterSummary();
  }

  private resolveSubcategoryOptions(): LookupOptionDto[] {
    if (!this.lookups) {
      return [];
    }

    if (!this.categoryId) {
      return this.lookups.categories.reduce<LookupOptionDto[]>(
        (options, category) => options.concat(category.subcategories),
        []);
    }

    return this.lookups.categories.find((category) => category.id === this.categoryId)?.subcategories ?? [];
  }

  private buildActiveFilterSummary(): string {
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

    return filters.length ? filters.join(' · ') : 'No filters selected.';
  }

  private pruneSelectedItems(): void {
    if (!this.selectedItemIds.size) {
      return;
    }

    const visibleIds = new Set(this.items.map((item) => item.id));
    this.selectedItemIds = new Set(Array.from(this.selectedItemIds).filter((id) => visibleIds.has(id)));
    if (this.isSelectionMode && !this.selectedItemIds.size) {
      this.isSelectionMode = false;
    }
    this.updateVisibleItemCards();
  }

  private clearItemLongPress(): void {
    if (this.itemLongPressHandle) {
      clearTimeout(this.itemLongPressHandle);
    }
    this.itemLongPressHandle = null;
  }
}
