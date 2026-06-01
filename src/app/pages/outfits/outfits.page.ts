import { Component, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { OutfitDto } from '../../models';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { confirmAction, lightImpact, noticeKind, NoticeKind, readMessage, successFeedback, warningFeedback } from '../page-helpers';

@Component({
  selector: 'app-outfits',
  standalone: false,
  templateUrl: './outfits.page.html',
  styleUrls: ['./outfits.page.scss']
})
export class OutfitsPage {
  private readonly api = inject(WardrobeApiService);
  private readonly alertController = inject(AlertController);
  outfits: OutfitDto[] = [];
  selectedOutfit: OutfitDto | null = null;
  isLoading = true;
  message = '';
  isSelectionMode = false;
  isDeletingSelected = false;
  selectedOutfitIds = new Set<string>();
  private readonly markingOutfitIds = new Set<string>();
  private readonly deletingOutfitIds = new Set<string>();
  private readonly outfitRenderIncrement = 20;
  private outfitLongPressHandle: ReturnType<typeof setTimeout> | null = null;
  private suppressNextOutfitClick = false;
  private readonly selectionLongPressMs = 450;
  visibleOutfitCount = this.outfitRenderIncrement;

  get visibleOutfits(): OutfitDto[] {
    return this.outfits.slice(0, this.visibleOutfitCount);
  }

  get canShowMoreOutfits(): boolean {
    return this.visibleOutfitCount < this.outfits.length;
  }

  get loadingMessage(): string {
    return this.outfits.length ? 'Refreshing outfits...' : 'Loading outfits...';
  }

  get selectedCount(): number {
    return this.selectedOutfitIds.size;
  }

  get processingDetail(): string {
    return this.selectedCount === 1
      ? 'Deleting 1 saved outfit. Wardrobe items stay available.'
      : `Deleting ${this.selectedCount} saved outfits. Wardrobe items stay available.`;
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  get canRetryMessage(): boolean {
    return this.messageKind === 'error' || this.messageKind === 'offline';
  }

  showMoreOutfits(): void {
    this.visibleOutfitCount = Math.min(this.outfits.length, this.visibleOutfitCount + this.outfitRenderIncrement);
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  async load(forceRefresh = false): Promise<void> {
    this.isLoading = true;
    this.message = '';
    try {
      this.outfits = await this.api.getOutfits({ forceRefresh });
      this.pruneSelectedOutfits();
      if (this.selectedOutfit) {
        this.selectedOutfit = this.outfits.find((outfit) => outfit.id === this.selectedOutfit?.id) ?? null;
      }
    } catch (error) {
      this.message = readMessage(error, 'Could not load outfits.');
      this.outfits = [];
    } finally {
      this.isLoading = false;
    }
  }

  open(outfit: OutfitDto, event?: Event): void {
    this.clearOutfitLongPress();
    if (this.suppressNextOutfitClick) {
      event?.preventDefault();
      event?.stopPropagation();
      this.suppressNextOutfitClick = false;
      return;
    }

    if (this.isSelectionMode) {
      event?.preventDefault();
      event?.stopPropagation();
      this.toggleOutfitSelection(outfit.id);
      return;
    }

    this.selectedOutfit = outfit;
    void lightImpact();
  }

  close(): void {
    this.selectedOutfit = null;
    this.message = '';
    void lightImpact();
  }

  async markWorn(outfit: OutfitDto): Promise<void> {
    if (this.markingOutfitIds.has(outfit.id)) return;
    this.markingOutfitIds.add(outfit.id);
    this.message = `Marking "${outfit.name}" as worn...`;
    try {
      await this.api.markWorn(outfit.id);
      try {
        const outfits = await this.api.getOutfits({ forceRefresh: true });
        const selectedOutfitId = this.selectedOutfit?.id ?? null;
        this.outfits = outfits;
        this.selectedOutfit = selectedOutfitId ? outfits.find((candidate) => candidate.id === selectedOutfitId) ?? null : null;
      } catch {
        this.updateOutfitAfterWear(outfit.id);
      }
      this.message = 'Marked as worn.';
      void successFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not mark outfit as worn.');
      void warningFeedback();
    } finally {
      this.markingOutfitIds.delete(outfit.id);
    }
  }

  async remove(outfit: OutfitDto): Promise<void> {
    if (this.deletingOutfitIds.has(outfit.id)) {
      return;
    }

    const confirmed = await confirmAction(this.alertController, {
      title: 'Delete outfit?',
      message: `"${outfit.name}" will be removed from saved outfits. Wardrobe items stay available.`,
      confirmLabel: 'Delete outfit',
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    this.deletingOutfitIds.add(outfit.id);
    this.message = `Deleting "${outfit.name}"...`;
    try {
      await this.api.deleteOutfit(outfit.id);
      if (this.selectedOutfit?.id === outfit.id) {
        this.selectedOutfit = null;
      }
      await this.load(true);
      void successFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not delete outfit.');
      void warningFeedback();
    } finally {
      this.deletingOutfitIds.delete(outfit.id);
    }
  }

  enterSelectionMode(): void {
    this.isSelectionMode = true;
    this.selectedOutfit = null;
    this.message = '';
    void lightImpact();
  }

  cancelSelectionMode(): void {
    this.clearOutfitLongPress();
    this.isSelectionMode = false;
    this.selectedOutfitIds.clear();
    this.message = '';
    void lightImpact();
  }

  clearSelection(): void {
    this.selectedOutfitIds.clear();
  }

  selectVisibleOutfits(): void {
    for (const outfit of this.visibleOutfits) {
      this.selectedOutfitIds.add(outfit.id);
    }
  }

  isOutfitSelected(outfitId: string): boolean {
    return this.selectedOutfitIds.has(outfitId);
  }

  toggleOutfitSelection(outfitId: string): void {
    if (this.selectedOutfitIds.has(outfitId)) {
      this.selectedOutfitIds.delete(outfitId);
      void lightImpact();
      return;
    }

    this.selectedOutfitIds.add(outfitId);
    void lightImpact();
  }

  beginOutfitPress(outfit: OutfitDto): void {
    if (this.isSelectionMode || this.isLoading || this.isDeletingSelected || this.selectedOutfit) {
      return;
    }

    this.clearOutfitLongPress();
    this.outfitLongPressHandle = setTimeout(() => {
      this.outfitLongPressHandle = null;
      this.suppressNextOutfitClick = true;
      this.enterSelectionMode();
      this.selectedOutfitIds.add(outfit.id);
    }, this.selectionLongPressMs);
  }

  endOutfitPress(): void {
    this.clearOutfitLongPress();
  }

  cancelOutfitPress(): void {
    this.clearOutfitLongPress();
  }

  suppressContextMenu(event: Event): void {
    if (this.isSelectionMode || this.suppressNextOutfitClick) {
      event.preventDefault();
    }
  }

  async deleteSelectedOutfits(): Promise<void> {
    if (!this.selectedOutfitIds.size || this.isDeletingSelected) {
      return;
    }

    const ids = Array.from(this.selectedOutfitIds);
    const confirmed = await confirmAction(this.alertController, {
      title: ids.length === 1 ? 'Delete selected outfit?' : 'Delete selected outfits?',
      message: ids.length === 1
        ? 'This removes 1 saved outfit. Wardrobe items stay available.'
        : `This removes ${ids.length} saved outfits. Wardrobe items stay available.`,
      confirmLabel: ids.length === 1 ? 'Delete outfit' : 'Delete outfits',
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    this.isDeletingSelected = true;
    this.message = '';
    try {
      const result = await this.api.deleteOutfits(ids);
      this.selectedOutfitIds.clear();
      this.isSelectionMode = false;
      await this.load(true);
      this.message = result.deletedCount === 1
        ? 'Deleted 1 outfit.'
        : `Deleted ${result.deletedCount} outfits.`;
      void successFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not delete selected outfits.');
      void warningFeedback();
    } finally {
      this.isDeletingSelected = false;
    }
  }

  isMarkingOutfit(outfitId: string): boolean {
    return this.markingOutfitIds.has(outfitId);
  }

  isRemovingOutfit(outfitId: string): boolean {
    return this.deletingOutfitIds.has(outfitId);
  }

  outfitActionMessage(outfit: OutfitDto): string {
    if (this.isMarkingOutfit(outfit.id)) {
      return `Marking "${outfit.name}" as worn...`;
    }

    if (this.isRemovingOutfit(outfit.id)) {
      return `Deleting "${outfit.name}"...`;
    }

    return '';
  }

  trackById(_: number, outfit: OutfitDto): string {
    return outfit.id;
  }

  outfitItemImageUrl(item: OutfitDto['items'][number]): string {
    return item.image.thumbnailUrl || item.image.displayUrl;
  }

  private updateOutfitAfterWear(outfitId: string): void {
    const now = new Date().toISOString();
    this.outfits = this.outfits.map((candidate) => candidate.id === outfitId
      ? {
          ...candidate,
          wearCount: candidate.wearCount + 1,
          lastWornAt: now,
          updatedAt: now
        }
      : candidate);
    if (this.selectedOutfit?.id === outfitId) {
      this.selectedOutfit = this.outfits.find((candidate) => candidate.id === outfitId) ?? null;
    }
  }

  private pruneSelectedOutfits(): void {
    if (!this.selectedOutfitIds.size) {
      return;
    }

    const visibleIds = new Set(this.outfits.map((outfit) => outfit.id));
    this.selectedOutfitIds = new Set(Array.from(this.selectedOutfitIds).filter((id) => visibleIds.has(id)));
    if (this.isSelectionMode && !this.selectedOutfitIds.size) {
      this.isSelectionMode = false;
    }
  }

  private clearOutfitLongPress(): void {
    if (this.outfitLongPressHandle) {
      clearTimeout(this.outfitLongPressHandle);
    }
    this.outfitLongPressHandle = null;
  }
}
