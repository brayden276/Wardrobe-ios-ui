import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './auth.service';
import {
  AiUsageCostSummaryDto,
  BatchWardrobeItemsResponse,
  GeneratedOutfitDto,
  ImageGenerationStreamUpdate,
  OutfitDto,
  UpdateWardrobeItemRequest,
  WardrobeItemDto,
  WardrobeLookupsDto
} from './models';

export interface ImageGenerationStatusStream {
  close(): void;
}

@Injectable({ providedIn: 'root' })
export class WardrobeApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private lookupsPromise: Promise<WardrobeLookupsDto> | null = null;

  async getLookups(): Promise<WardrobeLookupsDto> {
    this.lookupsPromise ??= this.authorized(() => firstValueFrom(this.http.get<WardrobeLookupsDto>(this.url('/api/lookups/wardrobe'), this.authOptions())))
      .catch((error) => {
        this.lookupsPromise = null;
        throw error;
      });
    return this.lookupsPromise;
  }

  async getItems(params: Record<string, string | number | boolean | null | undefined> = {}): Promise<WardrobeItemDto[]> {
    const query = this.queryString(params);
    const response = await this.authorized(() => firstValueFrom(this.http.get<{ items: WardrobeItemDto[] }>(this.url(`/api/wardrobe/items${query ? `?${query}` : ''}`), this.authOptions())));
    return response.items.map((item) => this.normaliseItem(item));
  }

  async getItem(id: string): Promise<WardrobeItemDto> {
    return this.normaliseItem(await this.authorized(() => firstValueFrom(this.http.get<WardrobeItemDto>(this.url(`/api/wardrobe/items/${id}`), this.authOptions()))));
  }

  async createItem(image: Blob, fileName: string): Promise<WardrobeItemDto> {
    const body = new FormData();
    body.append('image', image, fileName);
    const response = await this.authorized(() => firstValueFrom(this.http.post<{ item: WardrobeItemDto }>(this.url('/api/wardrobe/items'), body, this.authOptions())));
    return this.normaliseItem(response.item);
  }

  async createItems(images: File[]): Promise<BatchWardrobeItemsResponse> {
    const body = new FormData();
    for (const image of images) {
      body.append('images', image, image.name);
    }

    const response = await this.authorized(() => firstValueFrom(this.http.post<BatchWardrobeItemsResponse>(this.url('/api/wardrobe/items/batch'), body, this.authOptions())));
    return {
      ...response,
      results: response.results.map((result) => ({
        ...result,
        item: result.item ? this.normaliseItem(result.item) : null
      }))
    };
  }

  async updateItem(id: string, request: UpdateWardrobeItemRequest): Promise<WardrobeItemDto> {
    const response = await this.authorized(() => firstValueFrom(this.http.put<{ item: WardrobeItemDto }>(this.url(`/api/wardrobe/items/${id}`), request, this.authOptions())));
    return this.normaliseItem(response.item);
  }

  async deleteItem(id: string): Promise<void> {
    await this.authorized(() => firstValueFrom(this.http.delete<void>(this.url(`/api/wardrobe/items/${id}`), this.authOptions())));
  }

  async searchOutfits(query: string, requiredItemId: string | null = null): Promise<GeneratedOutfitDto[]> {
    const response = await this.authorized(() => firstValueFrom(this.http.post<{ outfits: GeneratedOutfitDto[] }>(this.url('/api/outfits/search'), { query, requiredItemId }, this.authOptions())));
    return response.outfits.map((outfit) => ({
      ...outfit,
      imageUrl: this.normaliseAssetUrl(outfit.imageUrl)
    }));
  }

  async saveOutfit(name: string, prompt: string | null, explanation: string | null, itemIds: string[], imageUrl: string | null = null): Promise<OutfitDto> {
    const response = await this.authorized(() => firstValueFrom(this.http.post<{ outfit: OutfitDto }>(this.url('/api/outfits'), { name, prompt, explanation, itemIds, imageUrl }, this.authOptions())));
    return this.normaliseOutfit(response.outfit);
  }

  async getOutfits(): Promise<OutfitDto[]> {
    const response = await this.authorized(() => firstValueFrom(this.http.get<{ outfits: OutfitDto[] }>(this.url('/api/outfits'), this.authOptions())));
    return response.outfits.map((outfit) => this.normaliseOutfit(outfit));
  }

  streamImageGenerationStatuses(
    itemIds: string[],
    outfitIds: string[],
    onUpdate: (updates: ImageGenerationStreamUpdate[]) => void,
    onError?: () => void
  ): ImageGenerationStatusStream | null {
    if (itemIds.length === 0 && outfitIds.length === 0) {
      return null;
    }

    const accessToken = this.auth.token;
    if (!accessToken) {
      return null;
    }

    if (typeof fetch === 'undefined' || typeof AbortController === 'undefined') {
      return null;
    }

    const query = new URLSearchParams();
    if (itemIds.length > 0) {
      query.set('itemIds', itemIds.join(','));
    }

    if (outfitIds.length > 0) {
      query.set('outfitIds', outfitIds.join(','));
    }

    const controller = new AbortController();
    let closed = false;

    void this.readImageGenerationStatusStream(
      `${this.url('/api/wardrobe/image-generation/stream')}?${query.toString()}`,
      accessToken,
      controller.signal,
      onUpdate)
      .catch(() => {
        if (!closed) {
          onError?.();
        }
      });

    return {
      close: () => {
        closed = true;
        controller.abort();
      }
    };
  }

  async deleteOutfit(id: string): Promise<void> {
    await this.authorized(() => firstValueFrom(this.http.delete<void>(this.url(`/api/outfits/${id}`), this.authOptions())));
  }

  async markWorn(id: string): Promise<void> {
    await this.authorized(() => firstValueFrom(this.http.post(this.url(`/api/outfits/${id}/wear-logs`), {}, this.authOptions())));
  }

  async markItemWorn(id: string): Promise<void> {
    await this.authorized(() => firstValueFrom(this.http.post(this.url(`/api/wardrobe/items/${id}/wear-logs`), {}, this.authOptions())));
  }

  async getAiUsageCostSummary(): Promise<AiUsageCostSummaryDto> {
    return this.authorized(() => firstValueFrom(this.http.get<AiUsageCostSummaryDto>(this.url('/api/usage/ai'), this.authOptions())));
  }

  private url(path: string): string {
    return `${environment.apiBaseUrl}${path}`;
  }

  private queryString(params: Record<string, string | number | boolean | null | undefined>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === '') {
        continue;
      }

      query.set(key, String(value));
    }

    return query.toString();
  }

  private authOptions(): { headers: HttpHeaders } {
    return { headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token ?? ''}` }) };
  }

  private async authorized<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      await this.auth.handleUnauthorized(error);
      throw error;
    }
  }

  private async readImageGenerationStatusStream(
    url: string,
    accessToken: string,
    signal: AbortSignal,
    onUpdate: (updates: ImageGenerationStreamUpdate[]) => void
  ): Promise<void> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`Image generation stream failed with status ${response.status}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        this.applyImageGenerationStatusStreamEvent(event, onUpdate);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      this.applyImageGenerationStatusStreamEvent(buffer, onUpdate);
    }
  }

  private applyImageGenerationStatusStreamEvent(
    event: string,
    onUpdate: (updates: ImageGenerationStreamUpdate[]) => void
  ): void {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).replace(/^\s+/, ''))
      .join('\n');

    if (!data) {
      return;
    }

    try {
      const updates = JSON.parse(data) as ImageGenerationStreamUpdate[];
      onUpdate(updates);
    } catch {
      // Ignore malformed stream payloads.
    }
  }

  private normaliseOutfit(outfit: OutfitDto): OutfitDto {
    return {
      ...outfit,
      imageUrl: this.normaliseAssetUrl(outfit.imageUrl),
      items: outfit.items.map((item) => this.normaliseItem(item))
    };
  }

  private normaliseItem(item: WardrobeItemDto): WardrobeItemDto {
    return {
      ...item,
      image: {
        originalUrl: this.normaliseAssetUrl(item.image.originalUrl) ?? '',
        displayUrl: this.normaliseAssetUrl(item.image.displayUrl) ?? '',
        canonicalUrl: this.normaliseAssetUrl(item.image.canonicalUrl),
        thumbnailUrl: this.normaliseAssetUrl(item.image.thumbnailUrl)
      }
    };
  }

  private normaliseAssetUrl(value: string | null): string | null {
    if (!value) {
      return value;
    }

    if (/^(https?:|data:|blob:)/i.test(value)) {
      return value;
    }

    return value.startsWith('/')
      ? `${environment.apiBaseUrl}${value}`
      : `${environment.apiBaseUrl}/${value}`;
  }
}
