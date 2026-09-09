import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AnalyticsSummaryDto, AiCostBreakdownItemDto, AiCostDetailDto, PlatformTelemetryDto, WardrobeAnalyticsMetricsDto, WardrobeItemDto } from '../../models';
import { AuthService } from '../../auth.service';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { readMessage } from '../page-helpers';

export type AnalyticsScope = 'user' | 'platform';

type AnalyticsDistributionRow = { id: string; label: string; count: number; percentage: number };
type AnalyticsTopWornRow = { id: string; name: string; categoryLabel: string; wearCount: number; thumbnailUrl: string | null };
type AnalyticsCostRow = { id: string; name: string; dotClass: string; detail: string; formattedSubtotal: string };
type AnalyticsViewState = {
  scope: AnalyticsScope;
  totalCost: string;
  averageCostPerItem: string;
  averageCostPerOutfit: string;
  costRows: AnalyticsCostRow[];
  totalItems: number;
  activeItems: number;
  archivedItems: number;
  totalOutfits: number;
  outfitsWithImages: number;
  totalWearCount: number;
  hasZeroData: boolean;
  categoryList: AnalyticsDistributionRow[];
  colourList: AnalyticsDistributionRow[];
  topWornItems: AnalyticsTopWornRow[];
  telemetry: PlatformTelemetryDto;
  lastRefreshedLabel: string;
};

@Component({
  selector: 'app-analytics',
  standalone: false,
  templateUrl: './analytics.page.html',
  styleUrls: ['./analytics.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyticsPage {
  private readonly api = inject(WardrobeApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);

  scope: AnalyticsScope = 'user';
  analytics: AnalyticsSummaryDto | null = null;
  view: AnalyticsViewState | null = null;
  isLoading = false;
  error = '';
  lastRefreshed: Date | null = null;
  pingLatencyMs: number | null = null;
  private activeLoad: Promise<void> | null = null;
  private categoryLoadId = 0;

  // Category inspection drilldown modal
  selectedCategory: { id: string; label: string; count: number } | null = null;
  categoryItems: WardrobeItemDto[] = [];
  isLoadingCategoryItems = false;
  categoryItemsError = '';

  async ionViewWillEnter(): Promise<void> {
    await this.loadAnalytics();
  }

  async loadAnalytics(event?: any): Promise<void> {
    if (this.activeLoad) {
      try {
        await this.activeLoad;
      } finally {
        event?.target?.complete?.();
      }
      return;
    }

    this.activeLoad = (async () => {
      this.isLoading = true;
      this.error = '';
      const startPing = performance.now();
      try {
        // Ensure the stored session is loaded before firing the request:
        // without this, a first visit can send the call with no token,
        // take a 401, and get bounced to /login instead of seeing feedback.
        await this.auth.restore();
        this.analytics = await this.api.getAnalyticsSummary();
        this.pingLatencyMs = Math.round(performance.now() - startPing);
        this.lastRefreshed = new Date();
        this.refreshDerivedScopeState();
      } catch (err) {
        this.error = readMessage(err, 'Failed to load analytics.');
      } finally {
        this.isLoading = false;
        this.changeDetector.markForCheck();
        event?.target?.complete?.();
      }
    })();

    try {
      await this.activeLoad;
    } finally {
      this.activeLoad = null;
    }
  }

  setScope(scope: AnalyticsScope): void {
    if (this.scope === scope) return;
    this.closeCategoryModal();
    this.scope = scope;
    this.refreshDerivedScopeState();
    this.changeDetector.markForCheck();
  }

  openSettings(): void {
    this.router.navigateByUrl('/tabs/settings');
  }

  async openCategoryItems(category: { id: string; label: string; count: number }): Promise<void> {
    // The item endpoint only returns the signed-in user's wardrobe.
    if (this.scope !== 'user') return;

    const loadId = ++this.categoryLoadId;
    this.selectedCategory = category;
    this.categoryItems = [];
    this.categoryItemsError = '';
    this.isLoadingCategoryItems = true;
    this.changeDetector.markForCheck();
    try {
      // Fetch garments for this category
      const items = await this.api.getItems({ categoryId: category.id, includeArchived: true });
      if (loadId === this.categoryLoadId) this.categoryItems = items;
    } catch (err) {
      if (loadId === this.categoryLoadId) this.categoryItemsError = readMessage(err, 'Failed to load garments for this category.');
    } finally {
      if (loadId === this.categoryLoadId) this.isLoadingCategoryItems = false;
      this.changeDetector.markForCheck();
    }
  }

  closeCategoryModal(): void {
    this.categoryLoadId++;
    this.isLoadingCategoryItems = false;
    this.selectedCategory = null;
    this.categoryItems = [];
    this.categoryItemsError = '';
    this.changeDetector.markForCheck();
  }

  openItemDetail(item: WardrobeItemDto): void {
    this.closeCategoryModal();
    this.router.navigateByUrl(`/tabs/wardrobe/${item.id}`);
  }

  private formatCurrency(value: number, minDecimals = 4, maxDecimals = 4): string {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals
    });
  }

  private formatCategoryLabel(catId: string | null | undefined): string {
    if (!catId) return 'Unknown';
    const clean = catId.toLowerCase().replace(/_/g, ' ');
    const labels: Record<string, string> = {
      tops: 'Tops',
      bottoms: 'Bottoms',
      outerwear: 'Outerwear',
      footwear: 'Footwear',
      knitwear: 'Knitwear',
      dresses: 'Dresses',
      bags: 'Bags',
      accessories: 'Accessories',
      one_pieces: 'One-Pieces',
      'one pieces': 'One-Pieces',
      other: 'Other'
    };
    return labels[catId.toLowerCase()] ?? labels[clean] ?? clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  private formatColourLabel(colourId: string | null | undefined): string {
    if (!colourId) return 'Unknown';
    const clean = colourId.replace(/_/g, ' ');
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  trackById(_: number, value: { id: string }): string {
    return value.id;
  }

  private refreshDerivedScopeState(): void {
    const summary = this.analytics;
    if (!summary) {
      this.view = null;
      return;
    }

    const cost = this.scope === 'user' ? summary.userCost : summary.platformCost;
    const metrics = this.scope === 'user' ? summary.userMetrics : summary.platformMetrics;
    const totalCost = cost.totalCostUsd;
    const topWornItems = this.scope === 'user' ? metrics.topWornItems.slice(0, 12).map(item => ({
      id: item.id,
      name: item.name,
      categoryLabel: this.formatCategoryLabel(item.categoryId),
      wearCount: item.wearCount,
      thumbnailUrl: item.thumbnailUrl
    })) : [];

    this.view = {
      scope: this.scope,
      totalCost: this.formatCurrency(totalCost),
      averageCostPerItem: metrics.totalItems ? this.formatCurrency(totalCost / metrics.totalItems) : '$0.0000',
      averageCostPerOutfit: metrics.totalOutfits ? this.formatCurrency(totalCost / metrics.totalOutfits) : '$0.0000',
      costRows: [
        this.toCostRow('classification', 'Item Classification', 'classification-dot', cost.classifications, 'scans', 'item'),
        this.toCostRow('outfit-search', 'Outfit Search & Styling', 'search-dot', cost.outfitSearches, 'queries', 'query'),
        this.toCostRow('display-image', 'Garment Display / Cutout', 'display-dot', cost.displayImages, 'images', 'img'),
        this.toCostRow('outfit-image', 'Rendered Outfit Looks', 'outfit-img-dot', cost.outfitImages, 'renders', 'render')
      ],
      totalItems: metrics.totalItems,
      activeItems: metrics.activeItems,
      archivedItems: metrics.archivedItems,
      totalOutfits: metrics.totalOutfits,
      outfitsWithImages: metrics.outfitsWithImages,
      totalWearCount: metrics.totalWearCount,
      hasZeroData: metrics.totalItems === 0 && metrics.totalOutfits === 0,
      categoryList: this.toDistributionList(metrics.itemsByCategory, metrics.totalItems, id => this.formatCategoryLabel(id)),
      colourList: this.toDistributionList(metrics.itemsByColour, metrics.totalItems, id => this.formatColourLabel(id)),
      topWornItems,
      telemetry: summary.platformTelemetry,
      lastRefreshedLabel: this.lastRefreshed
        ? this.lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : ''
    };
  }

  private toCostRow(id: string, name: string, dotClass: string, cost: AiCostBreakdownItemDto, countLabel: string, unitLabel: string): AnalyticsCostRow {
    return {
      id,
      name,
      dotClass,
      detail: `${cost.count} ${countLabel} × ${this.formatCurrency(cost.unitCostUsd, 3, 3)}/${unitLabel}`,
      formattedSubtotal: this.formatCurrency(cost.subtotalCostUsd)
    };
  }

  private toDistributionList(
    values: Record<string, number> | null | undefined,
    totalItems: number | null | undefined,
    formatLabel: (id: string) => string
  ): AnalyticsDistributionRow[] {
    const total = totalItems ?? 0;
    if (!values || !Number.isFinite(total) || total <= 0) return [];
    return Object.entries(values)
      .filter(([id, count]) => id.length > 0 && Number.isFinite(count) && count >= 0)
      .map(([id, count]) => ({
        id,
        label: formatLabel(id),
        count,
        percentage: Math.min(100, Math.round((count / total) * 100))
      }))
      .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
      .slice(0, 24);
  }

}
