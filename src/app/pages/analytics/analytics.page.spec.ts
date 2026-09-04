import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AnalyticsPage } from './analytics.page';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { AnalyticsSummaryDto } from '../../models';

describe('AnalyticsPage', () => {
  let component: AnalyticsPage;
  let mockApi: jasmine.SpyObj<WardrobeApiService>;
  let mockRouter: jasmine.SpyObj<Router>;

  const mockAnalyticsData: AnalyticsSummaryDto = {
    userCost: {
      totalCostUsd: 0.046,
      classifications: { count: 2, unitCostUsd: 0.002, subtotalCostUsd: 0.004 },
      outfitSearches: { count: 1, unitCostUsd: 0.002, subtotalCostUsd: 0.002 },
      displayImages: { count: 1, unitCostUsd: 0.042, subtotalCostUsd: 0.042 },
      outfitImages: { count: 0, unitCostUsd: 0.042, subtotalCostUsd: 0 }
    },
    userMetrics: {
      totalItems: 4,
      activeItems: 3,
      archivedItems: 1,
      totalOutfits: 2,
      outfitsWithImages: 1,
      totalWearCount: 6,
      itemsByCategory: { tops: 2, bottoms: 1, footwear: 1 },
      itemsByColour: { blue: 2, black: 2 },
      topWornItems: [
        { id: 'item-1', name: 'Blue Tee', categoryId: 'tops', wearCount: 4, thumbnailUrl: null }
      ]
    },
    platformCost: {
      totalCostUsd: 0.134,
      classifications: { count: 10, unitCostUsd: 0.002, subtotalCostUsd: 0.02 },
      outfitSearches: { count: 5, unitCostUsd: 0.002, subtotalCostUsd: 0.01 },
      displayImages: { count: 2, unitCostUsd: 0.042, subtotalCostUsd: 0.084 },
      outfitImages: { count: 1, unitCostUsd: 0.042, subtotalCostUsd: 0.042 }
    },
    platformMetrics: {
      totalItems: 10,
      activeItems: 9,
      archivedItems: 1,
      totalOutfits: 5,
      outfitsWithImages: 3,
      totalWearCount: 15,
      itemsByCategory: { tops: 5, bottoms: 3, outerwear: 2 },
      itemsByColour: { blue: 4, black: 4, grey: 2 },
      topWornItems: []
    },
    platformTelemetry: {
      totalUsers: 3,
      totalPlatformItems: 10,
      totalPlatformOutfits: 5,
      totalPlatformImages: 12,
      totalPlatformCostUsd: 0.134,
      databaseMode: 'PostgreSQL (EF Core)',
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

  beforeEach(() => {
    mockApi = jasmine.createSpyObj<WardrobeApiService>('WardrobeApiService', ['getAnalyticsSummary']);
    mockApi.getAnalyticsSummary.and.returnValue(Promise.resolve(mockAnalyticsData));

    mockRouter = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    mockRouter.navigateByUrl.and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({
      providers: [
        AnalyticsPage,
        { provide: WardrobeApiService, useValue: mockApi },
        { provide: Router, useValue: mockRouter }
      ]
    });

    component = TestBed.inject(AnalyticsPage);
  });

  it('should initialize with default user scope and not loading', () => {
    expect(component).toBeTruthy();
    expect(component.scope).toBe('user');
    expect(component.isLoading).toBeFalse();
    expect(component.analytics).toBeNull();
  });

  it('should load analytics on ionViewWillEnter', async () => {
    await component.ionViewWillEnter();
    expect(mockApi.getAnalyticsSummary).toHaveBeenCalled();
    expect(component.analytics).toEqual(mockAnalyticsData);
    expect(component.formattedTotalCost).toBe('$0.0460');
  });

  it('should switch cost and metrics when scope changes to platform', async () => {
    await component.loadAnalytics();
    expect(component.scope).toBe('user');
    expect(component.formattedTotalCost).toBe('$0.0460');

    component.setScope('platform');
    expect(component.scope).toBe('platform');
    expect(component.formattedTotalCost).toBe('$0.1340');
    expect(component.currentMetrics?.totalItems).toBe(10);
  });

  it('should compute category distribution accurately', async () => {
    await component.loadAnalytics();
    const categories = component.categoryList;
    expect(categories.length).toBe(3);
    expect(categories[0].id).toBe('tops');
    expect(categories[0].count).toBe(2);
    expect(categories[0].percentage).toBe(50);
  });

  it('should compute colour distribution accurately', async () => {
    await component.loadAnalytics();
    const colours = component.colourList;
    expect(colours.length).toBe(2);
    expect(colours[0].percentage).toBe(50);
  });

  it('should navigate to settings when openSettings is called', () => {
    component.openSettings();
    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tabs/settings');
  });

  it('should handle error when API call fails', async () => {
    mockApi.getAnalyticsSummary.and.returnValue(Promise.reject(new Error('Network error')));
    await component.loadAnalytics();
    expect(component.error).toBe('Network error');
    expect(component.isLoading).toBeFalse();
  });
});
