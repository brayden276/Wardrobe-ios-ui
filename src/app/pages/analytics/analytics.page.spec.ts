import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { AnalyticsPage } from './analytics.page';
import { AuthService } from '../../auth.service';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { AnalyticsSummaryDto } from '../../models';

describe('AnalyticsPage', () => {
  let component: AnalyticsPage;
  let mockApi: jasmine.SpyObj<WardrobeApiService>;
  let mockAuth: jasmine.SpyObj<AuthService>;
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
    mockApi = jasmine.createSpyObj<WardrobeApiService>('WardrobeApiService', ['getAnalyticsSummary', 'getItems']);
    mockApi.getItems.and.resolveTo([]);
    mockApi.getAnalyticsSummary.and.returnValue(Promise.resolve(mockAnalyticsData));

    mockRouter = jasmine.createSpyObj<Router>('Router', ['navigateByUrl']);
    mockRouter.navigateByUrl.and.returnValue(Promise.resolve(true));

    mockAuth = jasmine.createSpyObj<AuthService>('AuthService', ['restore']);
    mockAuth.restore.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      declarations: [AnalyticsPage],
      imports: [CommonModule, IonicModule.forRoot(), RouterTestingModule],
      providers: [
        AnalyticsPage,
        { provide: WardrobeApiService, useValue: mockApi },
        { provide: AuthService, useValue: mockAuth },
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
    expect(component.view?.totalCost).toBe('$0.0460');
  });

  it('should switch cost and metrics when scope changes to platform', async () => {
    await component.loadAnalytics();
    expect(component.scope).toBe('user');
    expect(component.view?.totalCost).toBe('$0.0460');

    component.setScope('platform');
    expect(component.scope).toBe('platform');
    expect(component.view?.totalCost).toBe('$0.1340');
    expect(component.view?.totalItems).toBe(10);
  });

  it('should compute category distribution accurately', async () => {
    await component.loadAnalytics();
    const categories = component.view?.categoryList ?? [];
    expect(categories.length).toBe(3);
    expect(categories[0].id).toBe('tops');
    expect(categories[0].count).toBe(2);
    expect(categories[0].percentage).toBe(50);
  });

  it('should compute colour distribution accurately', async () => {
    await component.loadAnalytics();
    const colours = component.view?.colourList ?? [];
    expect(colours.length).toBe(2);
    expect(colours[0].percentage).toBe(50);
  });

  it('keeps derived lists stable between checks and rebuilds them when the scope changes', async () => {
    await component.loadAnalytics();
    const userCategories = component.view?.categoryList;
    const userColours = component.view?.colourList;

    expect(component.view?.categoryList).toBe(userCategories);
    expect(component.view?.colourList).toBe(userColours);

    component.setScope('platform');
    const platformCategories = component.view?.categoryList;
    expect(platformCategories).not.toBe(userCategories);

    component.setScope('user');
    expect(component.view?.categoryList).not.toBe(platformCategories);
    expect(component.view?.categoryList.map(category => category.id)).toEqual(userCategories?.map(category => category.id));
  });

  it('should navigate to settings when openSettings is called', () => {
    component.openSettings();
    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tabs/settings');
  });

  it('does not send an unauthenticated request when session restoration fails', async () => {
    mockAuth.restore.and.rejectWith(new Error('Session storage unavailable'));
    await component.loadAnalytics();
    expect(mockApi.getAnalyticsSummary).not.toHaveBeenCalled();
    expect(component.error).toBe('Session storage unavailable');
    expect(component.isLoading).toBeFalse();
    expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
  });

  it('renders system analytics and both scopes using the actual page template', async () => {
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(AnalyticsPage);
    fixture.detectChanges();
    await fixture.componentInstance.loadAnalytics();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('PostgreSQL (EF Core)');
    expect(fixture.nativeElement.textContent).toContain('gemini-2.5-flash-lite');
    expect(fixture.nativeElement.textContent).toContain('$0.0460');
    const platformTab = fixture.nativeElement.querySelectorAll('.scope-tab')[1] as HTMLButtonElement;
    platformTab.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.scope).toBe('platform');
    expect(fixture.nativeElement.textContent).toContain('$0.1340');
    expect(fixture.nativeElement.querySelector('.distribution-row.clickable-row')).toBeNull();
    fixture.destroy();
  });

  it('shares overlapping loads and completes each pull-to-refresh', async () => {
    let resolve!: (summary: AnalyticsSummaryDto) => void;
    mockApi.getAnalyticsSummary.and.returnValue(new Promise(done => resolve = done));
    const first = { target: { complete: jasmine.createSpy('firstComplete') } };
    const second = { target: { complete: jasmine.createSpy('secondComplete') } };
    const pending = component.loadAnalytics(first);
    const overlapping = component.loadAnalytics(second);
    await Promise.resolve();
    resolve(mockAnalyticsData);
    await Promise.all([pending, overlapping]);
    expect(mockApi.getAnalyticsSummary).toHaveBeenCalledTimes(1);
    expect(first.target.complete).toHaveBeenCalledTimes(1);
    expect(second.target.complete).toHaveBeenCalledTimes(1);
    expect(component.isLoading).toBeFalse();
  });

  it('includes archived garments in personal category totals', async () => {
    await component.openCategoryItems({ id: 'tops', label: 'Tops', count: 2 });
    expect(mockApi.getItems).toHaveBeenCalledWith({ categoryId: 'tops', includeArchived: true });
  });

  it('does not open personal garments for platform category totals', async () => {
    component.setScope('platform');
    await component.openCategoryItems({ id: 'tops', label: 'Tops', count: 5 });
    expect(mockApi.getItems).not.toHaveBeenCalled();
    expect(component.selectedCategory).toBeNull();
  });

  it('ignores a category failure after switching scope', async () => {
    let reject!: (error: Error) => void;
    mockApi.getItems.and.returnValue(new Promise((_, fail) => reject = fail));
    const pending = component.openCategoryItems({ id: 'tops', label: 'Tops', count: 2 });
    component.setScope('platform');
    reject(new Error('Old category failure'));
    await pending;
    expect(component.selectedCategory).toBeNull();
    expect(component.categoryItemsError).toBe('');
    expect(component.isLoadingCategoryItems).toBeFalse();
  });

  it('should handle error when API call fails', async () => {
    mockApi.getAnalyticsSummary.and.returnValue(Promise.reject(new Error('Network error')));
    await component.loadAnalytics();
    expect(component.error).toBe('Network error');
    expect(component.isLoading).toBeFalse();
  });

  it('should restore the session before requesting analytics', async () => {
    const order: string[] = [];
    mockAuth.restore.and.callFake(async () => {
      order.push('restore');
    });
    mockApi.getAnalyticsSummary.and.callFake(async () => {
      order.push('analytics');
      return mockAnalyticsData;
    });
    await component.loadAnalytics();
    expect(order).toEqual(['restore', 'analytics']);
  });

  it('should stay on the page with feedback when loading fails', async () => {
    mockApi.getAnalyticsSummary.and.returnValue(Promise.reject(new Error('Server error')));
    await component.loadAnalytics();
    expect(component.error).toBe('Server error');
    expect(component.analytics).toBeNull();
    expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
  });
});
