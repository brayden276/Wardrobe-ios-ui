import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AnalyticsSummaryDto, AiCostDetailDto, WardrobeAnalyticsMetricsDto, WardrobeItemDto } from '../../models';
import { AuthService } from '../../auth.service';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { readMessage } from '../page-helpers';

export type AnalyticsScope = 'user' | 'platform';

type AnalyticsDistributionRow = { id: string; label: string; count: number; percentage: number };

@Component({
  selector: 'app-analytics',
  standalone: false,
  templateUrl: './analytics.page.html',
  styleUrls: ['./analytics.page.scss']
})
export class AnalyticsPage {
  private readonly api = inject(WardrobeApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  scope: AnalyticsScope = 'user';
  analytics: AnalyticsSummaryDto | null = null;
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
  categoryList: AnalyticsDistributionRow[] = [];
  colourList: AnalyticsDistributionRow[] = [];

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
        this.refreshDerivedScopeState();
        this.pingLatencyMs = Math.round(performance.now() - startPing);
        this.lastRefreshed = new Date();
      } catch (err) {
        this.error = readMessage(err, 'Failed to load analytics.');
      } finally {
        this.isLoading = false;
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
    try {
      // Fetch garments for this category
      const items = await this.api.getItems({ categoryId: category.id, includeArchived: true });
      if (loadId === this.categoryLoadId) this.categoryItems = items;
    } catch (err) {
      if (loadId === this.categoryLoadId) this.categoryItemsError = readMessage(err, 'Failed to load garments for this category.');
    } finally {
      if (loadId === this.categoryLoadId) this.isLoadingCategoryItems = false;
    }
  }

  closeCategoryModal(): void {
    this.categoryLoadId++;
    this.isLoadingCategoryItems = false;
    this.selectedCategory = null;
    this.categoryItems = [];
    this.categoryItemsError = '';
  }

  openItemDetail(item: WardrobeItemDto): void {
    this.closeCategoryModal();
    this.router.navigateByUrl(`/tabs/wardrobe/${item.id}`);
  }

  get currentCost(): AiCostDetailDto | null {
    if (!this.analytics) return null;
    return this.scope === 'user' ? this.analytics.userCost : this.analytics.platformCost;
  }

  get currentMetrics(): WardrobeAnalyticsMetricsDto | null {
    if (!this.analytics) return null;
    return this.scope === 'user' ? this.analytics.userMetrics : this.analytics.platformMetrics;
  }

  get hasZeroData(): boolean {
    const metrics = this.currentMetrics;
    return !!metrics && metrics.totalItems === 0 && metrics.totalOutfits === 0;
  }

  get formattedTotalCost(): string {
    const cost = this.currentCost?.totalCostUsd ?? 0;
    return cost.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    });
  }

  formatCurrency(value: number, minDecimals = 4, maxDecimals = 4): string {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals
    });
  }

  formatCategoryLabel(catId: string | null | undefined): string {
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

  formatColourLabel(colourId: string | null | undefined): string {
    if (!colourId) return 'Unknown';
    const clean = colourId.replace(/_/g, ' ');
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  trackById(_: number, value: { id: string }): string {
    return value.id;
  }

  private refreshDerivedScopeState(): void {
    const metrics = this.currentMetrics;
    this.categoryList = this.toDistributionList(metrics?.itemsByCategory, metrics?.totalItems, id => this.formatCategoryLabel(id));
    this.colourList = this.toDistributionList(metrics?.itemsByColour, metrics?.totalItems, id => this.formatColourLabel(id));
  }

  private toDistributionList(
    values: Record<string, number> | null | undefined,
    totalItems: number | null | undefined,
    formatLabel: (id: string) => string
  ): AnalyticsDistributionRow[] {
    if (!values || !totalItems) return [];
    return Object.entries(values)
      .map(([id, count]) => ({
        id,
        label: formatLabel(id),
        count,
        percentage: Math.round((count / totalItems) * 100)
      }))
      .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
  }

  get avgCostPerItem(): string {
    const totalItems = this.currentMetrics?.totalItems ?? 0;
    const totalCost = this.currentCost?.totalCostUsd ?? 0;
    if (totalItems === 0) return '$0.0000';
    return this.formatCurrency(totalCost / totalItems);
  }

  get avgCostPerOutfit(): string {
    const totalOutfits = this.currentMetrics?.totalOutfits ?? 0;
    const totalCost = this.currentCost?.totalCostUsd ?? 0;
    if (totalOutfits === 0) return '$0.0000';
    return this.formatCurrency(totalCost / totalOutfits);
  }

  get lastRefreshedLabel(): string {
    if (!this.lastRefreshed) return '';
    return this.lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
