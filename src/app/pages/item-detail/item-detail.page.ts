import { Component, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, AlertController } from '@ionic/angular';
import { ImageGenerationStreamUpdate, UpdateWardrobeItemRequest, WardrobeItemDto, WardrobeLookupsDto } from '../../models';
import { ImageGenerationStatusStream, WardrobeApiService } from '../../wardrobe-api.service';
import {
  colourSwatch,
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
  private readonly actionSheetController = inject(ActionSheetController);
  item: WardrobeItemDto | null = null;
  lookups: WardrobeLookupsDto | null = null;
  form: UpdateWardrobeItemRequest = emptyItemForm();
  message = '';
  isLoading = true;
  isSaving = false;
  isMarkingWorn = false;
  isArchiving = false;
  isEditModalOpen = false;
  activeImageLayer: 'display' | 'original' = 'display';
  isDeleting = false;
  private imageGenerationStatusStream: ImageGenerationStatusStream | null = null;
  private readonly imageGenerationPollingIntervalMs = 1800;
  private imageGenerationPollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingImageGeneration = false;

  get selectedSubcategories(): { id: string; label: string }[] {
    return this.lookups?.categories.find((category) => category.id === this.form.categoryId)?.subcategories ?? [];
  }

  setImageLayer(layer: 'display' | 'original'): void {
    if (layer) {
      this.activeImageLayer = layer;
      void lightImpact();
    }
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  label(id: string | null): string {
    if (!id || !this.lookups) return '';
    return lookupLabel(this.lookups, id);
  }

  colourSwatch(id: string): string {
    return colourSwatch(id);
  }

  formatLastWorn(dateString: string | null): string {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Never';
    const diffMs = Date.now() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  openEditModal(): void {
    if (this.item) {
      this.form = this.toFormState(this.item);
    }
    this.isEditModalOpen = true;
    void lightImpact();
  }

  closeEditModal(): void {
    this.isEditModalOpen = false;
    if (this.route.snapshot.queryParamMap.has('mode') || this.route.snapshot.queryParamMap.has('newlyAdded')) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { mode: null, newlyAdded: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  async openMoreMenu(): Promise<void> {
    if (!this.item) return;
    void lightImpact();
    const isArchived = this.item.isArchived;
    const actionSheet = await this.actionSheetController.create({
      header: this.item.name,
      buttons: [
        {
          text: isArchived ? 'Unarchive Item' : 'Archive Item (Hide from Outfits)',
          icon: isArchived ? 'archive-outline' : 'archive',
          handler: () => {
            void this.toggleArchive();
          }
        },
        {
          text: 'Delete Permanently',
          role: 'destructive',
          icon: 'trash-outline',
          handler: () => {
            void this.deleteItemPermanently();
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
      this.form = this.toFormState(item);
      this.startImageGenerationStreaming();
      if (this.route.snapshot.queryParamMap.get('mode') === 'edit') {
        this.openEditModal();
      }
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
      (updates: ImageGenerationStreamUpdate[]) => this.applyImageGenerationStreamUpdates(updates),
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

    this.item = {
      ...this.item,
      imageGenerationStatus: update.status
    };
    if (!this.isEditModalOpen) {
      this.form = this.toFormState(this.item);
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
      this.item = latestItem;
      if (!this.isEditModalOpen) {
        this.form = this.toFormState(latestItem);
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
      this.item = latestItem;
      if (!this.isEditModalOpen) {
        this.form = this.toFormState(latestItem);
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
        return 'Polishing look...';
      case 'generating':
        return 'Polishing look...';
      case 'failed':
        return 'Cutout failed';
      default:
        return null;
    }
  }

  isImageGenerationInProgress(status: string | null): boolean {
    return status === 'queued' || status === 'generating';
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
        this.form = this.toFormState(latestItem);
      } catch {
        const fallbackItem = this.item ?? currentItem;
        const now = new Date().toISOString();
        this.item = {
          ...fallbackItem,
          wearCount: fallbackItem.wearCount + 1,
          lastWornAt: now,
          updatedAt: now
        };
        this.form = this.toFormState(this.item);
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

  private toFormState(item: WardrobeItemDto): UpdateWardrobeItemRequest {
    return {
      name: item.name,
      categoryId: item.categoryId,
      subcategoryId: item.subcategoryId,
      primaryColourId: item.primaryColourId,
      secondaryColourIds: item.secondaryColourIds ? item.secondaryColourIds.slice() : [],
      patternId: item.patternId,
      visibleMaterialId: item.visibleMaterialId,
      necklineId: item.necklineId,
      sleeveLengthId: item.sleeveLengthId,
      fitId: item.fitId,
      lengthId: item.lengthId,
      bottomShapeId: item.bottomShapeId,
      riseId: item.riseId,
      isArchived: item.isArchived
    };
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
      this.form = this.toFormState(this.item);
      this.message = 'Details saved.';
      this.closeEditModal();
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
      this.form = this.toFormState(this.item);
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
      this.closeEditModal();
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

  private isUnauthorized(error: unknown): boolean {
    return (error as { status?: number }).status === 401;
  }
}
