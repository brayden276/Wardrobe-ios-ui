import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WardrobeApiService } from './wardrobe-api.service';
import { AuthService } from './auth.service';
import { DeviceImageCacheService } from './device-image-cache.service';
import { apiBaseUrl } from './api-url';
import { readMessage } from './pages/page-helpers';
import {
  AiUsageCostSummaryDto,
  AnalyticsSummaryDto,
  BatchWardrobeItemsResponse,
  BulkDeleteResponse,
  OutfitDto,
  UpdateWardrobeItemRequest,
  WardrobeItemDto,
  WardrobeLookupsDto
} from './models';

describe('WardrobeApiService', () => {
  let service: WardrobeApiService;
  let httpTesting: HttpTestingController;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockImageCache: jasmine.SpyObj<DeviceImageCacheService>;
  const baseUrl = apiBaseUrl();

  const mockLookups: WardrobeLookupsDto = {
    categories: [
      {
        id: 'tops',
        label: 'Tops',
        subcategories: [{ id: 'tshirt', label: 'T-Shirt' }]
      }
    ],
    colours: [{ id: 'black', label: 'Black' }],
    patterns: [{ id: 'plain', label: 'Plain' }],
    visibleMaterials: [{ id: 'cotton', label: 'Cotton' }],
    necklines: [{ id: 'crew', label: 'Crew Neck' }],
    sleeveLengths: [{ id: 'short', label: 'Short Sleeve' }],
    fits: [{ id: 'regular', label: 'Regular' }],
    garmentLengths: [{ id: 'waist', label: 'Waist' }],
    bottomShapes: [{ id: 'straight', label: 'Straight' }],
    rises: [{ id: 'mid', label: 'Mid Rise' }],
    occasions: [{ id: 'casual', label: 'Casual' }],
    formalities: [{ id: 'everyday', label: 'Everyday' }]
  };

  const mockItem: WardrobeItemDto = {
    id: 'item-1',
    name: 'Black Crew T-Shirt',
    categoryId: 'tops',
    subcategoryId: 'tshirt',
    primaryColourId: 'black',
    secondaryColourIds: [],
    patternId: 'plain',
    visibleMaterialId: 'cotton',
    necklineId: 'crew',
    sleeveLengthId: 'short',
    fitId: 'regular',
    lengthId: 'waist',
    bottomShapeId: null,
    riseId: null,
    isArchived: false,
    isDeleted: false,
    wearCount: 3,
    lastWornAt: '2026-08-30T10:00:00Z',
    image: {
      originalUrl: '/uploads/orig.jpg',
      displayUrl: '/uploads/disp.jpg',
      canonicalUrl: '/uploads/canon.jpg',
      thumbnailUrl: '/uploads/thumb.jpg'
    },
    imageGenerationStatus: 'completed',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z'
  };

  const mockOutfit: OutfitDto = {
    id: 'outfit-1',
    name: 'Casual Day Outfit',
    prompt: 'Weekend brunch',
    explanation: 'Clean and casual combination',
    imageUrl: '/uploads/outfit.jpg',
    thumbnailUrl: '/uploads/outfit-thumb.jpg',
    imageGenerationStatus: 'completed',
    isDeleted: false,
    items: [mockItem],
    wearCount: 1,
    lastWornAt: '2026-08-31T12:00:00Z',
    createdAt: '2026-08-15T12:00:00Z',
    updatedAt: '2026-08-15T12:00:00Z'
  };

  beforeEach(() => {
    mockAuthService = jasmine.createSpyObj<AuthService>('AuthService', ['refreshSession', 'handleUnauthorized'], {
      token: 'valid-test-token'
    });
    mockAuthService.refreshSession.and.returnValue(Promise.resolve(true));
    mockAuthService.handleUnauthorized.and.returnValue(Promise.resolve());

    mockImageCache = jasmine.createSpyObj<DeviceImageCacheService>('DeviceImageCacheService', ['resolve']);
    mockImageCache.resolve.and.callFake((url: string | null) => Promise.resolve(url));

    TestBed.configureTestingModule({
      providers: [
        WardrobeApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: mockAuthService },
        { provide: DeviceImageCacheService, useValue: mockImageCache }
      ]
    });

    service = TestBed.inject(WardrobeApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('normaliseAssetUrl()', () => {
    it('should return null or falsy values as is', () => {
      expect((service as any).normaliseAssetUrl(null)).toBeNull();
      expect((service as any).normaliseAssetUrl('')).toBe('');
    });

    it('should prefix relative paths with leading slash using apiBaseUrl', () => {
      const result = (service as any).normaliseAssetUrl('/uploads/image.png');
      expect(result).toBe(`${baseUrl}/uploads/image.png`);
    });

    it('should prefix relative paths without leading slash using apiBaseUrl', () => {
      const result = (service as any).normaliseAssetUrl('uploads/image.png');
      expect(result).toBe(`${baseUrl}/uploads/image.png`);
    });

    it('should allow full URLs that match the API base URL origin', () => {
      const fullApiUrl = `${baseUrl}/images/photo.jpg`;
      const result = (service as any).normaliseAssetUrl(fullApiUrl);
      expect(result).toBe(fullApiUrl);
    });

    it('should allow external S3/CDN URLs', () => {
      const s3Url = 'https://s3.amazonaws.com/wardrobe-bucket/item123.jpg';
      const result = (service as any).normaliseAssetUrl(s3Url);
      expect(result).toBe(s3Url);

      const cdnUrl = 'https://cdn.wardrobe.ai/images/photo.webp';
      expect((service as any).normaliseAssetUrl(cdnUrl)).toBe(cdnUrl);
    });

    it('should return null for data: or blob: URIs', () => {
      expect((service as any).normaliseAssetUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBeNull();
      expect((service as any).normaliseAssetUrl('blob:http://localhost:5055/blob-id')).toBeNull();
    });
  });

  describe('Lookup catalog fetching and caching', () => {
    it('should fetch lookups from /api/lookups/wardrobe with auth headers', async () => {
      const lookupsPromise = service.getLookups();

      const req = httpTesting.expectOne(`${baseUrl}/api/lookups/wardrobe`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer valid-test-token');
      req.flush(mockLookups);

      const result = await lookupsPromise;
      expect(result).toEqual(mockLookups);
    });

    it('should cache lookups in memory and not repeat HTTP requests on subsequent calls', async () => {
      const p1 = service.getLookups();
      httpTesting.expectOne(`${baseUrl}/api/lookups/wardrobe`).flush(mockLookups);
      const res1 = await p1;

      const p2 = service.getLookups();
      httpTesting.expectNone(`${baseUrl}/api/lookups/wardrobe`);
      const res2 = await p2;

      expect(res1).toEqual(mockLookups);
      expect(res2).toEqual(mockLookups);
    });

    it('should reset lookups cache on error so subsequent call retries', async () => {
      const p1 = service.getLookups();
      const req1 = httpTesting.expectOne(`${baseUrl}/api/lookups/wardrobe`);
      req1.flush({ message: 'Server error' }, { status: 500, statusText: 'Internal Server Error' });

      await expectAsync(p1).toBeRejected();

      const p2 = service.getLookups();
      const req2 = httpTesting.expectOne(`${baseUrl}/api/lookups/wardrobe`);
      req2.flush(mockLookups);

      const res2 = await p2;
      expect(res2).toEqual(mockLookups);
    });
  });

  describe('Wardrobe items CRUD and caching', () => {
    it('getItems() should fetch and normalise wardrobe items, and cache subsequent requests', async () => {
      const p1 = service.getItems({ categoryId: 'tops' });
      const req1 = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items?categoryId=tops`);
      expect(req1.request.method).toBe('GET');
      req1.flush({ items: [mockItem] });

      const items1 = await p1;
      expect(items1.length).toBe(1);
      expect(items1[0].name).toBe('Black Crew T-Shirt');
      expect(items1[0].image.originalUrl).toBe(`${baseUrl}/uploads/orig.jpg`);

      // Second call with same params should hit cache
      const p2 = service.getItems({ categoryId: 'tops' });
      httpTesting.expectNone(`${baseUrl}/api/wardrobe/items?categoryId=tops`);
      const items2 = await p2;
      expect(items2).toEqual(items1);
    });

    it('getItems() with forceRefresh should bypass cache', async () => {
      const p1 = service.getItems();
      httpTesting.expectOne(`${baseUrl}/api/wardrobe/items`).flush({ items: [mockItem] });
      await p1;

      const p2 = service.getItems({}, { forceRefresh: true });
      const req2 = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items`);
      req2.flush({ items: [mockItem] });
      const items2 = await p2;
      expect(items2.length).toBe(1);
    });

    it('getItem(id) should unwrap wrapped item responses and normalise display url with cache service', async () => {
      const p = service.getItem('item-1');
      const req = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items/item-1`);
      req.flush({ item: mockItem });

      const item = await p;
      expect(item.id).toBe('item-1');
      expect(mockImageCache.resolve).toHaveBeenCalled();
    });

    it('createItem() should send FormData and clear wardrobe caches', async () => {
      // Prime cache
      const getP = service.getItems();
      httpTesting.expectOne(`${baseUrl}/api/wardrobe/items`).flush({ items: [mockItem] });
      await getP;

      const mockBlob = new Blob(['sample-img'], { type: 'image/jpeg' });
      const createP = service.createItem(mockBlob, 'shirt.jpg');

      const req = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body instanceof FormData).toBeTrue();
      req.flush({ item: mockItem });

      const created = await createP;
      expect(created.id).toBe('item-1');

      // Next getItems should hit network because cache was cleared
      const getP2 = service.getItems();
      httpTesting.expectOne(`${baseUrl}/api/wardrobe/items`).flush({ items: [mockItem] });
      await getP2;
    });

    it('createItem() should return multiple items when detected in outfit photo', async () => {
      const mockItem2 = { ...mockItem, id: 'item-2', name: 'Black Jeans' };
      const mockBlob = new Blob(['outfit-img'], { type: 'image/jpeg' });
      const createP = service.createItem(mockBlob, 'outfit.jpg');

      const req = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items`);
      req.flush({ item: mockItem, items: [mockItem, mockItem2] });

      const created = await createP;
      expect(created.id).toBe('item-1');
      expect(created.items?.length).toBe(2);
      expect(created.items?.[1].id).toBe('item-2');
    });

    it('createItems() batch should send multiple files in FormData and normalise results', async () => {
      const file1 = new File(['content1'], 'img1.jpg', { type: 'image/jpeg' });
      const file2 = new File(['content2'], 'img2.jpg', { type: 'image/jpeg' });

      const mockBatchResponse: BatchWardrobeItemsResponse = {
        succeededCount: 1,
        failedCount: 1,
        results: [
          { fileName: 'img1.jpg', success: true, item: mockItem, error: null },
          { fileName: 'img2.jpg', success: false, item: null, error: 'Could not classify image' }
        ]
      };

      const batchP = service.createItems([file1, file2]);
      const req = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items/batch`);
      expect(req.request.method).toBe('POST');
      req.flush(mockBatchResponse);

      const response = await batchP;
      expect(response.succeededCount).toBe(1);
      expect(response.results[0].item?.name).toBe('Black Crew T-Shirt');
      expect(response.results[1].error).toBe('Could not classify image');
    });

    it('updateItem() should send PUT request and clear cache', async () => {
      const updateRequest: UpdateWardrobeItemRequest = {
        name: 'Updated T-Shirt',
        categoryId: 'tops',
        subcategoryId: 'tshirt',
        primaryColourId: 'black',
        secondaryColourIds: [],
        patternId: null,
        visibleMaterialId: null,
        necklineId: null,
        sleeveLengthId: null,
        fitId: null,
        lengthId: null,
        bottomShapeId: null,
        riseId: null
      };

      const updateP = service.updateItem('item-1', updateRequest);
      const req = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items/item-1`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updateRequest);
      req.flush({ item: { ...mockItem, name: 'Updated T-Shirt' } });

      const result = await updateP;
      expect(result.name).toBe('Updated T-Shirt');
    });

    it('deleteItem() should send DELETE request and clear cache', async () => {
      const deleteP = service.deleteItem('item-1');
      const req = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items/item-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);

      await deleteP;
    });

    it('deleteItems() should send bulk-delete POST and return BulkDeleteResponse', async () => {
      const mockBulkResponse: BulkDeleteResponse = {
        requestedCount: 2,
        deletedCount: 2,
        deletedIds: ['item-1', 'item-2'],
        notFoundIds: []
      };

      const deleteP = service.deleteItems(['item-1', 'item-2']);
      const req = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items/bulk-delete`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ ids: ['item-1', 'item-2'] });
      req.flush(mockBulkResponse);

      const result = await deleteP;
      expect(result.deletedCount).toBe(2);
    });

    it('markItemWorn() should post to wear-logs and clear wardrobe cache', async () => {
      const wearP = service.markItemWorn('item-1');
      const req = httpTesting.expectOne(`${baseUrl}/api/wardrobe/items/item-1/wear-logs`);
      expect(req.request.method).toBe('POST');
      req.flush({});

      await wearP;
    });
  });

  describe('Outfits API and AI Search', () => {
    it('searchOutfits() should send search query and normalise generated outfits', async () => {
      const mockGenerated = {
        outfits: [
          {
            title: 'Brunch Look',
            itemIds: ['item-1'],
            explanation: 'Casual and fresh',
            imageUrl: '/uploads/generated-outfit.jpg',
            isComplete: true,
            missingCategories: [],
            relaxedConstraints: []
          }
        ]
      };

      const searchP = service.searchOutfits('brunch outfit', 'item-1');
      const req = httpTesting.expectOne(`${baseUrl}/api/outfits/search`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ query: 'brunch outfit', requiredItemId: 'item-1' });
      req.flush(mockGenerated);

      const outfits = await searchP;
      expect(outfits.length).toBe(1);
      expect(outfits[0].title).toBe('Brunch Look');
      expect(outfits[0].imageUrl).toBe(`${baseUrl}/uploads/generated-outfit.jpg`);
      expect(outfits[0].displayImageUrl).toBe(`${baseUrl}/uploads/generated-outfit.jpg`);
    });

    it('getOutfits() should cache results and support includePending', async () => {
      const p1 = service.getOutfits({ includePending: true });
      const req1 = httpTesting.expectOne(`${baseUrl}/api/outfits?includePending=true`);
      req1.flush({ outfits: [mockOutfit] });

      const outfits1 = await p1;
      expect(outfits1.length).toBe(1);
      expect(outfits1[0].name).toBe('Casual Day Outfit');

      // Cached read
      const p2 = service.getOutfits({ includePending: true });
      httpTesting.expectNone(`${baseUrl}/api/outfits?includePending=true`);
      const outfits2 = await p2;
      expect(outfits2).toEqual(outfits1);
    });

    it('saveOutfit() should post outfit data and return normalised outfit', async () => {
      const saveP = service.saveOutfit('New Outfit', 'smart casual', 'great match', ['item-1'], '/uploads/outfit.jpg');
      const req = httpTesting.expectOne(`${baseUrl}/api/outfits`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        name: 'New Outfit',
        prompt: 'smart casual',
        explanation: 'great match',
        itemIds: ['item-1'],
        imageUrl: '/uploads/outfit.jpg'
      });
      req.flush({ outfit: mockOutfit });

      const result = await saveP;
      expect(result.id).toBe('outfit-1');
      expect(result.imageUrl).toBe(`${baseUrl}/uploads/outfit.jpg`);
    });

    it('deleteOutfit() and markWorn() should post to appropriate endpoints', async () => {
      const delP = service.deleteOutfit('outfit-1');
      const reqDel = httpTesting.expectOne(`${baseUrl}/api/outfits/outfit-1`);
      expect(reqDel.request.method).toBe('DELETE');
      reqDel.flush(null);
      await delP;

      const wearP = service.markWorn('outfit-1');
      const reqWear = httpTesting.expectOne(`${baseUrl}/api/outfits/outfit-1/wear-logs`);
      expect(reqWear.request.method).toBe('POST');
      reqWear.flush({});
      await wearP;
    });

    it('getAiUsageCostSummary() should call /api/usage/ai', async () => {
      const mockSummary: AiUsageCostSummaryDto = {
        totalCostUsd: 1.25,
        wardrobeItemClassifications: 10,
        outfitSearches: 5,
        displayImages: 8,
        outfitImages: 3
      };

      const usageP = service.getAiUsageCostSummary();
      const req = httpTesting.expectOne(`${baseUrl}/api/usage/ai`);
      expect(req.request.method).toBe('GET');
      req.flush(mockSummary);

      const result = await usageP;
      expect(result.totalCostUsd).toBe(1.25);
      expect(result.outfitSearches).toBe(5);
    });

    it('getAnalyticsSummary() should call /api/analytics', async () => {
      const mockAnalytics: AnalyticsSummaryDto = {
        userCost: {
          totalCostUsd: 0.088,
          classifications: { count: 2, unitCostUsd: 0.002, subtotalCostUsd: 0.004 },
          outfitSearches: { count: 0, unitCostUsd: 0.002, subtotalCostUsd: 0 },
          displayImages: { count: 2, unitCostUsd: 0.042, subtotalCostUsd: 0.084 },
          outfitImages: { count: 0, unitCostUsd: 0.042, subtotalCostUsd: 0 }
        },
        userMetrics: {
          totalItems: 2,
          activeItems: 2,
          archivedItems: 0,
          totalOutfits: 0,
          outfitsWithImages: 0,
          totalWearCount: 1,
          itemsByCategory: { tops: 1, bottoms: 1 },
          itemsByColour: { blue: 1, black: 1 },
          topWornItems: []
        },
        platformCost: {
          totalCostUsd: 0.088,
          classifications: { count: 2, unitCostUsd: 0.002, subtotalCostUsd: 0.004 },
          outfitSearches: { count: 0, unitCostUsd: 0.002, subtotalCostUsd: 0 },
          displayImages: { count: 2, unitCostUsd: 0.042, subtotalCostUsd: 0.084 },
          outfitImages: { count: 0, unitCostUsd: 0.042, subtotalCostUsd: 0 }
        },
        platformMetrics: {
          totalItems: 2,
          activeItems: 2,
          archivedItems: 0,
          totalOutfits: 0,
          outfitsWithImages: 0,
          totalWearCount: 1,
          itemsByCategory: { tops: 1, bottoms: 1 },
          itemsByColour: { blue: 1, black: 1 },
          topWornItems: []
        },
        platformTelemetry: {
          totalUsers: 1,
          totalPlatformItems: 2,
          totalPlatformOutfits: 0,
          totalPlatformImages: 2,
          totalPlatformCostUsd: 0.088,
          databaseMode: 'Local JSON / In-Memory',
          modelTier: 'gemini-2.5-flash-lite',
          imageModelTier: 'gemini-2.5-flash-image'
        },
        unitRates: {
          classificationEstimateUsd: 0.002,
          outfitSearchEstimateUsd: 0.002,
          displayImageEstimateUsd: 0.042,
          outfitImageEstimateUsd: 0.042
        }
      };

      const analyticsP = service.getAnalyticsSummary();
      const req = httpTesting.expectOne(`${baseUrl}/api/analytics`);
      expect(req.request.method).toBe('GET');
      req.flush(mockAnalytics);

      const result = await analyticsP;
      expect(result.userCost.totalCostUsd).toBe(0.088);
      expect(result.platformTelemetry.totalUsers).toBe(1);
      expect(result.userMetrics.totalItems).toBe(2);
    });
  });

  describe('401 retry handling in authorized()', () => {
    it('renews an expired image-status connection without logging out', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.returnValues(
        Promise.resolve(new Response(null, { status: 401 })),
        Promise.resolve(new Response(null, { status: 503 }))
      );
      const onError = jasmine.createSpy('onError');
      const stream = service.streamImageGenerationStatuses(['item-1'], [], () => {}, onError);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(mockAuthService.refreshSession).toHaveBeenCalledTimes(1);
      expect(mockAuthService.handleUnauthorized).toHaveBeenCalledWith(jasmine.objectContaining({ status: 503 }));
      expect(onError).toHaveBeenCalledTimes(1);
      stream?.close();
    });

    it('handles a genuine rejection of the renewed token', async () => {
      const pending = service.getAnalyticsSummary();
      httpTesting.expectOne(`${baseUrl}/api/analytics`)
        .flush({}, { status: 401, statusText: 'Unauthorized' });
      await new Promise(resolve => setTimeout(resolve, 0));
      httpTesting.expectOne(`${baseUrl}/api/analytics`)
        .flush({}, { status: 401, statusText: 'Unauthorized' });
      await expectAsync(pending).toBeRejected();
      expect(mockAuthService.handleUnauthorized).toHaveBeenCalledWith(jasmine.objectContaining({ status: 401 }));
    });

    it('should retry request when 401 is received and token refresh succeeds', async () => {
      const p = service.getAiUsageCostSummary();

      const req1 = httpTesting.expectOne(`${baseUrl}/api/usage/ai`);
      req1.flush({ message: 'Token expired' }, { status: 401, statusText: 'Unauthorized' });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockAuthService.refreshSession).toHaveBeenCalled();

      const req2 = httpTesting.expectOne(`${baseUrl}/api/usage/ai`);
      const mockSummary: AiUsageCostSummaryDto = {
        totalCostUsd: 0.5,
        wardrobeItemClassifications: 2,
        outfitSearches: 1,
        displayImages: 2,
        outfitImages: 1
      };
      req2.flush(mockSummary);

      const result = await p;
      expect(result.totalCostUsd).toBe(0.5);
    });

    it('should preserve the session when token refresh is temporarily unavailable', async () => {
      mockAuthService.refreshSession.and.returnValue(Promise.resolve(false));

      const p = service.getAiUsageCostSummary();

      const req = httpTesting.expectOne(`${baseUrl}/api/usage/ai`);
      req.flush({ message: 'Token expired' }, { status: 401, statusText: 'Unauthorized' });

      await expectAsync(p).toBeRejected();
      expect(mockAuthService.refreshSession).toHaveBeenCalled();
      expect(mockAuthService.handleUnauthorized).not.toHaveBeenCalled();
    });
  });

  describe('Error message extraction (readMessage with HTTP 400, 401, 500)', () => {
    it('should extract error message from HTTP 400 Bad Request response body', () => {
      const http400Error = {
        status: 400,
        error: { message: 'Image must be less than 10MB.' }
      };

      const extracted = readMessage(http400Error, 'Default fallback');
      expect(extracted).toBe('Image must be less than 10MB.');
    });

    it('should extract error message from HTTP 401 Unauthorized response', () => {
      const http401Error = {
        status: 401,
        error: { message: 'Invalid email or password.' }
      };

      const extracted = readMessage(http401Error, 'Default fallback');
      expect(extracted).toBe('Invalid email or password.');
    });

    it('should extract error message from HTTP 500 Internal Server Error response', () => {
      const http500Error = {
        status: 500,
        error: { message: 'Gemini service timed out. Please try again.' }
      };

      const extracted = readMessage(http500Error, 'Default fallback');
      expect(extracted).toBe('Gemini service timed out. Please try again.');
    });

    it('should handle status 0 network connection errors with friendly message', () => {
      const offlineError = { status: 0 };
      const extracted = readMessage(offlineError, 'Fallback message');
      expect(extracted).toBe('Could not reach Wardrobe AI. Check your connection and try again.');
    });

    it('should fall back to standard Error.message or provided fallback string', () => {
      const standardError = new Error('Client side exception');
      expect(readMessage(standardError, 'Fallback')).toBe('Client side exception');

      const emptyError = {};
      expect(readMessage(emptyError, 'Custom Fallback')).toBe('Custom Fallback');
    });
  });
});
