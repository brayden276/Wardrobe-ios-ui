import { Component, OnDestroy, inject } from '@angular/core';
import { ImageGenerationStreamUpdate, OutfitDto } from '../../models';
import { ImageGenerationStatusStream, WardrobeApiService } from '../../wardrobe-api.service';
import { readMessage } from '../page-helpers';

@Component({
  selector: 'app-outfits',
  standalone: false,
  templateUrl: './outfits.page.html',
  styleUrls: ['./outfits.page.scss']
})
export class OutfitsPage implements OnDestroy {
  private readonly api = inject(WardrobeApiService);
  outfits: OutfitDto[] = [];
  selectedOutfit: OutfitDto | null = null;
  isLoading = true;
  message = '';
  private imageGenerationStatusStream: ImageGenerationStatusStream | null = null;
  private readonly markingOutfitIds = new Set<string>();
  private readonly deletingOutfitIds = new Set<string>();
  private readonly outfitGenerationPollingIntervalMs = 1800;
  private readonly outfitRenderIncrement = 20;
  private outfitGenerationPollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingOutfits = false;
  visibleOutfitCount = this.outfitRenderIncrement;

  get visibleOutfits(): OutfitDto[] {
    return this.outfits.slice(0, this.visibleOutfitCount);
  }

  get canShowMoreOutfits(): boolean {
    return this.visibleOutfitCount < this.outfits.length;
  }

  showMoreOutfits(): void {
    this.visibleOutfitCount = Math.min(this.outfits.length, this.visibleOutfitCount + this.outfitRenderIncrement);
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  ngOnDestroy(): void {
    this.stopOutfitGenerationStreaming();
    this.stopOutfitGenerationPolling();
  }

  async load(forceRefresh = false): Promise<void> {
    this.stopOutfitGenerationStreaming();
    this.stopOutfitGenerationPolling();
    this.isLoading = true;
    this.message = '';
    try {
      this.outfits = await this.api.getOutfits({ forceRefresh });
      if (this.selectedOutfit) {
        this.selectedOutfit = this.outfits.find((outfit) => outfit.id === this.selectedOutfit?.id) ?? null;
      }
      this.startOutfitGenerationStreaming();
    } catch (error) {
      this.message = readMessage(error, 'Could not load outfits.');
      this.outfits = [];
    } finally {
      this.isLoading = false;
    }
  }

  open(outfit: OutfitDto): void {
    this.selectedOutfit = outfit;
    this.startOutfitGenerationStreaming();
  }

  close(): void {
    this.selectedOutfit = null;
    this.message = '';
  }

  private startOutfitGenerationStreaming(): void {
    this.stopOutfitGenerationStreaming();
    this.stopOutfitGenerationPolling();

    if (!this.hasOutfitImageGenerationInProgress()) {
      return;
    }

    const trackingOutfitIds = new Set<string>();
    for (const outfit of this.outfits) {
      if (this.isOutfitImageGenerationInProgress(outfit.imageGenerationStatus)) {
        trackingOutfitIds.add(outfit.id);
      }
    }

    const stream = this.api.streamImageGenerationStatuses(
      [],
      Array.from(trackingOutfitIds),
      (updates) => this.applyOutfitGenerationStreamUpdates(updates),
      () => {
        this.imageGenerationStatusStream = null;
        this.startOutfitGenerationPolling();
      });

    if (stream === null) {
      this.startOutfitGenerationPolling();
      return;
    }

    this.imageGenerationStatusStream = stream;
  }

  private applyOutfitGenerationStreamUpdates(updates: ImageGenerationStreamUpdate[]): void {
    if (!updates.length) {
      return;
    }

    const updateById = new Map<string, ImageGenerationStreamUpdate>(
      updates.filter((update) => update.kind === 'outfit').map((update) => [update.id, update]));
    this.outfits = this.outfits.map((outfit) => {
      const update = updateById.get(outfit.id);
      if (!update || update.status === outfit.imageGenerationStatus) {
        return outfit;
      }

      return { ...outfit, imageGenerationStatus: update.status };
    });

    if (this.selectedOutfit) {
      this.selectedOutfit = this.outfits.find((outfit) => outfit.id === this.selectedOutfit?.id) ?? null;
    }

    if (!this.hasOutfitImageGenerationInProgress()) {
      this.stopOutfitGenerationStreaming();
      void this.refreshOutfitsAfterImageGeneration();
    }
  }

  private async refreshOutfitsAfterImageGeneration(): Promise<void> {
    try {
      const outfits = await this.api.getOutfits({ forceRefresh: true });
      const selectedOutfitId = this.selectedOutfit?.id ?? null;
      this.outfits = outfits;
      this.selectedOutfit = selectedOutfitId ? outfits.find((outfit) => outfit.id === selectedOutfitId) ?? null : null;
    } catch {
      // Ignore temporary network issues after outfit image generation completes.
    }
  }

  private stopOutfitGenerationStreaming(): void {
    if (this.imageGenerationStatusStream) {
      this.imageGenerationStatusStream.close();
    }
    this.imageGenerationStatusStream = null;
  }

  private startOutfitGenerationPolling(): void {
    this.stopOutfitGenerationPolling();
    if (!this.hasOutfitImageGenerationInProgress()) {
      return;
    }

    this.outfitGenerationPollTimeout = setTimeout(() => {
      this.outfitGenerationPollTimeout = null;
      void this.pollOutfitImageGeneration();
    }, this.outfitGenerationPollingIntervalMs);
  }

  private async pollOutfitImageGeneration(): Promise<void> {
    if (this.isRefreshingOutfits) {
      this.startOutfitGenerationPolling();
      return;
    }

    if (!this.hasOutfitImageGenerationInProgress()) {
      return;
    }

    this.isRefreshingOutfits = true;
    try {
      const outfits = await this.api.getOutfits({ forceRefresh: true });
      const selectedOutfitId = this.selectedOutfit?.id ?? null;
      this.outfits = outfits;
      this.selectedOutfit = selectedOutfitId ? outfits.find((outfit) => outfit.id === selectedOutfitId) ?? null : null;
    } catch {
      // Ignore temporary network issues while polling for outfit image status.
    } finally {
      this.isRefreshingOutfits = false;
      this.startOutfitGenerationPolling();
    }
  }

  private stopOutfitGenerationPolling(): void {
    if (this.outfitGenerationPollTimeout) {
      clearTimeout(this.outfitGenerationPollTimeout);
    }
    this.outfitGenerationPollTimeout = null;
    this.isRefreshingOutfits = false;
  }

  private hasOutfitImageGenerationInProgress(): boolean {
    return this.outfits.some((outfit) => this.isOutfitImageGenerationInProgress(outfit.imageGenerationStatus));
  }

  outfitGenerationMessage(status: string | null): string | null {
    switch (status) {
      case 'queued':
        return 'Image generation queued...';
      case 'generating':
        return 'Generating outfit image...';
      case 'failed':
        return 'Image generation failed.';
      default:
        return null;
    }
  }

  isOutfitImageGenerationInProgress(status: string | null): boolean {
    return status === 'queued' || status === 'generating';
  }

  async markWorn(outfit: OutfitDto): Promise<void> {
    if (this.markingOutfitIds.has(outfit.id)) return;
    this.markingOutfitIds.add(outfit.id);
    this.message = '';
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
    } catch (error) {
      this.message = readMessage(error, 'Could not mark outfit as worn.');
    } finally {
      this.markingOutfitIds.delete(outfit.id);
    }
  }

  async remove(outfit: OutfitDto): Promise<void> {
    if (this.deletingOutfitIds.has(outfit.id)) {
      return;
    }

    const confirmed = window.confirm(`Delete outfit "${outfit.name}"?`);
    if (!confirmed) {
      return;
    }

    this.deletingOutfitIds.add(outfit.id);
    this.message = '';
    try {
      await this.api.deleteOutfit(outfit.id);
      if (this.selectedOutfit?.id === outfit.id) {
        this.selectedOutfit = null;
      }
      await this.load(true);
    } catch (error) {
      this.message = readMessage(error, 'Could not delete outfit.');
    } finally {
      this.deletingOutfitIds.delete(outfit.id);
    }
  }

  isMarkingOutfit(outfitId: string): boolean {
    return this.markingOutfitIds.has(outfitId);
  }

  isRemovingOutfit(outfitId: string): boolean {
    return this.deletingOutfitIds.has(outfitId);
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
}
