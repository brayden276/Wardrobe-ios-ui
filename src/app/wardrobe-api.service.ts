import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { apiBaseUrl } from './api-url';
import { AuthService } from './auth.service';
import { DeviceImageCacheService } from './device-image-cache.service';
import {
  AiUsageCostSummaryDto,
  AnalyticsSummaryDto,
  BulkDeleteResponse,
  BatchWardrobeItemsResponse,
  CreateWardrobeItemResponse,
  GeneratedOutfitDto,
  ImageGenerationStreamUpdate,
  OutfitDto,
  UpdateWardrobeItemRequest,
  WardrobeAnalyticsMetricsDto,
  WardrobeItemDto,
  WardrobeLookupsDto
} from './models';

export interface ImageGenerationStatusStream {
  close(): void;
}

interface CachedApiResponse<T> {
  expiresAt: number;
  promise: Promise<T>;
}

interface ApiReadOptions {
  forceRefresh?: boolean;
  includePending?: boolean;
}

type WardrobeItemResponse = WardrobeItemDto | { item: WardrobeItemDto };

@Injectable({ providedIn: 'root' })
export class WardrobeApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly imageCache = inject(DeviceImageCacheService);
  private readonly apiBaseUrl = apiBaseUrl();
  private lookupsPromise: Promise<WardrobeLookupsDto> | null = null;
  private readonly cacheTtlMs = 30_000;
  private readonly itemsCache = new Map<string, CachedApiResponse<WardrobeItemDto[]>>();
  private readonly outfitsCacheKey = 'all';
  private readonly outfitsCache = new Map<string, CachedApiResponse<OutfitDto[]>>();
  private readonly searchOutfitsCache = new Map<string, CachedApiResponse<GeneratedOutfitDto[]>>();
  private onlineStatus = typeof navigator !== 'undefined' ? navigator.onLine : true;

  get isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine && this.onlineStatus : this.onlineStatus;
  }

  setOnlineStatus(online: boolean): void {
    this.onlineStatus = online;
  }

  async getLookups(): Promise<WardrobeLookupsDto> {
    this.lookupsPromise ??= this.authorized(() => firstValueFrom(this.http.get<WardrobeLookupsDto>(this.url('/api/lookups/wardrobe'), this.authOptions())))
      .catch((error) => {
        this.lookupsPromise = null;
        throw error;
      });
    return this.lookupsPromise;
  }

  async getItems(
    params: Record<string, string | number | boolean | null | undefined> = {},
    options: ApiReadOptions = {}
  ): Promise<WardrobeItemDto[]> {
    const query = this.queryString(params);
    const cacheKey = query || 'all';
    const cached = options.forceRefresh ? null : this.getCached(this.itemsCache, cacheKey);
    if (cached) {
      return cached;
    }

    return this.setCached(this.itemsCache, cacheKey, async () => {
      const response = await this.authorized(() => firstValueFrom(this.http.get<{ items: WardrobeItemDto[] }>(this.url(`/api/wardrobe/items${query ? `?${query}` : ''}`), this.authOptions())));
      return Promise.all(response.items.map((item) => this.normaliseItem(item, false)));
    });
  }

  async getItem(id: string): Promise<WardrobeItemDto> {
    const response = await this.authorized(() => firstValueFrom(this.http.get<WardrobeItemResponse>(this.url(`/api/wardrobe/items/${id}`), this.authOptions())));
    return this.normaliseItem(this.unwrapItemResponse(response));
  }

  async createItem(image: Blob, fileName: string): Promise<CreateWardrobeItemResponse> {
    const body = new FormData();
    body.append('image', image, fileName);
    const response = await this.authorized(() => firstValueFrom(this.http.post<{ item: WardrobeItemDto; items?: WardrobeItemDto[] }>(this.url('/api/wardrobe/items'), body, this.authOptions())));
    this.clearWardrobeCaches();
    const item = await this.normaliseItem(response.item);
    const items = response.items?.length
      ? await Promise.all(response.items.map((entry) => this.normaliseItem(entry)))
      : [item];
    return Object.assign(item, { items });
  }

  async createItems(images: File[]): Promise<BatchWardrobeItemsResponse> {
    const body = new FormData();
    for (const image of images) {
      body.append('images', image, image.name);
    }

    const response = await this.authorized(() => firstValueFrom(this.http.post<BatchWardrobeItemsResponse>(this.url('/api/wardrobe/items/batch'), body, this.authOptions())));
    this.clearWardrobeCaches();
    return {
      ...response,
      results: await Promise.all(response.results.map(async (result) => ({
        ...result,
        item: result.item ? await this.normaliseItem(result.item) : null,
        items: result.items?.length
          ? await Promise.all(result.items.map((i) => this.normaliseItem(i)))
          : (result.item ? [await this.normaliseItem(result.item)] : null)
      })))
    };
  }

  async updateItem(id: string, request: UpdateWardrobeItemRequest): Promise<WardrobeItemDto> {
    const response = await this.authorized(() => firstValueFrom(this.http.put<{ item: WardrobeItemDto }>(this.url(`/api/wardrobe/items/${id}`), request, this.authOptions())));
    this.clearWardrobeCaches();
    return this.normaliseItem(response.item);
  }

  async deleteItem(id: string): Promise<void> {
    await this.authorized(() => firstValueFrom(this.http.delete<void>(this.url(`/api/wardrobe/items/${id}`), this.authOptions())));
    this.clearWardrobeCaches();
  }

  async deleteItems(ids: string[]): Promise<BulkDeleteResponse> {
    const response = await this.authorized(() => firstValueFrom(this.http.post<BulkDeleteResponse>(this.url('/api/wardrobe/items/bulk-delete'), { ids }, this.authOptions())));
    this.clearWardrobeCaches();
    return response;
  }

  async searchOutfits(query: string, requiredItemId: string | null = null, options: ApiReadOptions = {}): Promise<GeneratedOutfitDto[]> {
    const cacheKey = `${query.trim().toLowerCase()}|${requiredItemId ?? ''}`;
    if (!options.forceRefresh) {
      const cached = this.getCached(this.searchOutfitsCache, cacheKey);
      if (cached) {
        return cached;
      }
    }

    return this.setCached(this.searchOutfitsCache, cacheKey, async () => {
      const response = await this.authorized(() => firstValueFrom(this.http.post<{ outfits: GeneratedOutfitDto[] }>(this.url('/api/outfits/search'), { query, requiredItemId }, this.authOptions())));
      return Promise.all(response.outfits.map(async (outfit) => {
        const imageUrl = this.normaliseAssetUrl(outfit.imageUrl);
        return {
          ...outfit,
          imageUrl,
          isComplete: outfit.isComplete ?? true,
          missingCategories: outfit.missingCategories ?? [],
          relaxedConstraints: outfit.relaxedConstraints ?? [],
          displayImageUrl: imageUrl
        };
      }));
    });
  }

  async saveOutfit(name: string, prompt: string | null, explanation: string | null, itemIds: string[], imageUrl: string | null = null): Promise<OutfitDto> {
    const response = await this.authorized(() => firstValueFrom(this.http.post<{ outfit: OutfitDto }>(this.url('/api/outfits'), { name, prompt, explanation, itemIds, imageUrl }, this.authOptions())));
    this.clearOutfitCaches();
    const outfit = await this.normaliseOutfit(response.outfit);
    return outfit.imageUrl ? outfit : this.waitForOutfitImage(outfit.id);
  }

  async getOutfits(options: ApiReadOptions = {}): Promise<OutfitDto[]> {
    const cacheKey = options.includePending ? `${this.outfitsCacheKey}:include-pending` : this.outfitsCacheKey;
    const cached = options.forceRefresh ? null : this.getCached(this.outfitsCache, cacheKey);
    if (cached) {
      return cached;
    }

    return this.setCached(this.outfitsCache, cacheKey, async () => {
      const query = options.includePending ? '?includePending=true' : '';
      const response = await this.authorized(() => firstValueFrom(this.http.get<{ outfits: OutfitDto[] }>(this.url(`/api/outfits${query}`), this.authOptions())));
      return Promise.all(response.outfits.map((outfit) => this.normaliseOutfit(outfit)));
    });
  }

  streamImageGenerationStatuses(
    itemIds: string[],
    outfitIds: string[],
    onUpdate: (updates: ImageGenerationStreamUpdate[]) => void,
    onError?: () => void
  ): ImageGenerationStatusStream | null {
    if (!this.isOnline || (itemIds.length === 0 && outfitIds.length === 0)) {
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
      .catch(async (error) => {
        await this.auth.handleUnauthorized(error);
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
    this.clearOutfitCaches();
  }

  async deleteOutfits(ids: string[]): Promise<BulkDeleteResponse> {
    const response = await this.authorized(() => firstValueFrom(this.http.post<BulkDeleteResponse>(this.url('/api/outfits/bulk-delete'), { ids }, this.authOptions())));
    this.clearOutfitCaches();
    return response;
  }

  async markWorn(id: string): Promise<void> {
    await this.authorized(() => firstValueFrom(this.http.post(this.url(`/api/outfits/${id}/wear-logs`), {}, this.authOptions())));
    this.clearOutfitCaches();
  }

  async markItemWorn(id: string): Promise<void> {
    await this.authorized(() => firstValueFrom(this.http.post(this.url(`/api/wardrobe/items/${id}/wear-logs`), {}, this.authOptions())));
    this.clearWardrobeCaches();
  }

  async getAiUsageCostSummary(): Promise<AiUsageCostSummaryDto> {
    return this.authorized(() => firstValueFrom(this.http.get<AiUsageCostSummaryDto>(this.url('/api/usage/ai'), this.authOptions())));
  }

  async getAnalyticsSummary(): Promise<AnalyticsSummaryDto> {
    const summary = await this.authorized(() => firstValueFrom(this.http.get<AnalyticsSummaryDto>(this.url('/api/analytics'), this.authOptions())));
    const normaliseMetrics = (metrics?: WardrobeAnalyticsMetricsDto): WardrobeAnalyticsMetricsDto => {
      if (!metrics) return metrics!;
      return {
        ...metrics,
        topWornItems: (metrics.topWornItems ?? []).map((item) => ({
          ...item,
          thumbnailUrl: this.normaliseAssetUrl(item.thumbnailUrl)
        }))
      };
    };
    return {
      ...summary,
      userMetrics: normaliseMetrics(summary.userMetrics),
      platformMetrics: normaliseMetrics(summary.platformMetrics)
    };
  }

  private url(path: string): string {
    return `${this.apiBaseUrl}${path}`;
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

  private getCached<T>(cache: Map<string, CachedApiResponse<T>>, key: string): Promise<T> | null {
    const cached = cache.get(key);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }

    return cached.promise;
  }

  private setCached<T>(cache: Map<string, CachedApiResponse<T>>, key: string, request: () => Promise<T>): Promise<T> {
    const promise = request().catch((error) => {
      cache.delete(key);
      throw error;
    });

    cache.set(key, {
      expiresAt: Date.now() + this.cacheTtlMs,
      promise
    });

    return promise;
  }

  private clearWardrobeCaches(): void {
    this.itemsCache.clear();
    this.clearOutfitCaches();
  }

  private clearOutfitCaches(): void {
    this.outfitsCache.clear();
    this.searchOutfitsCache.clear();
  }

  private async waitForOutfitImage(outfitId: string): Promise<OutfitDto> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const outfits = await this.getOutfits({ forceRefresh: true, includePending: true });
      const outfit = outfits.find((candidate) => candidate.id === outfitId);
      if (!outfit) {
        throw new Error('Outfit image generation did not return a saved outfit.');
      }

      if (outfit.imageUrl) {
        this.clearOutfitCaches();
        return outfit;
      }

      if (outfit.imageGenerationStatus === 'failed') {
        await this.removePendingOutfit(outfitId);
        throw new Error('Outfit image generation failed.');
      }

      await this.delay(1800);
    }

    await this.removePendingOutfit(outfitId);
    throw new Error('Outfit image generation did not finish in time.');
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  private async removePendingOutfit(outfitId: string): Promise<void> {
    try {
      await this.deleteOutfit(outfitId);
    } catch {
      // If cleanup fails, keep the user-facing failure focused on image generation.
    }
  }

  private async authorized<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (this.isUnauthorized(error)) {
        const refreshed = await this.auth.refreshSession();
        if (refreshed) {
          try {
            return await request();
          } catch (retryError) {
            await this.auth.handleUnauthorized(retryError);
            throw retryError;
          }
        }

        await this.auth.handleUnauthorized(error);
        throw error;
      }

      throw error;
    }
  }

  private isUnauthorized(error: unknown): boolean {
    return (error as { status?: number }).status === 401;
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
      const error = new Error(`Image generation stream failed with status ${response.status}.`) as Error & { status?: number };
      error.status = response.status;
      throw error;
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

  private async normaliseOutfit(outfit: OutfitDto): Promise<OutfitDto> {
    return {
      ...outfit,
      isDeleted: outfit.isDeleted ?? false,
      imageUrl: this.normaliseAssetUrl(outfit.imageUrl),
      thumbnailUrl: this.normaliseAssetUrl(outfit.thumbnailUrl),
      items: await Promise.all(outfit.items.map((item) => this.normaliseItem(item, false)))
    };
  }

  private async normaliseItem(item: WardrobeItemDto, resolveDisplayImage = true): Promise<WardrobeItemDto> {
    const image = item.image ?? {
      originalUrl: '',
      displayUrl: '',
      canonicalUrl: null,
      thumbnailUrl: null
    };

    return {
      ...item,
      isDeleted: item.isDeleted ?? false,
      image: {
        originalUrl: this.normaliseAssetUrl(image.originalUrl) ?? '',
        displayUrl: resolveDisplayImage
          ? await this.normaliseDisplayAssetUrl(image.displayUrl) ?? ''
          : this.normaliseAssetUrl(image.displayUrl) ?? '',
        canonicalUrl: this.normaliseAssetUrl(image.canonicalUrl),
        thumbnailUrl: this.normaliseAssetUrl(image.thumbnailUrl)
      }
    };
  }

  private async normaliseDisplayAssetUrl(value: string | null): Promise<string | null> {
    return this.imageCache.resolve(this.normaliseAssetUrl(value));
  }

  private unwrapItemResponse(response: WardrobeItemResponse): WardrobeItemDto {
    if (this.isWrappedItemResponse(response)) {
      return response.item;
    }

    if (this.isWardrobeItem(response)) {
      return response;
    }

    throw new Error('Wardrobe item response was not in the expected format.');
  }

  private isWrappedItemResponse(response: WardrobeItemResponse): response is { item: WardrobeItemDto } {
    return !!response && typeof response === 'object' && 'item' in response && this.isWardrobeItem(response.item);
  }

  private isWardrobeItem(response: unknown): response is WardrobeItemDto {
    return !!response && typeof response === 'object' && 'id' in response && 'image' in response;
  }

  private normaliseAssetUrl(value: string | null): string | null {
    if (!value) {
      return value;
    }

    if (value.startsWith('/')) {
      return `${this.apiBaseUrl}${value}`;
    }

    if (/^https?:\/\//i.test(value)) {
      try {
        const parsed = new URL(value);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          return parsed.toString();
        }
        return null;
      } catch {
        return null;
      }
    }

    if (/^(data:|blob:|javascript:)/i.test(value)) {
      return null;
    }

    return `${this.apiBaseUrl}/${value}`;
  }
}
