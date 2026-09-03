import { Component, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { ImageGenerationStreamUpdate, UpdateWardrobeItemRequest, WardrobeItemDto, WardrobeLookupsDto } from '../../models';
import { ImageGenerationStatusStream, WardrobeApiService } from '../../wardrobe-api.service';
import {
  confirmAction,
  emptyItemForm,
  lightImpact,
  lookupLabel,
  noticeKind,
  NoticeKind,
  readMessage,
  successFeedback,
  warningFeedback
} from '../page-helpers';

type ItemDetailMode = 'view' | 'edit';

@Component({
  selector: 'app-item-detail',
  standalone: false,
  templateUrl: './item-detail.page.html',
  styleUrls: ['./item-detail.page.scss']
})
export class ItemDetailPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  item: WardrobeItemDto | null = null;
  lookups: WardrobeLookupsDto | null = null;
  form: UpdateWardrobeItemRequest = emptyItemForm();
  message = '';
  isLoading = true;
  isSaving = false;
  isMarkingWorn = false;
  isArchiving = false;
  isOriginalImageOpen = false;
  itemMode: ItemDetailMode = 'view';
  isDeleting = false;
  private imageGenerationStatusStream: ImageGenerationStatusStream | null = null;
  private readonly imageGenerationPollingIntervalMs = 1800;
  private imageGenerationPollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingImageGeneration = false;

  get selectedSubcategories(): { id: string; label: string }[] {
    return this.lookups?.categories.find((category) => category.id === this.form.categoryId)?.subcategories ?? [];
  }

  get visibleTags(): string[] {
    if (!this.item || !this.lookups) return [];
    const tags = [
      this.item.categoryId,
      this.item.subcategoryId,
      this.item.primaryColourId,
      this.item.patternId,
      this.item.visibleMaterialId,
      this.item.necklineId,
      this.item.sleeveLengthId,
      this.item.fitId,
      this.item.lengthId,
      this.item.bottomShapeId,
      this.item.riseId
    ];
    return Array.from(new Set(tags.map((id) => lookupLabel(this.lookups!, id)).filter(Boolean))).slice(0, 8);
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  async ionViewWillEnter(): Promise<void> {
    await this.loadItem();
    if (this.shouldPollImageGeneration()) {
      this.startImageGenerationStreaming();
    }
  }

  ionViewWillLeave(): void {
    this.stopImageGenerationStreaming();
    this.stopImageGenerationPolling();
  }

  ionViewDidLeave(): void {
    this.stopImageGenerationStreaming();
    this.stopImageGenerationPolling();
  }

  retryLoadItem(): void {
    void this.loadItem();
  }

  ngOnDestroy(): void {
    this.stopImageGenerationStreaming();
    this.stopImageGenerationPolling();
  }

  private async loadItem(): Promise<void> {
    this.stopImageGenerationStreaming();
    this.stopImageGenerationPolling();
    this.isLoading = true;
    this.message = '';
    this.item = null;
    this.isOriginalImageOpen = false;
    const initialMode = this.route.snapshot.queryParamMap.get('mode') === 'edit' ? 'edit' : 'view';
    this.setItemMode(initialMode);
    if (this.route.snapshot.queryParamMap.get('newlyAdded') === 'true') {
      this.message = 'AI classified your item. Review details below and tap Save.';
    }
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.message = 'Could not load item.';
      this.isLoading = false;
      return;
    }
    try {
      const [lookups, item] = await Promise.all([
        this.api.getLookups(),
        this.api.getItem(id)
      ]);
      this.lookups = lookups;
      this.item = item;
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
      this.startImageGenerationStreaming();
    } catch (error) {
      this.message = readMessage(error, 'Could not load item.');
      if (this.isUnauthorized(error)) {
        await this.router.navigateByUrl('/login');
      }
    } finally {
      this.isLoading = false;
    }
  }

  private startImageGenerationStreaming(): void {
    if (!this.item) {
      return;
    }

    this.stopImageGenerationStreaming();
    this.stopImageGenerationPolling();

    if (!this.shouldPollImageGeneration()) {
      return;
    }

    const stream = this.api.streamImageGenerationStatuses(
      [this.item.id],
      [],
      (updates) => this.applyImageGenerationStreamUpdates(updates),
      () => {
        this.imageGenerationStatusStream = null;
        this.startImageGenerationPolling();
      });

    if (stream === null) {
      this.startImageGenerationPolling();
      return;
    }

    this.imageGenerationStatusStream = stream;
  }

  private applyImageGenerationStreamUpdates(updates: ImageGenerationStreamUpdate[]): void {
    if (!this.item) {
      return;
    }

    const itemId = this.item.id;
    const update = updates.find((entry) => entry.kind === 'item' && entry.id === itemId);
    if (!update) {
      return;
    }

    const currentMode = this.itemMode;
    this.item = {
      ...this.item,
      imageGenerationStatus: update.status
    };
    if (currentMode !== 'edit') {
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
    }

    if (!this.shouldPollImageGeneration()) {
      this.stopImageGenerationStreaming();
      void this.refreshItemAfterImageGeneration();
    }
  }

  private async refreshItemAfterImageGeneration(): Promise<void> {
    if (!this.item) {
      return;
    }

    try {
      const latestItem = await this.api.getItem(this.item.id);
      const mode = this.itemMode;
      this.item = latestItem;
      if (mode !== 'edit') {
        this.form = { ...latestItem, secondaryColourIds: latestItem.secondaryColourIds.slice() };
      }
    } catch {
      // Ignore temporary network issues after image generation completes.
    }
  }

  private stopImageGenerationStreaming(): void {
    if (this.imageGenerationStatusStream) {
      this.imageGenerationStatusStream.close();
    }
    this.imageGenerationStatusStream = null;
  }

  private startImageGenerationPolling(): void {
    this.stopImageGenerationPolling();
    if (!this.api.isOnline || !this.shouldPollImageGeneration()) {
      return;
    }

    this.imageGenerationPollTimeout = setTimeout(() => {
      this.imageGenerationPollTimeout = null;
      void this.pollImageGeneration();
    }, this.imageGenerationPollingIntervalMs);
  }

  private async pollImageGeneration(): Promise<void> {
    if (!this.api.isOnline) {
      this.isRefreshingImageGeneration = false;
      return;
    }

    if (!this.item || this.isRefreshingImageGeneration) {
      this.startImageGenerationPolling();
      return;
    }

    if (!this.shouldPollImageGeneration()) {
      return;
    }

    this.isRefreshingImageGeneration = true;
    try {
      const latestItem = await this.api.getItem(this.item.id);
      const mode = this.itemMode;
      this.item = latestItem;
      if (mode !== 'edit') {
        this.form = { ...latestItem, secondaryColourIds: latestItem.secondaryColourIds.slice() };
      }
    } catch {
      // Ignore temporary network issues while polling for image-generation state.
    } finally {
      this.isRefreshingImageGeneration = false;
      this.startImageGenerationPolling();
    }
  }

  private stopImageGenerationPolling(): void {
    if (this.imageGenerationPollTimeout) {
      clearTimeout(this.imageGenerationPollTimeout);
    }
    this.imageGenerationPollTimeout = null;
    this.isRefreshingImageGeneration = false;
  }

  private shouldPollImageGeneration(): boolean {
    return this.isImageGenerationInProgress(this.item?.imageGenerationStatus ?? null);
  }

  imageGenerationMessage(status: string | null): string | null {
    switch (status) {
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

  openOriginalImage(): void {
    if (!this.item?.image?.originalUrl) {
      return;
    }

    this.isOriginalImageOpen = true;
  }

  closeOriginalImage(): void {
    this.isOriginalImageOpen = false;
  }

  async markWorn(): Promise<void> {
    if (!this.item) return;
    if (this.isMarkingWorn) {
      return;
    }

    this.isMarkingWorn = true;
    this.message = 'Marking item as worn...';
    try {
      const currentItem = this.item;
      const itemId = currentItem.id;
      await this.api.markItemWorn(itemId);
      try {
        const latestItem = await this.api.getItem(itemId);
        this.item = latestItem;
        this.form = { ...latestItem, secondaryColourIds: latestItem.secondaryColourIds.slice() };
      } catch {
        const fallbackItem = this.item ?? currentItem;
        const now = new Date().toISOString();
        this.item = {
          ...fallbackItem,
          wearCount: fallbackItem.wearCount + 1,
          lastWornAt: now,
          updatedAt: now
        };
        this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
      }
      this.message = '✓ Marked as worn today!';
      void successFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not mark item as worn.');
      void warningFeedback();
    } finally {
      this.isMarkingWorn = false;
    }
  }

  syncSubcategory(): void {
    if (!this.selectedSubcategories.some((option) => option.id === this.form.subcategoryId)) {
      this.form.subcategoryId = this.selectedSubcategories[0]?.id ?? '';
    }
  }

  async save(): Promise<void> {
    if (!this.item) return;
    this.isSaving = true;
    this.message = 'Saving item details...';
    try {
      this.item = await this.api.updateItem(this.item.id, this.form);
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
      this.message = 'Details saved.';
      this.setItemMode('view');
      void successFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not save details.');
      void warningFeedback();
    } finally {
      this.isSaving = false;
    }
  }

  async toggleArchive(): Promise<void> {
    if (!this.item || this.isArchiving || this.isSaving || this.isDeleting) return;
    const willArchive = !this.item.isArchived;
    this.isArchiving = true;
    this.message = willArchive ? 'Archiving item...' : 'Unarchiving item...';
    try {
      this.item = await this.api.updateItem(this.item.id, {
        ...this.form,
        isArchived: willArchive
      });
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
      this.message = willArchive ? 'Item archived and hidden from outfit builder.' : 'Item unarchived and active in wardrobe.';
      void successFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not update archive status.');
      void warningFeedback();
    } finally {
      this.isArchiving = false;
    }
  }

  async deleteItemPermanently(): Promise<void> {
    if (!this.item || this.isDeleting || this.isArchiving) return;
    const confirmed = await confirmAction(this.alertController, {
      title: 'Permanently delete item?',
      message: `"${this.item.name}" will be permanently removed from your wardrobe. This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    this.isDeleting = true;
    this.message = 'Deleting item...';
    try {
      await this.api.deleteItem(this.item.id);
      void successFeedback();
      await this.router.navigateByUrl('/tabs/wardrobe');
    } catch (error) {
      this.message = readMessage(error, 'Could not delete item.');
      void warningFeedback();
    } finally {
      this.isDeleting = false;
    }
  }

  async deleteItem(): Promise<void> {
    await this.deleteItemPermanently();
  }

  cancelEdit(): void {
    this.setItemMode('view');
  }

  get editing(): boolean {
    return this.itemMode === 'edit';
  }

  get processingMessage(): string {
    if (this.isSaving) {
      return 'Saving item details...';
    }

    if (this.isMarkingWorn) {
      return 'Marking item as worn...';
    }

    if (this.isArchiving) {
      return 'Archiving item...';
    }

    return '';
  }

  setItemMode(mode: ItemDetailMode): void {
    if (this.itemMode === mode) {
      return;
    }

    this.itemMode = mode;
    this.message = '';
    if (mode === 'view' && this.item) {
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
    }
    void lightImpact();
  }

  private isUnauthorized(error: unknown): boolean {
    return (error as { status?: number }).status === 401;
  }
}
