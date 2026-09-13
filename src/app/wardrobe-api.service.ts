import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, firstValueFrom, timeout } from 'rxjs';
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
FavouriteDto,
LaundryStatusDto,
OutfitDto,
ScheduledOutfitDto,
WearEventDto,
WardrobeExportDto,
  UpdateWardrobeItemRequest,
  WardrobeAnalyticsMetricsDto,
  WardrobeItemDto,
  WardrobeLookupsDto
} from './models';
import { OfflineDataService } from './offline-data.service';

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
private readonly offlineData = inject(OfflineDataService);
  private readonly apiBaseUrl = apiBaseUrl();
  private lookupsPromise: Promise<WardrobeLookupsDto> | null = null;
  private readonly cacheTtlMs = 30_000;
  private readonly itemsCache = new Map<string, CachedApiResponse<WardrobeItemDto[]>>();
  private readonly outfitsCacheKey = 'all';
  private readonly outfitsCache = new Map<string, CachedApiResponse<OutfitDto[]>>();
  private readonly searchOutfitsCache = new Map<string, CachedApiResponse<GeneratedOutfitDto[]>>();
  private onlineStatus = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private lastSessionUserId: string | null | undefined;

  constructor() {
    // Drop user-scoped in-memory caches on sign-out / sign-in / account switch
    // so the next user can never read the previous user's wardrobe or outfits.
    const sessionChanges = (this.auth as unknown as { session$?: Observable<{ user: { id: string } } | null> }).session$;
    sessionChanges?.subscribe((session) => {
      const userId = session?.user.id ?? null;
      if (this.lastSessionUserId !== undefined && this.lastSessionUserId !== userId) {
        this.clearAllUserCaches();
      }
      this.lastSessionUserId = userId;
    });
  }

  get isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine && this.onlineStatus : this.onlineStatus;
  }

  setOnlineStatus(online: boolean): void {
    this.onlineStatus = online;
  }

async getLookups(): Promise<WardrobeLookupsDto> {
  const userId = this.auth.session?.user.id;
  if (!this.isOnline && userId) {
    const cached = await this.offlineData.read<WardrobeLookupsDto>(userId, 'lookups');
    if (cached) return cached;
  }
    if (this.lookupsPromise) return this.lookupsPromise;
    const promise = this.authorized(() => firstValueFrom(this.http.get<WardrobeLookupsDto>(this.url('/api/lookups/wardrobe'), this.authOptions()).pipe(timeout(10000))))
    .then(async (lookups) => {
      if (userId && this.auth.session?.user.id === userId) await this.offlineData.write(userId, 'lookups', lookups);
      return lookups;
    })
      .catch((error) => {
        if (this.lookupsPromise === promise) this.lookupsPromise = null;
        throw error;
      });
    this.lookupsPromise = promise;
    return promise;
  }

async getItems(
    params: Record<string, string | number | boolean | null | undefined> = {},
    options: ApiReadOptions = {}
): Promise<WardrobeItemDto[]> {
  const userId = this.auth.session?.user.id;
  if (!this.isOnline && userId) {
    const cachedItems = await this.offlineData.read<WardrobeItemDto[]>(userId, 'items');
    if (cachedItems) return this.filterOfflineItems(cachedItems, params);
  }
    const query = this.queryString(params);
    const cacheKey = query || 'all';
    const cached = options.forceRefresh ? null : this.getCached(this.itemsCache, cacheKey);
    if (cached) {
      return cached;
    }

  return this.setCached(this.itemsCache, cacheKey, async () => {
    const response = await this.authorized(() =>
      firstValueFrom(
        this.http
          .get<{ items: WardrobeItemDto[] }>(this.url(`/api/wardrobe/items${query ? `?${query}` : ''}`), this.authOptions())
          .pipe(timeout(10000))
      )
    );
    const items = await Promise.all(response.items.map((item) => this.normaliseItem(item, false)));
    if (userId && Object.keys(params).length === 0 && this.auth.session?.user.id === userId) await this.offlineData.write(userId, 'items', items);
    return items;
    });
  }

  async getItem(id: string): Promise<WardrobeItemDto> {
    const response = await this.authorized(() => firstValueFrom(this.http.get<WardrobeItemResponse>(this.url(`/api/wardrobe/items/${id}`), this.authOptions()).pipe(timeout(30_000))));
    return this.normaliseItem(this.unwrapItemResponse(response));
  }

  async createItem(image: Blob, fileName: string): Promise<CreateWardrobeItemResponse> {
    this.requireOnline();
    const body = new FormData();
    body.append('image', image, fileName);
    const response = await this.authorized(() => firstValueFrom(this.http.post<{ item?: WardrobeItemDto; items?: WardrobeItemDto[] }>(this.url('/api/wardrobe/items'), body, this.authOptions()).pipe(timeout(180_000))));
    this.clearWardrobeCaches();
    const rawItem = response.item ?? response.items?.[0];
    if (!rawItem) {
      throw new Error('Wardrobe item response was not in the expected format.');
    }
    const item = await this.normaliseItem(rawItem, false);
    const items = response.items?.length
      ? await Promise.all(response.items.map((entry) => this.normaliseItem(entry, false)))
      : [item];
    return Object.assign(item, { items });
  }

  async createItems(images: File[]): Promise<BatchWardrobeItemsResponse> {
    this.requireOnline();
    const body = new FormData();
    for (const image of images) {
      body.append('images', image, image.name);
    }

    const response = await this.authorized(() => firstValueFrom(this.http.post<BatchWardrobeItemsResponse>(this.url('/api/wardrobe/items/batch'), body, this.authOptions()).pipe(timeout(480_000))));
    this.clearWardrobeCaches();
    return {
      ...response,
      results: await Promise.all(response.results.map(async (result) => {
        const item = result.item ? await this.normaliseItem(result.item, false) : null;
        return {
          ...result,
          item,
          items: result.items?.length
            ? await Promise.all(result.items.map((i) => this.normaliseItem(i, false)))
            : (item ? [item] : null)
        };
      }))
    };
  }

  async updateItem(id: string, request: UpdateWardrobeItemRequest): Promise<WardrobeItemDto> {
    this.requireOnline();
    const response = await this.authorized(() => firstValueFrom(this.http.put<{ item: WardrobeItemDto }>(this.url(`/api/wardrobe/items/${id}`), request, this.authOptions()).pipe(timeout(30_000))));
    this.clearWardrobeCaches();
    return this.normaliseItem(response.item);
  }

  async deleteItem(id: string): Promise<void> {
    this.requireOnline();
    await this.authorized(() => firstValueFrom(this.http.delete<void>(this.url(`/api/wardrobe/items/${id}`), this.authOptions()).pipe(timeout(30_000))));
    this.clearWardrobeCaches();
  }

  async deleteItems(ids: string[]): Promise<BulkDeleteResponse> {
    this.requireOnline();
    const response = await this.authorized(() => firstValueFrom(this.http.post<BulkDeleteResponse>(this.url('/api/wardrobe/items/bulk-delete'), { ids }, this.authOptions()).pipe(timeout(30_000))));
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
      const response = await this.authorized(() => firstValueFrom(this.http.post<{ outfits: GeneratedOutfitDto[] }>(this.url('/api/outfits/search'), { query, requiredItemId }, this.authOptions()).pipe(timeout(300_000))));
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
    this.requireOnline();
    const response = await this.authorized(() => firstValueFrom(this.http.post<{ outfit: OutfitDto }>(this.url('/api/outfits'), { name, prompt, explanation, itemIds, imageUrl }, this.authOptions()).pipe(timeout(30_000))));
    this.clearOutfitCaches();
    // The composition is saved independently of its optional background preview.
    return this.normaliseOutfit(response.outfit);
  }

async getOutfits(options: ApiReadOptions = {}): Promise<OutfitDto[]> {
  const userId = this.auth.session?.user.id;
  if (!this.isOnline && userId) {
    const cachedOutfits = await this.offlineData.read<OutfitDto[]>(
      userId,
      options.includePending ? 'outfits-pending' : 'outfits'
    );
    if (cachedOutfits) return cachedOutfits;
  }
    const cacheKey = options.includePending ? `${this.outfitsCacheKey}:include-pending` : this.outfitsCacheKey;
    const cached = options.forceRefresh ? null : this.getCached(this.outfitsCache, cacheKey);
    if (cached) {
      return cached;
    }

    return this.setCached(this.outfitsCache, cacheKey, async () => {
      const query = options.includePending ? '?includePending=true' : '';
      const response = await this.authorized(() => firstValueFrom(this.http.get<{ outfits: OutfitDto[] }>(this.url(`/api/outfits${query}`), this.authOptions()).pipe(timeout(30_000))));
    const outfits = await Promise.all(response.outfits.map((outfit) => this.normaliseOutfit(outfit)));
    if (userId && this.auth.session?.user.id === userId) {
      await this.offlineData.write(userId, options.includePending ? 'outfits-pending' : 'outfits', outfits);
    }
    return outfits;
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
    let activityTimeout: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(activityTimeout);
      controller.abort();
      onError?.();
    };
    const watchActivity = () => {
      clearTimeout(activityTimeout);
      activityTimeout = setTimeout(finish, 15_000);
    };
    watchActivity();

    void this.authorized(() => this.readImageGenerationStatusStream(
      `${this.url('/api/wardrobe/image-generation/stream')}?${query.toString()}`,
      this.auth.token ?? '',
      controller.signal,
      updates => {
        if (closed) return;
        watchActivity();
        onUpdate(updates);
      }))
      // Ended or stalled streams both fall back to the page's status polling.
      .then(finish, finish);

    return {
      close: () => {
        closed = true;
        clearTimeout(activityTimeout);
        controller.abort();
      }
    };
  }

  async deleteOutfit(id: string): Promise<void> {
    this.requireOnline();
    await this.authorized(() => firstValueFrom(this.http.delete<void>(this.url(`/api/outfits/${id}`), this.authOptions()).pipe(timeout(30_000))));
    this.clearOutfitCaches();
  }

  async deleteOutfits(ids: string[]): Promise<BulkDeleteResponse> {
    this.requireOnline();
    const response = await this.authorized(() => firstValueFrom(this.http.post<BulkDeleteResponse>(this.url('/api/outfits/bulk-delete'), { ids }, this.authOptions()).pipe(timeout(30_000))));
    this.clearOutfitCaches();
    return response;
  }

  async markWorn(id: string): Promise<void> {
    this.requireOnline();
    await this.authorized(() => firstValueFrom(this.http.post(this.url(`/api/outfits/${id}/wear-logs`), {}, this.authOptions()).pipe(timeout(30_000))));
    this.clearOutfitCaches();
  }

  async markItemWorn(id: string): Promise<void> {
    this.requireOnline();
    await this.authorized(() => firstValueFrom(this.http.post(this.url(`/api/wardrobe/items/${id}/wear-logs`), {}, this.authOptions()).pipe(timeout(30_000))));
    this.clearWardrobeCaches();
  }

  async getAiUsageCostSummary(): Promise<AiUsageCostSummaryDto> {
    return this.authorized(() => firstValueFrom(this.http.get<AiUsageCostSummaryDto>(this.url('/api/usage/ai'), this.authOptions()).pipe(timeout(30_000))));
  }

  async getAnalyticsSummary(): Promise<AnalyticsSummaryDto> {
    const summary = await this.authorized(() =>
      firstValueFrom(
        this.http.get<AnalyticsSummaryDto>(this.url('/api/analytics'), this.authOptions()).pipe(
          timeout(10000)
        )
      )
    );
    const normaliseMetrics = (metrics?: WardrobeAnalyticsMetricsDto | null): WardrobeAnalyticsMetricsDto => {
      if (!metrics) {
        return {
          totalItems: 0,
          activeItems: 0,
          archivedItems: 0,
          totalOutfits: 0,
          outfitsWithImages: 0,
          totalWearCount: 0,
          itemsByCategory: {},
          itemsByColour: {},
          topWornItems: []
        };
      }
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

  private filterOfflineItems(
    items: WardrobeItemDto[],
    params: Record<string, string | number | boolean | null | undefined>
  ): WardrobeItemDto[] {
    const textParam = (key: string): string => String(params[key] ?? '').trim().toLowerCase();
    const matches = (value: string | null | undefined, expected: string): boolean =>
      !expected || (value ?? '').toLowerCase() === expected;
    const includeArchived = params['includeArchived'] === true || params['includeArchived'] === 'true';
    const colourId = textParam('colourId');
    const searchTerm = this.canonicaliseOfflineSearch(textParam('search'));

    const filtered = items
      .filter(item => !item.isDeleted && (includeArchived || !item.isArchived))
      .filter(item => matches(item.categoryId, textParam('categoryId')))
      .filter(item => matches(item.subcategoryId, textParam('subcategoryId')))
      .filter(item => matches(item.patternId, textParam('patternId')))
      .filter(item => matches(item.visibleMaterialId, textParam('visibleMaterialId')))
      .filter(item => matches(item.necklineId, textParam('necklineId')))
      .filter(item => matches(item.sleeveLengthId, textParam('sleeveLengthId')))
      .filter(item => matches(item.fitId, textParam('fitId')))
      .filter(item => matches(item.lengthId, textParam('lengthId')))
      .filter(item => matches(item.bottomShapeId, textParam('bottomShapeId')))
      .filter(item => matches(item.riseId, textParam('riseId')))
      .filter(item => !colourId || matches(item.primaryColourId, colourId) || item.secondaryColourIds.some(colour => matches(colour, colourId)))
      .filter(item => !searchTerm || this.canonicaliseOfflineSearch([
        item.id,
        item.name,
        item.categoryId,
        item.subcategoryId,
        item.primaryColourId,
        ...item.secondaryColourIds,
        item.patternId,
        item.visibleMaterialId,
        item.necklineId,
        item.sleeveLengthId,
        item.fitId,
        item.lengthId,
        item.bottomShapeId,
        item.riseId
      ].filter(Boolean).join(' ')).includes(searchTerm))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));

    const offset = this.normaliseOfflinePageNumber(params['offset']);
    const limit = this.normaliseOfflinePageNumber(params['limit']);
    return limit > 0 ? filtered.slice(offset, offset + Math.min(limit, 200)) : filtered.slice(offset);
  }

  private canonicaliseOfflineSearch(value: string): string {
    return Array.from(value.toLowerCase()).filter(character => /[\p{L}\p{N}]/u.test(character)).join('');
  }

  private normaliseOfflinePageNumber(value: string | number | boolean | null | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
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
    const token = this.auth.token;
    return { headers: token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders() };
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
      if (cache.get(key)?.promise === promise) cache.delete(key);
      throw error;
    });

    cache.set(key, {
      expiresAt: Date.now() + this.cacheTtlMs,
      promise
    });

    return promise;
  }

  /** Clears every user-scoped in-memory cache. Call on sign-out / user switch. */
  clearAllUserCaches(): void {
    this.lookupsPromise = null;
    this.itemsCache.clear();
    this.clearOutfitCaches();
  }

  private clearWardrobeCaches(): void {
    this.itemsCache.clear();
    this.clearOutfitCaches();
  }

  private clearOutfitCaches(): void {
    this.outfitsCache.clear();
    this.searchOutfitsCache.clear();
  }

  private async authorized<T>(request: () => Promise<T>): Promise<T> {
    const generation = this.auth.sessionVersion;
    const accessToken = this.auth.token;
    const assertCurrentSession = () => {
      if (generation !== this.auth.sessionVersion) throw new Error('Your session changed. Please try again.');
    };
    try {
      const result = await request();
      assertCurrentSession();
      return result;
    } catch (error) {
      assertCurrentSession();
      if (this.isUnauthorized(error)) {
        // Another request may already have renewed the rejected access token.
        const refreshed = this.auth.token !== accessToken || await this.auth.refreshSession();
        assertCurrentSession();
        if (refreshed) {
          const retryToken = this.auth.token;
          try {
            const result = await request();
            assertCurrentSession();
            return result;
          } catch (retryError) {
            assertCurrentSession();
            if (this.auth.token === retryToken) await this.auth.handleUnauthorized(retryError);
            throw retryError;
          }
        }

        // refreshSession owns invalid-refresh-token handling. A failed refresh
        // can also mean a temporary network/server failure, not a lost session.
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

  private requireOnline(): void {
  if (!this.isOnline) {
    const error = new Error('This change needs an internet connection. Your saved wardrobe is still available offline.') as Error & { status?: number };
    error.status = 0;
    throw error;
  }
}

async updateOutfit(id: string, request: { name?: string; prompt?: string | null; explanation?: string | null; itemIds?: string[] }): Promise<OutfitDto> {
  this.requireOnline();
  const response = await this.authorized(() => firstValueFrom(this.http.put<{ outfit: OutfitDto }>(this.url(`/api/outfits/${id}`), request, this.authOptions()).pipe(timeout(10000))));
  this.clearOutfitCaches();
  return this.normaliseOutfit(response.outfit);
}

async getFavourites(): Promise<FavouriteDto[]> {
  const userId = this.auth.session?.user.id;
  if (!this.isOnline && userId) return (await this.offlineData.read<FavouriteDto[]>(userId, 'favourites')) ?? [];
  const response = await this.authorized(() => firstValueFrom(this.http.get<{ favourites: FavouriteDto[] }>(this.url('/api/wardrobe/favourites'), this.authOptions()).pipe(timeout(10000))));
  if (userId && this.auth.session?.user.id === userId) await this.offlineData.write(userId, 'favourites', response.favourites);
  return response.favourites;
}

async setFavourite(targetType: 'item' | 'outfit', targetId: string, isFavourite: boolean): Promise<void> {
  this.requireOnline();
  await this.authorized(() => firstValueFrom(this.http.put(this.url(`/api/wardrobe/favourites/${targetType}/${targetId}`), { isFavourite }, this.authOptions()).pipe(timeout(10000))));
}

async getWearEvents(params: { itemId?: string; outfitId?: string } = {}): Promise<WearEventDto[]> {
  const query = this.queryString(params);
  const response = await this.authorized(() => firstValueFrom(this.http.get<{ wearEvents: WearEventDto[] }>(this.url(`/api/wardrobe/wear-events${query ? `?${query}` : ''}`), this.authOptions()).pipe(timeout(30_000))));
  return response.wearEvents;
}

async createWearEvent(targetType: 'item' | 'outfit', id: string, wornAt?: string): Promise<WearEventDto> {
  this.requireOnline();
  const base = targetType === 'item' ? `/api/wardrobe/items/${id}` : `/api/outfits/${id}`;
  const result = await this.authorized(() => firstValueFrom(this.http.post<WearEventDto>(this.url(`${base}/wear-events`), wornAt ? { wornAt } : {}, this.authOptions()).pipe(timeout(30_000))));
  this.clearWardrobeCaches();
  return result;
}

async updateWearEvent(id: string, wornAt: string): Promise<WearEventDto> {
  this.requireOnline();
  const result = await this.authorized(() => firstValueFrom(this.http.put<WearEventDto>(this.url(`/api/wardrobe/wear-events/${id}`), { wornAt }, this.authOptions()).pipe(timeout(30_000))));
  this.clearWardrobeCaches();
  return result;
}

async deleteWearEvent(id: string): Promise<void> {
  this.requireOnline();
  await this.authorized(() => firstValueFrom(this.http.delete<void>(this.url(`/api/wardrobe/wear-events/${id}`), this.authOptions()).pipe(timeout(30_000))));
  this.clearWardrobeCaches();
}

async getScheduledOutfits(from?: string, to?: string): Promise<ScheduledOutfitDto[]> {
  const query = this.queryString({ from, to });
  const response = await this.authorized(() => firstValueFrom(this.http.get<{ scheduledOutfits: ScheduledOutfitDto[] }>(this.url(`/api/wardrobe/scheduled-outfits${query ? `?${query}` : ''}`), this.authOptions()).pipe(timeout(30_000))));
  return response.scheduledOutfits;
}

async scheduleOutfit(outfitId: string, scheduledDate: string, note?: string): Promise<ScheduledOutfitDto> {
  this.requireOnline();
  return this.authorized(() => firstValueFrom(this.http.post<ScheduledOutfitDto>(this.url('/api/wardrobe/scheduled-outfits'), { outfitId, scheduledDate, note }, this.authOptions()).pipe(timeout(30_000))));
}

async updateScheduledOutfit(id: string, request: { outfitId?: string; scheduledDate?: string; note?: string }): Promise<ScheduledOutfitDto> {
  this.requireOnline();
  return this.authorized(() => firstValueFrom(this.http.put<ScheduledOutfitDto>(this.url(`/api/wardrobe/scheduled-outfits/${id}`), request, this.authOptions()).pipe(timeout(30_000))));
}

async deleteScheduledOutfit(id: string): Promise<void> {
  this.requireOnline();
  await this.authorized(() => firstValueFrom(this.http.delete<void>(this.url(`/api/wardrobe/scheduled-outfits/${id}`), this.authOptions()).pipe(timeout(30_000))));
}

async getLaundryStatuses(): Promise<LaundryStatusDto[]> {
  const response = await this.authorized(() => firstValueFrom(this.http.get<{ laundryStatuses: LaundryStatusDto[] }>(this.url('/api/wardrobe/laundry'), this.authOptions()).pipe(timeout(30_000))));
  return response.laundryStatuses;
}

async updateLaundryStatus(id: string, isUnavailable: boolean, availableAt?: string | null): Promise<LaundryStatusDto> {
  this.requireOnline();
  return this.authorized(() => firstValueFrom(this.http.put<LaundryStatusDto>(this.url(`/api/wardrobe/items/${id}/laundry`), { isUnavailable, availableAt }, this.authOptions()).pipe(timeout(30_000))));
}

async exportUserData(): Promise<WardrobeExportDto> {
  return this.authorized(() => firstValueFrom(this.http.get<WardrobeExportDto>(this.url('/api/wardrobe/export'), this.authOptions()).pipe(timeout(30_000))));
}
}
