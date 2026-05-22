import { Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';
import { AuthService } from './auth.service';
import { AiUsageCostSummaryDto, ApiMessage, GeneratedOutfitDto, ImageGenerationStreamUpdate, OutfitDto, UpdateWardrobeItemRequest, WardrobeItemDto, WardrobeLookupsDto } from './models';
import { ImageGenerationStatusStream, WardrobeApiService } from './wardrobe-api.service';

type UploadMode = 'single' | 'batch';
type ItemDetailMode = 'view' | 'edit';
type SettingsMode = 'account' | 'ai' | 'legal' | 'danger';

type PreparedUploadFile = {
  file: File;
  name: string;
  originalBytes: number;
  preparedBytes: number;
};

@Component({
  selector: 'app-login',
  standalone: false,
  template: `
  <ion-content class="app-content">
    <section class="screen login-screen">
        <div>
          <h1 class="plain-title">Wardrobe AI</h1>
          <p class="muted">Your private wardrobe catalogue and outfit builder.</p>
          <p class="muted">{{ authModeHint }}</p>
        </div>
      <div class="intent-switch" role="tablist" aria-label="Authentication intent">
        <button type="button" class="intent-tab" [class.active]="mode === 'login'" (click)="setAuthMode('login')" role="tab">Sign in</button>
        <button type="button" class="intent-tab" [class.active]="mode === 'register'" (click)="setAuthMode('register')" role="tab">Create account</button>
      </div>
      <form class="panel form-stack" (ngSubmit)="submit()">
        <label>
          Email
          <ion-input class="field" type="email" [(ngModel)]="email" name="email"></ion-input>
        </label>
          <p class="muted field-error" *ngIf="emailValidationMessage">{{ emailValidationMessage }}</p>
          <label>
            Password
            <ion-input class="field" type="password" [(ngModel)]="password" name="password"></ion-input>
          </label>
          <p class="muted field-error" *ngIf="passwordValidationMessage">{{ passwordValidationMessage }}</p>
        <label *ngIf="mode === 'register'">
          Name
          <ion-input class="field" [(ngModel)]="displayName" name="displayName"></ion-input>
        </label>
        <p class="muted field-error" *ngIf="mode === 'register' && displayNameValidationMessage">{{ displayNameValidationMessage }}</p>
        <ion-button class="primary-button" expand="block" type="submit" [disabled]="isBusy || !canSubmit">{{ authSubmitLabel }}</ion-button>
        <div class="status-line" *ngIf="isBusy">
          <ion-spinner name="crescent"></ion-spinner>
          <span>{{ authStatusMessage }}</span>
        </div>
        <p class="muted" *ngIf="message">{{ message }}</p>
      </form>
    </section>
  </ion-content>
  `
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  mode: 'login' | 'register' = 'login';
  email = '';
  password = '';
  displayName = '';
  message = '';
  isBusy = false;

  get emailValidationMessage(): string {
    if (!this.email.trim()) {
      return 'Email is required.';
    }

    if (!EMAIL_PATTERN.test(this.email.trim())) {
      return 'Enter a valid email address.';
    }

    return '';
  }

  get passwordValidationMessage(): string {
    if (!this.password) {
      return 'Password is required.';
    }

    return '';
  }

  get displayNameValidationMessage(): string {
    if (this.mode !== 'register') {
      return '';
    }

    if (!this.displayName.trim()) {
      return 'Name is required to create an account.';
    }

    return '';
  }

  get canSubmit(): boolean {
    return (
      !this.isBusy
      && !this.emailValidationMessage
      && !this.passwordValidationMessage
      && !this.displayNameValidationMessage
    );
  }

  setAuthMode(mode: 'login' | 'register'): void {
    if (this.mode === mode) {
      return;
    }

    this.mode = mode;
    this.message = '';
  }

  toggleMode(): void {
    this.setAuthMode(this.mode === 'login' ? 'register' : 'login');
  }

  get authSubmitLabel(): string {
    return this.mode === 'login' ? 'Sign in' : 'Create account';
  }

  get authStatusMessage(): string {
    return this.mode === 'login' ? 'Signing in...' : 'Creating your account...';
  }

  get authModeHint(): string {
    return this.mode === 'login' ? 'Sign in to review your wardrobe.' : 'Create your account to get started.';
  }

  async submit(): Promise<void> {
    if (!this.canSubmit) {
      this.message = this.emailValidationMessage || this.passwordValidationMessage || this.displayNameValidationMessage || 'Please complete all required fields.';
      return;
    }

    const email = this.email.trim();

    this.isBusy = true;
    this.message = '';
    try {
      if (this.mode === 'login') {
        await this.auth.login(email, this.password);
      } else {
        await this.auth.register(email, this.password, this.displayName.trim());
      }
      await this.router.navigateByUrl('/tabs/wardrobe');
    } catch (error) {
      this.message = readMessage(error, 'Could not sign in. Try again.');
    } finally {
      this.isBusy = false;
    }
  }
}

@Component({
  selector: 'app-tabs',
  standalone: false,
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="wardrobe"><ion-icon name="shirt-outline"></ion-icon><ion-label>Wardrobe</ion-label></ion-tab-button>
        <ion-tab-button tab="add"><ion-icon name="add-circle-outline"></ion-icon><ion-label>Add</ion-label></ion-tab-button>
        <ion-tab-button tab="outfits"><ion-icon name="albums-outline"></ion-icon><ion-label>Outfits</ion-label></ion-tab-button>
        <ion-tab-button tab="builder"><ion-icon name="sparkles-outline"></ion-icon><ion-label>Builder</ion-label></ion-tab-button>
        <ion-tab-button tab="settings"><ion-icon name="settings-outline"></ion-icon><ion-label>Settings</ion-label></ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `
})
export class TabsPage {}

@Component({
  selector: 'app-wardrobe',
  standalone: false,
  template: `
    <ion-content class="app-content">
      <section class="screen">
        <header class="page-header">
          <h1>Wardrobe</h1>
          <button type="button" class="icon-button" aria-label="Refresh wardrobe" (click)="load()">
            <ion-icon name="refresh-outline"></ion-icon>
          </button>
        </header>
        <div class="search-row">
          <ion-searchbar class="wardrobe-search" [(ngModel)]="search" placeholder="Search black jeans, blazers..." (ionInput)="scheduleLoad()"></ion-searchbar>
          <button type="button" class="filter-button" [class.active]="filtersExpanded || hasFilters" [attr.aria-label]="filtersExpanded ? 'Hide wardrobe filters' : 'Show wardrobe filters'" (click)="toggleFilters()">
            <ion-icon [name]="filtersExpanded ? 'close-outline' : 'options-outline'"></ion-icon>
          </button>
        </div>
        <article class="panel filter-summary" *ngIf="!filtersExpanded && hasFilters">
          <div class="filter-group">
            <span class="filter-label">Active filters</span>
            <p class="muted">{{ activeFilterSummary }}</p>
            <ion-button class="quiet-button compact-button" fill="clear" size="small" (click)="toggleFilters()">Edit filters</ion-button>
          </div>
        </article>
        <article class="panel filter-panel" *ngIf="filtersExpanded">
          <div class="panel-heading">
            <h2 class="section-title">Filters</h2>
            <button type="button" class="icon-button" aria-label="Close filters" (click)="toggleFilters()">
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </div>
          <div class="filter-group">
            <span class="filter-label">Category</span>
            <div class="chip-row">
              <button type="button" class="chip" [class.active]="!categoryId" (click)="setCategory(null)">All</button>
              <button type="button" class="chip" *ngFor="let category of lookups?.categories || []" [class.active]="categoryId === category.id" (click)="setCategory(category.id)">{{ category.label }}</button>
            </div>
          </div>
          <details class="advanced-filter">
            <summary>
              <span>Advanced filters</span>
              <ion-icon name="chevron-down-outline"></ion-icon>
            </summary>
            <div class="filter-group">
              <span class="filter-label">Subcategory</span>
              <div class="chip-row">
                <button type="button" class="chip" [class.active]="!subcategoryId" (click)="setSubcategory(null)">Any</button>
                <button type="button" class="chip" *ngFor="let option of subcategoryOptions" [class.active]="subcategoryId === option.id" (click)="setSubcategory(option.id)">{{ option.label }}</button>
              </div>
            </div>
            <div class="filter-group">
              <span class="filter-label">Colour</span>
              <div class="chip-row">
                <button type="button" class="chip" [class.active]="!colourId" (click)="setColour(null)">Any</button>
                <button type="button" class="chip" *ngFor="let option of lookups?.colours || []" [class.active]="colourId === option.id" (click)="setColour(option.id)">{{ option.label }}</button>
              </div>
            </div>
            <div class="filter-group">
              <span class="filter-label">Pattern</span>
              <div class="chip-row">
                <button type="button" class="chip" [class.active]="!patternId" (click)="setPattern(null)">Any</button>
                <button type="button" class="chip" *ngFor="let option of lookups?.patterns || []" [class.active]="patternId === option.id" (click)="setPattern(option.id)">{{ option.label }}</button>
              </div>
            </div>
            <div class="filter-select-grid">
              <label>
                Material
                <ion-select class="field" [(ngModel)]="visibleMaterialId" name="visibleMaterialId" (ionChange)="scheduleLoad()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.visibleMaterials || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Neckline
                <ion-select class="field" [(ngModel)]="necklineId" name="necklineId" (ionChange)="scheduleLoad()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.necklines || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Sleeve
                <ion-select class="field" [(ngModel)]="sleeveLengthId" name="sleeveLengthId" (ionChange)="scheduleLoad()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.sleeveLengths || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Fit
                <ion-select class="field" [(ngModel)]="fitId" name="fitId" (ionChange)="scheduleLoad()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.fits || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Length
                <ion-select class="field" [(ngModel)]="lengthId" name="lengthId" (ionChange)="scheduleLoad()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.garmentLengths || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Shape
                <ion-select class="field" [(ngModel)]="bottomShapeId" name="bottomShapeId" (ionChange)="scheduleLoad()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.bottomShapes || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Rise
                <ion-select class="field" [(ngModel)]="riseId" name="riseId" (ionChange)="scheduleLoad()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.rises || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
            </div>
            <div class="toggle-row">
              <span>Include archived</span>
              <ion-toggle [checked]="includeArchived" (ionChange)="setIncludeArchived($event.detail.checked)"></ion-toggle>
            </div>
          </details>
          <ion-button class="secondary-button" fill="outline" expand="block" (click)="clearFilters()" [disabled]="!hasFilters">Clear filters</ion-button>
        </article>
        <article class="panel state-panel" *ngIf="isLoading">
          <ion-spinner name="crescent"></ion-spinner>
          <p class="muted">Loading wardrobe...</p>
        </article>
        <article class="panel state-panel" *ngIf="!isLoading && message">
          <p class="muted">{{ message }}</p>
          <ion-button class="secondary-button" fill="outline" size="small" (click)="load()">Try again</ion-button>
        </article>
        <div class="wardrobe-grid" *ngIf="!isLoading && !message && items.length; else emptyWardrobe">
          <a class="item-card" *ngFor="let item of items; trackBy: trackById" [routerLink]="['/tabs/wardrobe', item.id]">
            <div class="item-card__image-wrap">
              <img [src]="item.image.displayUrl" [alt]="item.name">
            </div>
            <div class="item-card__body">
              <h3>{{ item.name }}</h3>
              <div class="meta-line"><span>{{ label(item.subcategoryId) }}</span></div>
              <div class="colour-dots" aria-label="Item colours">
                <span class="colour-dot" *ngFor="let colour of coloursFor(item)" [style.background]="colourSwatch(colour)"></span>
              </div>
              <div class="item-generation-state" *ngIf="imageGenerationMessage(item) as status">
                <ion-spinner *ngIf="isImageGenerationInProgress(item.imageGenerationStatus)" name="crescent"></ion-spinner>
                <span>{{ status }}</span>
              </div>
            </div>
          </a>
        </div>
        <ng-template #emptyWardrobe>
          <article class="panel" *ngIf="!isLoading && !message">
            <h2 class="plain-title">{{ hasFilters ? 'No matching items found.' : 'Your wardrobe is empty.' }}</h2>
            <p class="muted">{{ hasFilters ? 'Clear filters to see more wardrobe items.' : 'Add your first item.' }}</p>
            <ion-button *ngIf="hasFilters" class="secondary-button" fill="outline" size="small" (click)="clearFilters()">Clear filters</ion-button>
            <ion-button *ngIf="!hasFilters" class="primary-button" size="small" routerLink="/tabs/add">Add Item</ion-button>
          </article>
        </ng-template>
      </section>
        <ion-fab vertical="bottom" horizontal="end" slot="fixed">
          <ion-fab-button class="fab-camera" routerLink="/tabs/add" aria-label="Add item"><ion-icon name="camera-outline"></ion-icon></ion-fab-button>
        </ion-fab>
      </ion-content>
  `
})
export class WardrobePage implements OnDestroy {
  private readonly api = inject(WardrobeApiService);
  items: WardrobeItemDto[] = [];
  lookups: WardrobeLookupsDto | null = null;
  categoryId: string | null = null;
  subcategoryId: string | null = null;
  colourId: string | null = null;
  patternId: string | null = null;
  visibleMaterialId: string | null = null;
  necklineId: string | null = null;
  sleeveLengthId: string | null = null;
  fitId: string | null = null;
  lengthId: string | null = null;
  bottomShapeId: string | null = null;
  riseId: string | null = null;
  includeArchived = false;
  filtersExpanded = false;
  search = '';
  isLoading = true;
  message = '';
  private loadDebounceHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly loadDebounceMs = 250;
  private imageGenerationStatusStream: ImageGenerationStatusStream | null = null;
  private readonly itemImageGenerationPollingIntervalMs = 1800;
  private itemImageGenerationPollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingImageGeneration = false;

  get activeFilterSummary(): string {
    const filters: string[] = [];

    if (this.categoryId) {
      const category = this.lookups?.categories.find((option) => option.id === this.categoryId)?.label ?? this.categoryId;
      filters.push(`Category: ${category}`);
    }

    if (this.subcategoryId) {
      const current = this.subcategoryOptions.find((option) => option.id === this.subcategoryId);
      filters.push(`Subcategory: ${current?.label ?? this.subcategoryId}`);
    }

    if (this.colourId) {
      const colour = this.lookups?.colours.find((option) => option.id === this.colourId)?.label ?? this.colourId;
      filters.push(`Colour: ${colour}`);
    }

    if (this.patternId) {
      const pattern = this.lookups?.patterns.find((option) => option.id === this.patternId)?.label ?? this.patternId;
      filters.push(`Pattern: ${pattern}`);
    }

    if (this.includeArchived) {
      filters.push('Include archived');
    }

    const search = this.search.trim();
    if (search) {
      filters.push(`Search: ${search}`);
    }

    if (!filters.length) {
      return 'No filters selected.';
    }

    return filters.join(' · ');
  }

  toggleFilters(): void {
    this.filtersExpanded = !this.filtersExpanded;
  }

  get hasFilters(): boolean {
    return !!(
      this.categoryId
      || this.subcategoryId
      || this.colourId
      || this.patternId
      || this.visibleMaterialId
      || this.necklineId
      || this.sleeveLengthId
      || this.fitId
      || this.lengthId
      || this.bottomShapeId
      || this.riseId
      || this.search.trim()
      || this.includeArchived
    );
  }

  get subcategoryOptions(): { id: string; label: string }[] {
    if (!this.lookups) {
      return [];
    }

    if (!this.categoryId) {
      return this.lookups.categories.reduce<{ id: string; label: string }[]>(
        (options, category) => options.concat(category.subcategories),
        []);
    }

    return this.lookups.categories.find((category) => category.id === this.categoryId)?.subcategories ?? [];
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  ngOnDestroy(): void {
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();
  }

  async load(): Promise<void> {
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();
    this.isLoading = true;
    this.message = '';
    try {
      this.lookups ??= await this.api.getLookups();
      this.items = await this.api.getItems(this.buildItemFilterParams());
      this.startImageGenerationStreaming();
    } catch (error) {
      this.message = readMessage(error, 'Could not load wardrobe. Please try again.');
      this.items = [];
    } finally {
      this.isLoading = false;
    }
  }

  private buildItemFilterParams(): Record<string, string | boolean> {
    return {
        categoryId: this.categoryId ?? '',
        subcategoryId: this.subcategoryId ?? '',
        colourId: this.colourId ?? '',
        patternId: this.patternId ?? '',
        visibleMaterialId: this.visibleMaterialId ?? '',
        necklineId: this.necklineId ?? '',
        sleeveLengthId: this.sleeveLengthId ?? '',
        fitId: this.fitId ?? '',
        lengthId: this.lengthId ?? '',
        bottomShapeId: this.bottomShapeId ?? '',
        riseId: this.riseId ?? '',
        search: this.search.trim(),
        includeArchived: this.includeArchived
      };
  }

  private startImageGenerationStreaming(): void {
    this.stopItemImageGenerationStreaming();
    this.stopItemImageGenerationPolling();

    if (!this.hasItemImageGenerationInProgress()) {
      return;
    }

    const trackingItemIds = this.items
      .filter((item) => this.isImageGenerationInProgress(item.imageGenerationStatus))
      .map((item) => item.id);

    const stream = this.api.streamImageGenerationStatuses(
      trackingItemIds,
      [],
      (updates) => this.applyImageGenerationStreamUpdates(updates),
      () => {
        this.imageGenerationStatusStream = null;
        this.startItemImageGenerationPolling();
      });

    if (stream === null) {
      this.startItemImageGenerationPolling();
      return;
    }

    this.imageGenerationStatusStream = stream;
  }

  private applyImageGenerationStreamUpdates(updates: ImageGenerationStreamUpdate[]): void {
    if (!updates.length || this.items.length === 0) {
      return;
    }

    const updateById = new Map<string, ImageGenerationStreamUpdate>(updates.filter((update) => update.kind === 'item').map((update) => [update.id, update]));
    this.items = this.items.map((item) => {
      const update = updateById.get(item.id);
      if (!update || update.status === item.imageGenerationStatus) {
        return item;
      }

      return { ...item, imageGenerationStatus: update.status };
    });

    if (!this.hasItemImageGenerationInProgress()) {
      this.stopItemImageGenerationStreaming();
      void this.refreshWardrobeItemsAfterImageGeneration();
    }
  }

  private async refreshWardrobeItemsAfterImageGeneration(): Promise<void> {
    try {
      this.items = await this.api.getItems(this.buildItemFilterParams());
    } catch {
      // Ignore temporary network issues after image generation completes.
    }
  }

  private stopItemImageGenerationStreaming(): void {
    if (this.imageGenerationStatusStream) {
      this.imageGenerationStatusStream.close();
    }
    this.imageGenerationStatusStream = null;
  }

  private startItemImageGenerationPolling(): void {
    if (!this.hasItemImageGenerationInProgress()) {
      return;
    }

    this.itemImageGenerationPollTimeout = setTimeout(() => {
      void this.refreshItemImageGenerationStatuses();
    }, this.itemImageGenerationPollingIntervalMs);
  }

  private async refreshItemImageGenerationStatuses(): Promise<void> {
    if (this.isRefreshingImageGeneration) {
      this.startItemImageGenerationPolling();
      return;
    }

    if (!this.hasItemImageGenerationInProgress()) {
      return;
    }

    this.isRefreshingImageGeneration = true;
    try {
      this.items = await this.api.getItems(this.buildItemFilterParams());
    } catch {
      // Ignore temporary network issues while polling for image-generation states.
    } finally {
      this.isRefreshingImageGeneration = false;
      this.startItemImageGenerationPolling();
    }
  }

  private stopItemImageGenerationPolling(): void {
    if (this.itemImageGenerationPollTimeout) {
      clearTimeout(this.itemImageGenerationPollTimeout);
    }
    this.itemImageGenerationPollTimeout = null;
    this.isRefreshingImageGeneration = false;
  }

  private hasItemImageGenerationInProgress(): boolean {
    return this.items.some((item) => this.isImageGenerationInProgress(item.imageGenerationStatus));
  }

  setCategory(categoryId: string | null): void {
    this.categoryId = categoryId;
    this.subcategoryId = null;
    this.scheduleLoad();
  }

  setSubcategory(subcategoryId: string | null): void {
    this.subcategoryId = subcategoryId;
    this.scheduleLoad();
  }

  setColour(colourId: string | null): void {
    this.colourId = colourId;
    this.scheduleLoad();
  }

  setPattern(patternId: string | null): void {
    this.patternId = patternId;
    this.scheduleLoad();
  }

  setIncludeArchived(includeArchived: boolean): void {
    this.includeArchived = includeArchived;
    this.scheduleLoad();
  }

  clearFilters(): void {
    this.categoryId = null;
    this.subcategoryId = null;
    this.colourId = null;
    this.patternId = null;
    this.visibleMaterialId = null;
    this.necklineId = null;
    this.sleeveLengthId = null;
    this.fitId = null;
    this.lengthId = null;
    this.bottomShapeId = null;
    this.riseId = null;
    this.includeArchived = false;
    this.search = '';
    this.filtersExpanded = false;
    this.scheduleLoad();
  }

  label(id: string | null): string {
    if (!id || !this.lookups) return '';
    return lookupLabel(this.lookups, id);
  }

  coloursFor(item: WardrobeItemDto): string[] {
    return [item.primaryColourId, ...item.secondaryColourIds].filter(Boolean).slice(0, 4);
  }

  colourSwatch(id: string): string {
    return colourSwatch(id);
  }

  trackById(_: number, item: WardrobeItemDto): string {
    return item.id;
  }

  imageGenerationMessage(item: WardrobeItemDto): string | null {
    switch (item.imageGenerationStatus) {
      case 'queued':
        return 'Image generation queued...';
      case 'generating':
        return 'Generating polished image...';
      case 'failed':
        return 'Image generation failed.';
      default:
        return null;
    }
  }

  isImageGenerationInProgress(status: string | null): boolean {
    return status === 'queued' || status === 'generating';
  }

  scheduleLoad(): void {
    if (this.loadDebounceHandle) {
      clearTimeout(this.loadDebounceHandle);
    }

    this.loadDebounceHandle = setTimeout(() => {
      this.loadDebounceHandle = null;
      void this.load();
    }, this.loadDebounceMs);
  }
}

@Component({
  selector: 'app-add-item',
  standalone: false,
  template: `
    <ion-content class="app-content capture-content">
      <section class="screen capture-screen">
        <header class="nav-header">
          <button type="button" class="nav-button" routerLink="/tabs/wardrobe" aria-label="Back to wardrobe">
            <ion-icon name="chevron-back-outline"></ion-icon>
          </button>
          <h1>Add item</h1>
          <span></span>
        </header>
        <input #cameraInput class="file-input" type="file" accept="image/*" capture="environment" (change)="handleFileSelection($event)">
        <input #libraryInput class="file-input" type="file" accept="image/*" (change)="handleFileSelection($event)">
        <input #batchInput class="file-input" type="file" accept="image/*" multiple (change)="handleBatchSelection($event)">
        <ng-container *ngIf="uploadMode === 'single'">
          <div class="capture-stage">
            <img *ngIf="previewUrl" [src]="previewUrl" alt="Selected wardrobe item">
            <div class="capture-placeholder" *ngIf="!previewUrl">
              <ion-icon name="scan-outline"></ion-icon>
              <p>Place one item flat on a plain surface.</p>
            </div>
          </div>
          <article class="capture-dock">
            <div class="camera-control-row">
              <button type="button" class="round-control" (click)="capture(CameraSource.Photos)" [disabled]="isSaving || isPreparing" aria-label="Choose from library">
                <ion-icon name="images-outline"></ion-icon>
              </button>
              <button type="button" class="shutter-button" (click)="capture(CameraSource.Camera)" [disabled]="isSaving || isPreparing" aria-label="Take photo"></button>
              <button type="button" class="round-control" (click)="clearSelection()" [disabled]="isSaving || isPreparing || !previewUrl" aria-label="Clear selected photo">
                <ion-icon name="close-outline"></ion-icon>
              </button>
            </div>
            <ion-button class="primary-button olive-button" expand="block" (click)="imageBlob ? upload() : capture(CameraSource.Camera)" [disabled]="isSaving || isPreparing">{{ isSaving ? 'Uploading item...' : imageBlob ? 'Submit photo' : 'Take photo' }}</ion-button>
            <ion-button class="light-button" expand="block" (click)="capture(CameraSource.Photos)" [disabled]="isSaving || isPreparing">{{ imageBlob ? 'Choose different photo' : 'Choose from library' }}</ion-button>
            <ion-button class="light-button" expand="block" (click)="openBatchPicker()" [disabled]="isSaving || isBatchSaving || isPreparing">{{ batchFiles.length ? 'Add photos to batch' : 'Upload multiple photos' }}</ion-button>
            <ion-button class="secondary-button retry-button" fill="outline" expand="block" *ngIf="imageBlob && uploadError && !isSaving && !isPreparing" (click)="upload()">Try again</ion-button>
            <div class="processing-line" *ngIf="isPreparing || isSaving">
              <ion-spinner name="crescent"></ion-spinner>
              <span>{{ isPreparing ? 'Preparing image...' : 'Uploading and categorising item...' }}</span>
            </div>
            <p>{{ imageBlob ? singleReadyLabel : 'Upload one item here, or tap Upload multiple photos for a batch.' }}</p>
            <p class="muted consent-note">Wardrobe AI sends uploaded wardrobe photos to OpenAI to classify items and generate cleaned display images.</p>
            <p class="muted consent-note">Only upload clothing photos you are comfortable sharing with that provider.</p>
            <p class="muted" *ngIf="statusMessage">{{ statusMessage }}</p>
            <p class="muted" *ngIf="message">{{ message }}</p>
          </article>
        </ng-container>
        <ng-container *ngIf="uploadMode === 'batch'">
          <article class="panel form-stack batch-panel">
            <div class="panel-heading">
              <h2 class="section-title">Batch upload</h2>
              <button type="button" class="icon-button" aria-label="Choose batch photos" (click)="openBatchPicker()" [disabled]="isBatchSaving || isPreparing">
                <ion-icon name="images-outline"></ion-icon>
              </button>
            </div>
            <div class="batch-summary" *ngIf="batchFiles.length">
              <span>{{ batchSummary }}</span>
              <ion-button class="quiet-button compact-button" fill="clear" size="small" (click)="clearBatchSelection()" [disabled]="isBatchSaving || isPreparing">Clear</ion-button>
            </div>
            <div class="batch-grid" *ngIf="batchFiles.length">
              <div class="batch-item" *ngFor="let file of batchFiles; let index = index">
                <button type="button" class="icon-button batch-item__remove" aria-label="Remove batch photo" (click)="removeBatchFile(index)" [disabled]="isBatchSaving || isPreparing">
                  <ion-icon name="close-outline"></ion-icon>
                </button>
                <img [src]="batchPreviewUrls[index]" [alt]="file.name">
                <span>{{ file.name }}</span>
              </div>
            </div>
            <p class="muted" *ngIf="!batchFiles.length">Select up to {{ maxBatchUploadCount }} photos and upload them together.</p>
            <p class="muted consent-note">Batch uploads use the same OpenAI-powered classification flow as single-item uploads.</p>
            <div class="processing-line" *ngIf="isBatchSaving">
              <ion-spinner name="crescent"></ion-spinner>
              <span>Uploading batch...</span>
            </div>
            <p class="muted" *ngIf="statusMessage && !isBatchSaving">{{ statusMessage }}</p>
            <p class="muted" *ngIf="message">{{ message }}</p>
            <ion-button class="primary-button" expand="block" (click)="uploadBatch()" [disabled]="isBatchSaving || !batchFiles.length || isPreparing">{{ isBatchSaving ? 'Uploading batch...' : 'Upload batch' }}</ion-button>
          </article>
        </ng-container>
      </section>
    </ion-content>
  `
})
export class AddItemPage {
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  @ViewChild('cameraInput') private readonly cameraInput?: ElementRef<HTMLInputElement>;
  @ViewChild('libraryInput') private readonly libraryInput?: ElementRef<HTMLInputElement>;
  @ViewChild('batchInput') private readonly batchInput?: ElementRef<HTMLInputElement>;
  readonly CameraSource = CameraSource;
  uploadMode: UploadMode = 'single';
  previewUrl: string | null = null;
  imageBlob: File | null = null;
  imageFileName = 'wardrobe-item.jpg';
  readonly maxBatchUploadCount = MAX_BATCH_UPLOAD_COUNT;
  private selectedImageOriginalBytes = 0;
  private selectedImagePreparedBytes = 0;
  message = '';
  statusMessage = '';
  isSaving = false;
  isPreparing = false;
  uploadError = false;
  batchFiles: PreparedUploadFile[] = [];
  batchPreviewUrls: string[] = [];
  isBatchSaving = false;

  get singleReadyLabel(): string {
    if (!this.imageBlob) {
      return '';
    }

    if (this.selectedImageOriginalBytes === this.selectedImagePreparedBytes) {
      return `Ready to submit (${this.formatBytes(this.selectedImagePreparedBytes)}).`;
    }

    return `Ready to submit (${this.formatBytes(this.selectedImagePreparedBytes)}, reduced from ${this.formatBytes(this.selectedImageOriginalBytes)}).`;
  }

  get batchSummary(): string {
    if (!this.batchFiles.length) {
      return '';
    }

    const originalBytes = this.batchFiles.reduce((sum, file) => sum + file.originalBytes, 0);
    const preparedBytes = this.batchFiles.reduce((sum, file) => sum + file.preparedBytes, 0);

    if (originalBytes === preparedBytes) {
      return `${this.batchFiles.length} photo${this.batchFiles.length === 1 ? '' : 's'} (${this.formatBytes(preparedBytes)} total).`;
    }

    return `${this.batchFiles.length} photo${this.batchFiles.length === 1 ? '' : 's'} (${this.formatBytes(preparedBytes)} total, reduced from ${this.formatBytes(originalBytes)}).`;
  }

  setUploadMode(uploadMode: UploadMode): void {
    if (this.uploadMode === uploadMode) {
      return;
    }

    this.uploadMode = uploadMode;
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
  }

  async capture(source: CameraSource.Camera | CameraSource.Photos): Promise<void> {
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
    if (!Capacitor.isNativePlatform()) {
      this.openBrowserFilePicker(source);
      return;
    }

    try {
      const photo = await Camera.getPhoto({ source, resultType: CameraResultType.DataUrl, quality: 90 });
      if (!photo.dataUrl) {
        return;
      }

      const sourceBlob = this.dataUrlToBlob(photo.dataUrl);
      const fileName = `wardrobe-item.${photo.format || 'jpg'}`;
      const sourceImage = new File([sourceBlob], fileName, { type: sourceBlob.type || 'image/jpeg' });
      await this.applySingleSelection(sourceImage);
    } catch {
      this.message = source === CameraSource.Camera ? 'Camera was not available.' : 'Could not open photo library.';
      this.uploadError = true;
    }
  }

  async handleFileSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    await this.applySingleSelection(file);
  }

  clearSelection(): void {
    this.setPreviewUrl(null);
    this.imageBlob = null;
    this.imageFileName = 'wardrobe-item.jpg';
    this.selectedImageOriginalBytes = 0;
    this.selectedImagePreparedBytes = 0;
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
  }

  async handleBatchSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) {
      return;
    }

    if (files.length === 1) {
      this.setUploadMode('single');
      this.clearBatchSelection();
      await this.applySingleSelection(files[0]);
      return;
    }

    this.setUploadMode('batch');
    this.clearBatchSelection();
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
    this.isPreparing = true;

    try {
      if (files.length > this.maxBatchUploadCount) {
        this.message = `You selected ${files.length} photos. Only the first ${this.maxBatchUploadCount} were kept.`;
      }

      const preparedFiles = await this.prepareBatchImages(files.slice(0, this.maxBatchUploadCount));
      if (!preparedFiles.length) {
        if (!this.message) {
          this.message = 'No valid images in selection.';
        }
        this.uploadError = true;
        return;
      }

      this.batchFiles = preparedFiles;
      this.batchPreviewUrls = preparedFiles.map((entry) => URL.createObjectURL(entry.file));
      if (this.batchFiles.length !== files.length) {
        this.statusMessage = 'Some selected files were skipped during validation.';
      } else {
        this.statusMessage = 'All selected photos are ready for upload.';
      }
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Could not prepare batch images. Try again.';
      this.uploadError = true;
      this.batchFiles = [];
      this.batchPreviewUrls = [];
    } finally {
      this.isPreparing = false;
    }
  }

  async upload(fileName = this.imageFileName): Promise<void> {
    if (!this.imageBlob) return;

    if (!await ensureAiConsent(
      'Wardrobe AI uses OpenAI to classify wardrobe photos and generate cleaned display images. Do you want to continue with AI processing for this device?'))
    {
      this.message = 'OpenAI consent is required before you can upload wardrobe photos.';
      this.uploadError = true;
      return;
    }

    this.isSaving = true;
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
    try {
      await this.api.createItem(this.imageBlob, fileName);
      await this.router.navigateByUrl('/tabs/wardrobe');
    } catch (error) {
      this.message = readMessage(error, 'Could not upload item. Try again.');
      this.uploadError = true;
    } finally {
      this.isSaving = false;
      this.statusMessage = '';
    }
  }

  async uploadBatch(): Promise<void> {
    if (!this.batchFiles.length) {
      return;
    }

    if (!await ensureAiConsent(
      'Wardrobe AI uses OpenAI to classify wardrobe photos and generate cleaned display images. Do you want to continue with AI processing for this device?'))
    {
      this.message = 'OpenAI consent is required before you can upload wardrobe photos.';
      this.uploadError = true;
      return;
    }

    this.isBatchSaving = true;
    this.message = '';
    this.statusMessage = `Uploading ${this.batchFiles.length} photo${this.batchFiles.length === 1 ? '' : 's'}...`;
    this.uploadError = false;
    try {
      const result = await this.api.createItems(this.batchFiles.map((entry) => entry.file));
      const failures = result.results.filter((entry) => !entry.success);
      this.clearBatchSelection();
      if (!failures.length) {
        await this.router.navigateByUrl('/tabs/wardrobe');
        return;
      }

      const failureSummary = failures
        .slice(0, 3)
        .map((entry) => `${entry.fileName}: ${entry.error || 'Could not upload item. Try again.'}`)
        .join(' ');
      this.message = result.succeededCount > 0
        ? `${result.succeededCount} item${result.succeededCount === 1 ? '' : 's'} added. ${result.failedCount} could not be uploaded. ${failureSummary}`
        : failureSummary || 'Could not upload batch. Try again.';
    } catch (error) {
      this.message = readMessage(error, 'Could not upload batch. Try again.');
      this.uploadError = true;
    } finally {
      this.isBatchSaving = false;
      this.statusMessage = '';
    }
  }

  removeBatchFile(index: number): void {
    if (this.isBatchSaving || this.isPreparing) {
      return;
    }

    const previewUrl = this.batchPreviewUrls[index];
    if (previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }

    this.batchFiles = this.batchFiles.filter((_, currentIndex) => currentIndex !== index);
    this.batchPreviewUrls = this.batchPreviewUrls.filter((_, currentIndex) => currentIndex !== index);
  }

  openBatchPicker(): void {
    if (this.isBatchSaving || this.isPreparing) {
      return;
    }

    this.batchInput?.nativeElement.click();
  }

  clearBatchSelection(): void {
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
    for (const previewUrl of this.batchPreviewUrls) {
      if (previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    }

    this.batchFiles = [];
    this.batchPreviewUrls = [];

    if (this.batchInput) {
      this.batchInput.nativeElement.value = '';
    }
  }

  private openBrowserFilePicker(source: CameraSource.Camera | CameraSource.Photos): void {
    const input = source === CameraSource.Camera ? this.cameraInput : this.libraryInput;
    if (!input) {
      this.message = source === CameraSource.Camera ? 'Camera was not available.' : 'Could not open photo library.';
      return;
    }

    input.nativeElement.click();
  }

  private async applySingleSelection(file: File): Promise<void> {
    this.isPreparing = true;
    this.statusMessage = 'Preparing image...';
    this.uploadError = false;
    this.message = '';

    try {
      const prepared = await this.prepareImageForUpload(file);
      this.setPreviewUrl(URL.createObjectURL(prepared.file));
      this.imageBlob = prepared.file;
      this.imageFileName = prepared.name;
      this.selectedImageOriginalBytes = prepared.originalBytes;
      this.selectedImagePreparedBytes = prepared.preparedBytes;
      this.statusMessage = prepared.originalBytes === prepared.preparedBytes
        ? 'No compression was needed.'
        : `Compressed from ${this.formatBytes(prepared.originalBytes)} to ${this.formatBytes(prepared.preparedBytes)}.`;
    } catch (error) {
      this.clearSelection();
      this.message = error instanceof Error ? error.message : 'Could not prepare image. Try again.';
      this.uploadError = true;
    } finally {
      this.isPreparing = false;
    }
  }

  private async prepareBatchImages(files: File[]): Promise<PreparedUploadFile[]> {
    const prepared: PreparedUploadFile[] = [];
    const skippedMessages: string[] = [];

    for (const file of files) {
      const validationMessage = this.validateImageFile(file);
      if (validationMessage) {
        skippedMessages.push(`${file.name}: ${validationMessage}`);
        continue;
      }

      try {
        const entry = await this.prepareImageForUpload(file);
        prepared.push(entry);
      } catch (error) {
        skippedMessages.push(`${file.name}: ${error instanceof Error ? error.message : 'Could not prepare image.'}`);
      }
    }

    if (skippedMessages.length) {
      this.message = skippedMessages.join('\n');
      this.uploadError = true;
    } else {
      this.uploadError = false;
    }

    return prepared;
  }

  private setPreviewUrl(url: string | null): void {
    if (this.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(this.previewUrl);
    }

    this.previewUrl = url;
  }

  private dataUrlToBlob(dataUrl: string): Blob {
    const [header, data] = dataUrl.split(',', 2);
    const mimeType = /^data:(.*);base64$/.exec(header)?.[1] ?? 'image/jpeg';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
  }

  private validateImageFile(file: File): string | null {
    if (!file.type.startsWith('image/')) {
      return 'Please upload an image file.';
    }

    if (!file.size) {
      return 'The selected file is empty.';
    }

    return null;
  }

  private async prepareImageForUpload(file: File): Promise<PreparedUploadFile> {
    const validation = this.validateImageFile(file);
    if (validation) {
      throw new Error(validation);
    }

    const originalBytes = file.size;
    const fileName = file.name || 'wardrobe-item.jpg';
    if (originalBytes <= IMAGE_COMPRESSION_TRIGGER_BYTES) {
      return {
        file,
        name: fileName,
        originalBytes,
        preparedBytes: originalBytes
      };
    }

    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = await this.decodeImage(sourceUrl);
      if (image.naturalWidth < IMAGE_MIN_SIDE || image.naturalHeight < IMAGE_MIN_SIDE) {
        throw new Error('Images must be at least 600x600 for reliable classification.');
      }

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Could not prepare image canvas.');
      }

      let smallestBlob: Blob | null = null;
      for (const maxSide of IMAGE_COMPRESSION_MAX_SIDES) {
        const sourceMaxSide = Math.max(image.naturalWidth, image.naturalHeight);
        const scale = Math.min(1, maxSide / sourceMaxSide);
        const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
        const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        context.drawImage(image, 0, 0, targetWidth, targetHeight);

        for (const quality of IMAGE_COMPRESSION_QUALITIES) {
          const compressedBlob = await this.toBlob(canvas, `image/${MIME_IMAGE_OUTPUT_EXTENSION}`, quality);
          if (compressedBlob.size && (!smallestBlob || compressedBlob.size < smallestBlob.size)) {
            smallestBlob = compressedBlob;
          }

          if (compressedBlob.size && compressedBlob.size <= MAX_UPLOAD_FILE_BYTES && compressedBlob.size < originalBytes) {
            const preparedName = this.normaliseUploadFileName(fileName, MIME_IMAGE_OUTPUT_EXTENSION);
            const preparedFile = new File([compressedBlob], preparedName, { type: `image/${MIME_IMAGE_OUTPUT_EXTENSION}` });
            return {
              file: preparedFile,
              name: preparedFile.name,
              originalBytes,
              preparedBytes: preparedFile.size
            };
          }
        }
      }

      if (originalBytes <= MAX_UPLOAD_FILE_BYTES && (!smallestBlob || smallestBlob.size >= originalBytes)) {
        return {
          file,
          name: fileName,
          originalBytes,
          preparedBytes: originalBytes
        };
      }

      throw new Error(`Image file could not be compressed below ${this.formatBytes(MAX_UPLOAD_FILE_BYTES)}.`);
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  private decodeImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not read image file.'));
      image.src = url;
    });
  }

  private toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((value) => {
        if (!value) {
          reject(new Error('Could not compress image.'));
          return;
        }

        resolve(value);
      }, type, quality);
    });
  }

  private normaliseUploadFileName(fileName: string, extension: string): string {
    const baseName = fileName.trim() || 'wardrobe-item';
    return `${baseName.replace(/\.[^/.]+$/, '')}.${extension}`;
  }

  private formatBytes(value: number): string {
    if (value >= 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(value / 1024).toFixed(0)} KB`;
  }
}

@Component({
  selector: 'app-item-detail',
  standalone: false,
  template: `
    <ion-content class="app-content">
      <section class="screen" *ngIf="isLoading">
        <article class="panel state-panel">
          <ion-spinner name="crescent"></ion-spinner>
          <p class="muted">Loading item...</p>
        </article>
      </section>
      <section class="screen" *ngIf="!isLoading && !item">
        <header class="nav-header">
          <button type="button" class="nav-button" routerLink="/tabs/wardrobe" aria-label="Back to wardrobe">
            <ion-icon name="chevron-back-outline"></ion-icon>
          </button>
          <h1>Item</h1>
          <span></span>
        </header>
        <article class="panel state-panel">
          <p class="muted">{{ message || 'Could not load item.' }}</p>
        </article>
      </section>
        <section class="screen" *ngIf="!isLoading && item">
        <header class="nav-header">
          <button type="button" class="nav-button" routerLink="/tabs/wardrobe" aria-label="Back to wardrobe">
            <ion-icon name="chevron-back-outline"></ion-icon>
          </button>
          <h1>{{ item.name }}</h1>
          <button type="button" class="nav-button" aria-label="Edit item" (click)="setItemMode('edit')" *ngIf="!editing">
            <ion-icon name="create-outline"></ion-icon>
          </button>
        </header>
          <div class="product-stage">
            <img class="product-image" [src]="item.image.displayUrl" [alt]="item.name">
            <p class="muted center-message image-status-line" *ngIf="imageGenerationMessage(item.imageGenerationStatus)">
              <ion-spinner *ngIf="isImageGenerationInProgress(item.imageGenerationStatus)" name="crescent"></ion-spinner>
              <span>{{ imageGenerationMessage(item.imageGenerationStatus) }}</span>
            </p>
          </div>
          <ion-button class="taupe-button" expand="block" (click)="markWorn()" *ngIf="!editing" [disabled]="isMarkingWorn">{{ isMarkingWorn ? 'Marking worn...' : 'Mark worn' }}</ion-button>
          <div class="detail-chips">
            <span class="detail-chip" *ngFor="let tag of visibleTags">{{ tag }}</span>
        </div>
          <a class="text-link" *ngIf="item.image.originalUrl" [href]="item.image.originalUrl" target="_blank" rel="noopener noreferrer">View original</a>
        <p class="muted center-message" *ngIf="message && !editing">{{ message }}</p>
        <form class="panel form-stack editor-panel" *ngIf="editing" (ngSubmit)="save()">
          <label>Name<ion-input class="field" [(ngModel)]="form.name" name="name"></ion-input></label>
          <label>
            Category
            <ion-select class="field" [(ngModel)]="form.categoryId" name="categoryId" (ionChange)="syncSubcategory()">
              <ion-select-option *ngFor="let option of lookups?.categories || []" [value]="option.id">{{ option.label }}</ion-select-option>
            </ion-select>
          </label>
          <label>
            Subcategory
            <ion-select class="field" [(ngModel)]="form.subcategoryId" name="subcategoryId">
              <ion-select-option *ngFor="let option of selectedSubcategories" [value]="option.id">{{ option.label }}</ion-select-option>
            </ion-select>
          </label>
          <label>
            Primary colour
            <ion-select class="field" [(ngModel)]="form.primaryColourId" name="primaryColourId">
              <ion-select-option *ngFor="let option of lookups?.colours || []" [value]="option.id">{{ option.label }}</ion-select-option>
            </ion-select>
          </label>
          <label>
            Secondary colours
            <ion-select class="field" multiple="true" [(ngModel)]="form.secondaryColourIds" name="secondaryColourIds">
              <ion-select-option *ngFor="let option of lookups?.colours || []" [value]="option.id">{{ option.label }}</ion-select-option>
            </ion-select>
          </label>
          <label>
            Pattern
            <ion-select class="field" [(ngModel)]="form.patternId" name="patternId">
              <ion-select-option [value]="null">None</ion-select-option>
              <ion-select-option *ngFor="let option of lookups?.patterns || []" [value]="option.id">{{ option.label }}</ion-select-option>
            </ion-select>
          </label>
          <label>
            Visible material
            <ion-select class="field" [(ngModel)]="form.visibleMaterialId" name="visibleMaterialId">
              <ion-select-option [value]="null">None</ion-select-option>
              <ion-select-option *ngFor="let option of lookups?.visibleMaterials || []" [value]="option.id">{{ option.label }}</ion-select-option>
            </ion-select>
          </label>
          <details class="advanced-editor">
            <summary>Garment details</summary>
            <label>
              Neckline
              <ion-select class="field" [(ngModel)]="form.necklineId" name="necklineId">
                <ion-select-option [value]="null">None</ion-select-option>
                <ion-select-option *ngFor="let option of lookups?.necklines || []" [value]="option.id">{{ option.label }}</ion-select-option>
              </ion-select>
            </label>
            <label>
              Sleeve length
              <ion-select class="field" [(ngModel)]="form.sleeveLengthId" name="sleeveLengthId">
                <ion-select-option [value]="null">None</ion-select-option>
                <ion-select-option *ngFor="let option of lookups?.sleeveLengths || []" [value]="option.id">{{ option.label }}</ion-select-option>
              </ion-select>
            </label>
            <label>
              Fit
              <ion-select class="field" [(ngModel)]="form.fitId" name="fitId">
                <ion-select-option [value]="null">None</ion-select-option>
                <ion-select-option *ngFor="let option of lookups?.fits || []" [value]="option.id">{{ option.label }}</ion-select-option>
              </ion-select>
            </label>
            <label>
              Length
              <ion-select class="field" [(ngModel)]="form.lengthId" name="lengthId">
                <ion-select-option [value]="null">None</ion-select-option>
                <ion-select-option *ngFor="let option of lookups?.garmentLengths || []" [value]="option.id">{{ option.label }}</ion-select-option>
              </ion-select>
            </label>
            <label>
              Bottom shape
              <ion-select class="field" [(ngModel)]="form.bottomShapeId" name="bottomShapeId">
                <ion-select-option [value]="null">None</ion-select-option>
                <ion-select-option *ngFor="let option of lookups?.bottomShapes || []" [value]="option.id">{{ option.label }}</ion-select-option>
              </ion-select>
            </label>
            <label>
              Rise
              <ion-select class="field" [(ngModel)]="form.riseId" name="riseId">
                <ion-select-option [value]="null">None</ion-select-option>
                <ion-select-option *ngFor="let option of lookups?.rises || []" [value]="option.id">{{ option.label }}</ion-select-option>
              </ion-select>
            </label>
          </details>
          <ion-button class="primary-button" expand="block" type="submit" [disabled]="isSaving || isArchiving">{{ isSaving ? 'Saving...' : 'Save details' }}</ion-button>
          <ion-button class="secondary-button" fill="outline" expand="block" type="button" (click)="deleteItem()" [disabled]="isArchiving || isSaving || isMarkingWorn">
            {{ isArchiving ? 'Archiving...' : 'Archive item' }}
          </ion-button>
          <ion-button class="secondary-button" fill="clear" expand="block" type="button" (click)="cancelEdit()">Cancel</ion-button>
          <p class="muted" *ngIf="message">{{ message }}</p>
        </form>
      </section>
    </ion-content>
  `
})
export class ItemDetailPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  item: WardrobeItemDto | null = null;
  lookups: WardrobeLookupsDto | null = null;
  form: UpdateWardrobeItemRequest = emptyItemForm();
  message = '';
  isLoading = true;
  isSaving = false;
  isMarkingWorn = false;
  isArchiving = false;
  itemMode: ItemDetailMode = 'view';
  private imageGenerationStatusStream: ImageGenerationStatusStream | null = null;
  private readonly imageGenerationPollingIntervalMs = 1800;
  private imageGenerationPollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingImageGeneration = false;

  get selectedSubcategories(): { id: string; label: string }[] {
    return this.lookups?.categories.find((category) => category.id === this.form.categoryId)?.subcategories ?? [];
  }

  get visibleTags(): string[] {
    if (!this.item || !this.lookups) return [];
    const tags = [
      this.item.categoryId,
      this.item.subcategoryId,
      this.item.primaryColourId,
      this.item.patternId,
      this.item.visibleMaterialId,
      this.item.necklineId,
      this.item.sleeveLengthId,
      this.item.fitId,
      this.item.lengthId,
      this.item.bottomShapeId,
      this.item.riseId
    ];
    return Array.from(new Set(tags.map((id) => lookupLabel(this.lookups!, id)).filter(Boolean))).slice(0, 8);
  }

  async ionViewWillEnter(): Promise<void> {
    await this.loadItem();
  }

  ngOnDestroy(): void {
    this.stopImageGenerationStreaming();
    this.stopImageGenerationPolling();
  }

  private async loadItem(): Promise<void> {
    this.stopImageGenerationStreaming();
    this.stopImageGenerationPolling();
    this.isLoading = true;
    this.message = '';
    this.item = null;
    this.setItemMode('view');
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.message = 'Could not load item.';
      this.isLoading = false;
      return;
    }
    try {
      this.lookups = await this.api.getLookups();
      this.item = await this.api.getItem(id);
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
      this.startImageGenerationStreaming();
    } catch (error) {
      this.message = readMessage(error, 'Could not load item.');
    } finally {
      this.isLoading = false;
    }
  }

  private startImageGenerationStreaming(): void {
    if (!this.item) {
      return;
    }

    this.stopImageGenerationStreaming();
    this.stopImageGenerationPolling();

    if (!this.shouldPollImageGeneration()) {
      return;
    }

    const stream = this.api.streamImageGenerationStatuses(
      [this.item.id],
      [],
      (updates) => this.applyImageGenerationStreamUpdates(updates),
      () => {
        this.imageGenerationStatusStream = null;
        this.startImageGenerationPolling();
      });

    if (stream === null) {
      this.startImageGenerationPolling();
      return;
    }

    this.imageGenerationStatusStream = stream;
  }

  private applyImageGenerationStreamUpdates(updates: ImageGenerationStreamUpdate[]): void {
    if (!this.item) {
      return;
    }

    const itemId = this.item.id;
    const update = updates.find((entry) => entry.kind === 'item' && entry.id === itemId);
    if (!update) {
      return;
    }

    const currentMode = this.itemMode;
    this.item = {
      ...this.item,
      imageGenerationStatus: update.status
    };
    if (currentMode !== 'edit') {
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
    }

    if (!this.shouldPollImageGeneration()) {
      this.stopImageGenerationStreaming();
      void this.refreshItemAfterImageGeneration();
    }
  }

  private async refreshItemAfterImageGeneration(): Promise<void> {
    if (!this.item) {
      return;
    }

    try {
      const latestItem = await this.api.getItem(this.item.id);
      const mode = this.itemMode;
      this.item = latestItem;
      if (mode !== 'edit') {
        this.form = { ...latestItem, secondaryColourIds: latestItem.secondaryColourIds.slice() };
      }
    } catch {
      // Ignore temporary network issues after image generation completes.
    }
  }

  private stopImageGenerationStreaming(): void {
    if (this.imageGenerationStatusStream) {
      this.imageGenerationStatusStream.close();
    }
    this.imageGenerationStatusStream = null;
  }

  private startImageGenerationPolling(): void {
    this.stopImageGenerationPolling();
    if (!this.shouldPollImageGeneration()) {
      return;
    }

    this.imageGenerationPollTimeout = setTimeout(() => {
      this.imageGenerationPollTimeout = null;
      void this.pollImageGeneration();
    }, this.imageGenerationPollingIntervalMs);
  }

  private async pollImageGeneration(): Promise<void> {
    if (!this.item || this.isRefreshingImageGeneration) {
      this.startImageGenerationPolling();
      return;
    }

    if (!this.shouldPollImageGeneration()) {
      return;
    }

    this.isRefreshingImageGeneration = true;
    try {
      const latestItem = await this.api.getItem(this.item.id);
      const mode = this.itemMode;
      this.item = latestItem;
      if (mode !== 'edit') {
        this.form = { ...latestItem, secondaryColourIds: latestItem.secondaryColourIds.slice() };
      }
    } catch {
      // Ignore temporary network issues while polling for image-generation state.
    } finally {
      this.isRefreshingImageGeneration = false;
      this.startImageGenerationPolling();
    }
  }

  private stopImageGenerationPolling(): void {
    if (this.imageGenerationPollTimeout) {
      clearTimeout(this.imageGenerationPollTimeout);
    }
    this.imageGenerationPollTimeout = null;
    this.isRefreshingImageGeneration = false;
  }

  private shouldPollImageGeneration(): boolean {
    return this.isImageGenerationInProgress(this.item?.imageGenerationStatus ?? null);
  }

  imageGenerationMessage(status: string | null): string | null {
    switch (status) {
      case 'queued':
        return 'Image generation queued...';
      case 'generating':
        return 'Generating polished image...';
      case 'failed':
        return 'Image generation failed.';
      default:
        return null;
    }
  }

  isImageGenerationInProgress(status: string | null): boolean {
    return status === 'queued' || status === 'generating';
  }

  async markWorn(): Promise<void> {
    if (!this.item) return;
    if (this.isMarkingWorn) {
      return;
    }

    this.isMarkingWorn = true;
    this.message = 'Marking item as worn...';
    try {
      await this.api.markItemWorn(this.item.id);
      this.message = 'Marked as worn.';
    } catch (error) {
      this.message = readMessage(error, 'Could not mark item as worn.');
    } finally {
      this.isMarkingWorn = false;
    }
  }

  syncSubcategory(): void {
    if (!this.selectedSubcategories.some((option) => option.id === this.form.subcategoryId)) {
      this.form.subcategoryId = this.selectedSubcategories[0]?.id ?? '';
    }
  }

  async save(): Promise<void> {
    if (!this.item) return;
    this.isSaving = true;
    this.message = '';
    try {
      this.item = await this.api.updateItem(this.item.id, this.form);
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
      this.message = 'Details saved.';
      this.setItemMode('view');
    } catch (error) {
      this.message = readMessage(error, 'Could not save details.');
    } finally {
      this.isSaving = false;
    }
  }

  async deleteItem(): Promise<void> {
    if (!this.item || this.isArchiving) return;
    const confirmed = window.confirm(`Archive "${this.item.name}"? This removes it from your wardrobe.`);
    if (!confirmed) {
      return;
    }

    this.isArchiving = true;
    this.message = '';
    try {
      await this.api.deleteItem(this.item.id);
      await this.router.navigateByUrl('/tabs/wardrobe');
    } catch (error) {
      this.message = readMessage(error, 'Could not archive item.');
    } finally {
      this.isArchiving = false;
    }
  }

  cancelEdit(): void {
    this.setItemMode('view');
  }

  get editing(): boolean {
    return this.itemMode === 'edit';
  }

  setItemMode(mode: ItemDetailMode): void {
    if (this.itemMode === mode) {
      return;
    }

    this.itemMode = mode;
    this.message = '';
    if (mode === 'view' && this.item) {
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
    }
  }
}

@Component({
  selector: 'app-builder',
  standalone: false,
  template: `
    <ion-content class="app-content">
      <section class="screen">
        <header class="nav-header">
          <button type="button" class="nav-button" routerLink="/tabs/wardrobe" aria-label="Back to wardrobe">
            <ion-icon name="chevron-back-outline"></ion-icon>
          </button>
          <h1>Build an outfit</h1>
          <span></span>
        </header>
        <article class="query-card form-stack">
          <div class="textarea-wrap">
            <ion-textarea class="field outfit-query" rows="5" maxlength="120" [(ngModel)]="query" placeholder="Smart casual dinner using my black jeans, no heels"></ion-textarea>
            <button type="button" class="clear-button" aria-label="Clear outfit request" (click)="clearQuery()" *ngIf="query">
              <ion-icon name="close-outline"></ion-icon>
            </button>
            <span class="character-count">{{ query.length }}/120</span>
          </div>
          <label *ngIf="items.length">
            Use a specific item
            <ion-select class="field" [(ngModel)]="requiredItemId" name="requiredItemId">
              <ion-select-option [value]="null">No specific item</ion-select-option>
              <ion-select-option *ngFor="let item of items" [value]="item.id">{{ item.name }}</ion-select-option>
            </ion-select>
          </label>
          <div class="chip-row">
            <button type="button" class="chip" *ngFor="let chip of chips" (click)="append(chip)">{{ chip }}</button>
          </div>
          <ion-button class="primary-button" expand="block" (click)="search()" [disabled]="isBusy || !query.trim()">{{ isBuildingOutfits ? 'Building...' : 'Build outfits' }}</ion-button>
          <p class="muted consent-note">Wardrobe AI sends your outfit request and wardrobe item details to OpenAI to generate outfit suggestions.</p>
          <div class="status-line" *ngIf="isBuildingOutfits"><ion-spinner name="crescent"></ion-spinner><span>Building outfit suggestions...</span></div>
        </article>
        <article class="panel form-stack manual-builder">
          <div class="panel-heading">
            <h2 class="section-title">{{ manualItemIds.length ? 'Selected outfit' : 'Pick items' }}</h2>
            <button type="button" class="icon-button" aria-label="Clear selected manual items" (click)="clearManualSelection()" [disabled]="!manualItemIds.length || isBusy">
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </div>
          <label *ngIf="manualItemIds.length">
            Outfit name
            <ion-input class="field" [(ngModel)]="manualName" name="manualName"></ion-input>
          </label>
          <div class="manual-summary">
            <span>{{ manualItemIds.length }} selected</span>
            <ion-button class="quiet-button compact-button" fill="clear" size="small" (click)="selectAllItems()" [disabled]="!items.length || isBusy">Select all</ion-button>
          </div>
          <div class="manual-grid" *ngIf="items.length">
            <button type="button" class="item-card manual-item" *ngFor="let item of items; trackBy: trackById" [class.selected]="isManualSelected(item.id)" (click)="toggleManualItem(item.id)">
              <div class="item-card__image-wrap manual-item__image-wrap">
                <img [src]="item.image.displayUrl" [alt]="item.name">
                <span class="manual-item__check">
                  <ion-icon [name]="isManualSelected(item.id) ? 'checkmark-circle' : 'ellipse-outline'"></ion-icon>
                </span>
              </div>
              <div class="item-card__body">
                <h3>{{ item.name }}</h3>
                <div class="meta-line"><span>{{ label(item.subcategoryId) }}</span></div>
                <div class="colour-dots" aria-label="Item colours">
                  <span class="colour-dot" *ngFor="let colour of coloursFor(item)" [style.background]="colourSwatch(colour)"></span>
                </div>
              </div>
            </button>
          </div>
          <p class="muted" *ngIf="!items.length">Load wardrobe items to build a manual outfit.</p>
          <p class="muted" *ngIf="manualItemIds.length && !manualCanSave">{{ manualHint }}</p>
          <ion-button class="primary-button" expand="block" *ngIf="manualItemIds.length" (click)="saveManual()" [disabled]="isBusy || !manualCanSave">{{ isSavingManualOutfit ? 'Saving...' : 'Save outfit' }}</ion-button>
        </article>
        <h2 class="section-title" *ngIf="results.length">Outfit ideas</h2>
        <article class="outfit-card idea-card" *ngFor="let outfit of results">
          <img class="outfit-hero-image" *ngIf="outfit.imageUrl" [src]="outfit.imageUrl" [alt]="outfit.title">
          <div class="outfit-images" *ngIf="!outfit.imageUrl">
            <img *ngFor="let id of outfit.itemIds" [src]="imageFor(id)" [alt]="nameFor(id)">
          </div>
          <div class="outfit-copy">
            <h3>{{ outfit.title }}</h3>
            <p class="muted">{{ outfit.explanation }}</p>
            <div class="outfit-item-list">
              <span *ngFor="let id of outfit.itemIds">{{ nameFor(id) }}</span>
            </div>
            <ion-button class="primary-button small-action" (click)="save(outfit)" [disabled]="isSavingGeneratedOutfit(outfit)">
              {{ isSavingGeneratedOutfit(outfit) ? 'Saving...' : 'Save outfit' }}
            </ion-button>
          </div>
        </article>
        <p class="muted" *ngIf="message">{{ message }}</p>
      </section>
    </ion-content>
  `
})
export class BuilderPage {
  private readonly api = inject(WardrobeApiService);
  query = 'Smart casual dinner using my black jeans, no heels';
  chips = ['Work', 'Dinner', 'Brunch', 'No heels', 'Smart casual'];
  items: WardrobeItemDto[] = [];
  lookups: WardrobeLookupsDto | null = null;
  results: GeneratedOutfitDto[] = [];
  requiredItemId: string | null = null;
  manualName = 'Manual outfit';
  manualItemIds: string[] = [];
  message = '';
  isBuildingOutfits = false;
  isSavingManualOutfit = false;
  private readonly savingGeneratedOutfitKeys = new Set<string>();

  get isBusy(): boolean {
    return this.isBuildingOutfits || this.isSavingManualOutfit;
  }

  async ionViewWillEnter(): Promise<void> {
    this.message = '';
    try {
      this.lookups ??= await this.api.getLookups();
      this.items = await this.api.getItems();
      this.manualItemIds = this.manualItemIds.filter((id) => this.items.some((item) => item.id === id));
    } catch (error) {
      this.message = readMessage(error, 'Could not load wardrobe items.');
    }
  }

  append(value: string): void {
    this.query = `${this.query} ${value}`.trim();
  }

  clearQuery(): void {
    this.query = '';
  }

  toggleManualItem(id: string): void {
    if (this.manualItemIds.includes(id)) {
      this.manualItemIds = this.manualItemIds.filter((value) => value !== id);
      return;
    }

    this.manualItemIds = [...this.manualItemIds, id];
  }

  clearManualSelection(): void {
    this.manualItemIds = [];
  }

  selectAllItems(): void {
    this.manualItemIds = this.items.map((item) => item.id);
  }

  async search(): Promise<void> {
    if (!await ensureAiConsent(
      'Wardrobe AI uses OpenAI to interpret your outfit request and generate outfit suggestions from your wardrobe. Do you want to continue with AI processing for this device?'))
    {
      this.message = 'OpenAI consent is required before Wardrobe AI can build outfit suggestions.';
      return;
    }

    this.isBuildingOutfits = true;
    this.message = '';
    try {
      this.lookups ??= await this.api.getLookups();
      this.items = await this.api.getItems();
      this.results = await this.api.searchOutfits(this.query, this.requiredItemId);
      if (!this.results.length) {
        this.message = 'No outfit matched that request. Try removing one restriction.';
      }
    } catch (error) {
      this.results = [];
      this.message = readMessage(error, 'Could not build an outfit from the current wardrobe.');
    } finally {
      this.isBuildingOutfits = false;
    }
  }

  async saveManual(): Promise<void> {
    if (!this.manualCanSave) {
      this.message = this.manualHint || 'Add more clothing items to build complete outfits.';
      return;
    }

    this.isSavingManualOutfit = true;
    this.message = '';
    try {
      await this.api.saveOutfit(this.manualName.trim() || 'Manual outfit', null, 'Built manually from selected wardrobe items.', this.manualItemIds);
      this.message = 'Outfit saved.';
    } catch (error) {
      this.message = readMessage(error, 'Could not save outfit.');
    } finally {
      this.isSavingManualOutfit = false;
    }
  }

  async save(outfit: GeneratedOutfitDto): Promise<void> {
    const key = this.generatedOutfitKey(outfit);
    if (this.savingGeneratedOutfitKeys.has(key)) {
      return;
    }

    this.savingGeneratedOutfitKeys.add(key);
    this.message = '';
    try {
      await this.api.saveOutfit(outfit.title, this.query, outfit.explanation, outfit.itemIds, outfit.imageUrl);
      this.message = 'Outfit saved.';
    } catch (error) {
      this.message = readMessage(error, 'Could not save outfit.');
    } finally {
      this.savingGeneratedOutfitKeys.delete(key);
    }
  }

  imageFor(id: string): string {
    return this.items.find((x) => x.id === id)?.image.displayUrl ?? '';
  }

  nameFor(id: string): string {
    return this.items.find((x) => x.id === id)?.name ?? 'Wardrobe item';
  }

  label(id: string | null): string {
    if (!id || !this.lookups) return '';
    return lookupLabel(this.lookups, id);
  }

  coloursFor(item: WardrobeItemDto): string[] {
    return [item.primaryColourId, ...item.secondaryColourIds].filter(Boolean).slice(0, 4);
  }

  colourSwatch(id: string): string {
    return colourSwatch(id);
  }

  isManualSelected(id: string): boolean {
    return this.manualItemIds.includes(id);
  }

  get manualCanSave(): boolean {
    return this.isValidManualOutfit(this.selectedManualItems());
  }

  get manualHint(): string {
    const selected = this.selectedManualItems();
    if (!selected.length) {
      return '';
    }

    if (!selected.some((item) => this.manualCategory(item) === 'footwear')) {
      return 'Add shoes to complete the outfit.';
    }

    if (!this.isValidManualOutfit(selected)) {
      return 'Choose a top and bottom (including activewear variants), a dress, or one piece, with one pair of shoes.';
    }

    return '';
  }

  private selectedManualItems(): WardrobeItemDto[] {
    return this.manualItemIds
      .map((id) => this.items.find((item) => item.id === id))
      .filter((item): item is WardrobeItemDto => !!item);
  }

  private isValidManualOutfit(items: WardrobeItemDto[]): boolean {
    const count = (predicate: (item: WardrobeItemDto) => boolean): number => items.filter(predicate).length;
    const tops = count((item) => this.manualCategory(item) === 'tops');
    const bottoms = count((item) => this.manualCategory(item) === 'bottoms');
    const dresses = count((item) => this.manualCategory(item) === 'dresses');
    const onePieces = count((item) => this.manualCategory(item) === 'one_pieces');
    const footwear = count((item) => this.manualCategory(item) === 'footwear');
    const outerwear = count((item) => this.manualCategory(item) === 'outerwear');
    const bags = count((item) => this.manualCategory(item) === 'bags');
    const accessories = count((item) => this.manualCategory(item) === 'accessories');
    const supportedItems = tops + bottoms + dresses + onePieces + footwear + outerwear + bags + accessories;

    if (supportedItems !== items.length || footwear !== 1 || outerwear > 1 || bags > 1) {
      return false;
    }

    return (tops === 1 && bottoms === 1 && dresses === 0 && onePieces === 0)
      || (dresses === 1 && tops === 0 && bottoms === 0 && onePieces === 0)
      || (onePieces === 1 && tops === 0 && bottoms === 0 && dresses === 0);
  }

  trackById(_: number, item: WardrobeItemDto): string {
    return item.id;
  }

  isSavingGeneratedOutfit(outfit: GeneratedOutfitDto): boolean {
    return this.savingGeneratedOutfitKeys.has(this.generatedOutfitKey(outfit));
  }

  private manualCategory(item: WardrobeItemDto): string | null {
    if (item.categoryId === 'activewear') {
      if (this.isActivewearTop(item)) return 'tops';
      if (this.isActivewearBottom(item)) return 'bottoms';
      return null;
    }

    if (item.categoryId === 'tops' || item.categoryId === 'knitwear') {
      return 'tops';
    }

    if (item.categoryId === 'one_pieces') {
      return 'one_pieces';
    }

    return item.categoryId === 'accessories'
      || item.categoryId === 'bags'
      || item.categoryId === 'bottoms'
      || item.categoryId === 'dresses'
      || item.categoryId === 'footwear'
      || item.categoryId === 'outerwear'
      ? item.categoryId
      : null;
  }

  private isActivewearTop(item: WardrobeItemDto): boolean {
    return isActivewearTopSubcategory(item.subcategoryId);
  }

  private isActivewearBottom(item: WardrobeItemDto): boolean {
    return isActivewearBottomSubcategory(item.subcategoryId);
  }

  private generatedOutfitKey(outfit: GeneratedOutfitDto): string {
    return `${outfit.title}::${outfit.itemIds.join(',')}::${outfit.imageUrl ?? ''}`;
  }
}

@Component({
  selector: 'app-outfits',
  standalone: false,
  template: `
    <ion-content class="app-content">
      <section class="screen">
        <header class="page-header">
          <h1>Outfits</h1>
          <button type="button" class="icon-button" aria-label="Refresh outfits" (click)="load()">
            <ion-icon name="refresh-outline"></ion-icon>
          </button>
        </header>
        <article class="panel state-panel" *ngIf="isLoading">
          <ion-spinner name="crescent"></ion-spinner>
          <p class="muted">Loading outfits...</p>
        </article>
        <article class="panel state-panel" *ngIf="!isLoading && message">
          <p class="muted">{{ message }}</p>
        </article>
        <ng-container *ngIf="!selectedOutfit">
          <article class="outfit-card" *ngFor="let outfit of outfits">
            <button type="button" class="outfit-open" (click)="open(outfit)">
              <img class="outfit-hero-image" *ngIf="outfit.imageUrl" [src]="outfit.imageUrl" [alt]="outfit.name">
            </button>
            <div class="outfit-images" *ngIf="!outfit.imageUrl">
              <img *ngFor="let item of outfit.items" [src]="item.image.displayUrl" [alt]="item.name">
            </div>
            <div class="outfit-copy">
              <h3>{{ outfit.name }}</h3>
              <p class="muted">{{ outfit.explanation || 'Saved from your wardrobe.' }}</p>
              <div class="muted" *ngIf="outfitGenerationMessage(outfit.imageGenerationStatus) as status">
                <span>{{ status }}</span>
              </div>
              <div class="outfit-item-list">
                <span *ngFor="let item of outfit.items">{{ item.name }}</span>
              </div>
            </div>
            <div class="outfit-actions">
              <ion-button class="secondary-button compact-button" fill="outline" (click)="open(outfit)">Open</ion-button>
              <ion-button class="secondary-button compact-button" fill="outline" (click)="markWorn(outfit)"
                [disabled]="isMarkingOutfit(outfit.id) || isRemovingOutfit(outfit.id)">
                {{ isMarkingOutfit(outfit.id) ? 'Marking...' : 'Mark worn' }}
              </ion-button>
              <ion-button class="quiet-button compact-button" fill="clear" (click)="remove(outfit)"
                [disabled]="isRemovingOutfit(outfit.id) || isMarkingOutfit(outfit.id)">
                {{ isRemovingOutfit(outfit.id) ? 'Deleting...' : 'Delete' }}
              </ion-button>
            </div>
          </article>
        </ng-container>
        <article class="panel outfit-detail-panel" *ngIf="selectedOutfit">
          <div class="panel-heading">
            <h2 class="section-title">{{ selectedOutfit.name }}</h2>
            <button type="button" class="icon-button" aria-label="Close outfit details" (click)="close()">
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </div>
          <img class="outfit-detail-image" *ngIf="selectedOutfit.imageUrl" [src]="selectedOutfit.imageUrl" [alt]="selectedOutfit.name">
          <p class="muted center-message image-status-line" *ngIf="outfitGenerationMessage(selectedOutfit.imageGenerationStatus)">
            <ion-spinner *ngIf="isOutfitImageGenerationInProgress(selectedOutfit.imageGenerationStatus)" name="crescent"></ion-spinner>
            <span>{{ outfitGenerationMessage(selectedOutfit.imageGenerationStatus) }}</span>
          </p>
          <div class="outfit-detail-items">
            <div class="outfit-detail-item" *ngFor="let item of selectedOutfit.items">
              <img [src]="item.image.displayUrl" [alt]="item.name">
              <div>
                <strong>{{ item.name }}</strong>
                <span>{{ item.subcategoryId }}</span>
              </div>
            </div>
          </div>
        </article>
        <article class="panel" *ngIf="!selectedOutfit && !isLoading && !message && !outfits.length">
          <h2 class="plain-title">No saved outfits</h2>
          <p class="muted">Build an outfit and save the ones worth repeating.</p>
        </article>
      </section>
    </ion-content>
  `
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
  private outfitGenerationPollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingOutfits = false;

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  ngOnDestroy(): void {
    this.stopOutfitGenerationStreaming();
    this.stopOutfitGenerationPolling();
  }

  async load(): Promise<void> {
    this.stopOutfitGenerationStreaming();
    this.stopOutfitGenerationPolling();
    this.isLoading = true;
    this.message = '';
    try {
      this.outfits = await this.api.getOutfits();
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
      const outfits = await this.api.getOutfits();
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
      const outfits = await this.api.getOutfits();
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
      await this.load();
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
}

@Component({
  selector: 'app-settings',
  standalone: false,
  template: `
    <ion-content class="app-content">
      <section class="screen">
        <header class="page-header">
          <h1>Settings</h1>
        </header>
        <div class="intent-switch" role="tablist" aria-label="Settings section">
          <button type="button" class="intent-tab" [class.active]="settingsMode === 'account'" (click)="setSettingsMode('account')" role="tab">Account</button>
          <button type="button" class="intent-tab" [class.active]="settingsMode === 'ai'" (click)="setSettingsMode('ai')" role="tab">AI</button>
          <button type="button" class="intent-tab" [class.active]="settingsMode === 'legal'" (click)="setSettingsMode('legal')" role="tab">Legal</button>
          <button type="button" class="intent-tab" [class.active]="settingsMode === 'danger'" (click)="setSettingsMode('danger')" role="tab">Danger</button>
        </div>
        <article class="panel settings-card" *ngIf="settingsMode === 'account'">
          <h1 class="plain-title">{{ auth.session?.user?.displayName || 'Wardrobe AI' }}</h1>
          <p class="muted">{{ auth.session?.user?.email }}</p>
        </article>
        <article class="panel settings-card" *ngIf="settingsMode === 'account'">
          <h2 class="section-title">Device session</h2>
          <p class="muted">This device stores your Wardrobe AI session in local app preferences until you sign out or delete your account.</p>
          <p class="muted" *ngIf="sessionExpiresAtLabel">Current session expires {{ sessionExpiresAtLabel }}.</p>
          <ion-button class="secondary-button" fill="outline" (click)="logout()" [disabled]="isBusy">{{ isBusy ? 'Working...' : 'Sign out' }}</ion-button>
        </article>
        <article class="panel settings-card" *ngIf="settingsMode === 'ai'">
          <h2 class="section-title">AI processing</h2>
          <div class="usage-total">
            <span>Total estimated AI cost</span>
            <strong>{{ aiUsageTotalLabel }}</strong>
          </div>
          <p class="muted" *ngIf="aiUsage">Based on {{ aiUsage.wardrobeItemClassifications }} item scans, {{ aiUsage.outfitSearches }} saved AI outfit searches, and {{ aiUsage.displayImages + aiUsage.outfitImages }} generated images.</p>
          <p class="muted">{{ aiConsentAccepted ? 'This device is allowed to send wardrobe photos and outfit requests to OpenAI.' : 'This device has not granted OpenAI processing consent yet.' }}</p>
          <p class="muted">{{ aiDisclosure }}</p>
          <ion-button class="secondary-button" fill="outline" (click)="resetAiConsent()" [disabled]="isBusy || !aiConsentAccepted">Require consent again</ion-button>
          <p class="muted" *ngIf="message">{{ message }}</p>
        </article>
        <article class="panel settings-card" *ngIf="settingsMode === 'legal'">
          <h2 class="section-title">Legal and support</h2>
          <a class="text-link" [href]="privacyPolicyUrl" target="_blank" rel="noopener noreferrer">Privacy policy</a>
          <a class="text-link" [href]="termsUrl" target="_blank" rel="noopener noreferrer">Terms of use</a>
          <a class="text-link" [href]="supportUrl" target="_blank" rel="noopener noreferrer">Support</a>
        </article>
        <article class="panel settings-card danger-panel" *ngIf="settingsMode === 'danger'">
          <h2 class="section-title">Delete account</h2>
          <p class="muted">Deleting your account permanently removes your sign-in, wardrobe items, saved outfits, uploaded images, and related cloud data.</p>
          <ion-button class="secondary-button destructive-button" fill="outline" (click)="deleteAccount()" [disabled]="isBusy">{{ isBusy ? 'Deleting...' : 'Delete account' }}</ion-button>
          <p class="muted" *ngIf="message">{{ message }}</p>
        </article>
      </section>
    </ion-content>
  `
})
export class SettingsPage {
  readonly auth = inject(AuthService);
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  readonly privacyPolicyUrl = PRIVACY_POLICY_URL;
  readonly termsUrl = TERMS_OF_USE_URL;
  readonly supportUrl = SUPPORT_URL;
  readonly aiDisclosure = AI_DISCLOSURE_TEXT;
  aiConsentAccepted = false;
  aiUsage: AiUsageCostSummaryDto | null = null;
  isBusy = false;
  message = '';
  settingsMode: SettingsMode = 'account';

  async ionViewWillEnter(): Promise<void> {
    this.aiConsentAccepted = await hasAiConsent();
    this.message = '';
    try {
      this.aiUsage = await this.api.getAiUsageCostSummary();
    } catch {
      this.aiUsage = null;
    }
  }

  get sessionExpiresAtLabel(): string {
    const expiresAt = this.auth.session?.expiresAt;
    if (!expiresAt) {
      return '';
    }

    const parsed = Date.parse(expiresAt);
    if (Number.isNaN(parsed)) {
      return '';
    }

    return `on ${new Date(parsed).toLocaleString()}`;
  }

  get aiUsageTotalLabel(): string {
    const value = this.aiUsage?.totalCostUsd ?? 0;
    return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  setSettingsMode(mode: SettingsMode): void {
    if (this.settingsMode === mode) {
      return;
    }

    this.settingsMode = mode;
    if (mode !== 'danger') {
      this.message = '';
    }
  }

  async logout(): Promise<void> {
    this.isBusy = true;
    await this.auth.logout();
    this.isBusy = false;
    await this.router.navigateByUrl('/login');
  }

  async resetAiConsent(): Promise<void> {
    if (!this.aiConsentAccepted || !window.confirm('Require consent again for OpenAI wardrobe processing on this device?')) {
      return;
    }

    await clearAiConsent();
    this.aiConsentAccepted = false;
    this.message = 'OpenAI consent was cleared for this device.';
  }

  async deleteAccount(): Promise<void> {
    const confirmed = window.confirm('Delete your Wardrobe AI account? This permanently removes your account, wardrobe items, saved outfits, uploaded images, and related cloud data.');
    if (!confirmed) {
      return;
    }

    this.isBusy = true;
    this.message = '';
    try {
      await this.auth.deleteAccount();
      await clearAiConsent();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.message = readMessage(error, 'Could not delete your account. Try again.');
    } finally {
      this.isBusy = false;
    }
  }
}

function emptyItemForm(): UpdateWardrobeItemRequest {
  return {
    name: '',
    categoryId: '',
    subcategoryId: '',
    primaryColourId: '',
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
}

function lookupLabel(lookups: WardrobeLookupsDto, id: string | null): string {
  if (!id) return '';
  const subcategories = lookups.categories.reduce((values, category) => values.concat(category.subcategories), [] as { id: string; label: string }[]);
  const all = [
    ...lookups.categories,
    ...subcategories,
    ...lookups.colours,
    ...lookups.patterns,
    ...lookups.visibleMaterials,
    ...lookups.necklines,
    ...lookups.sleeveLengths,
    ...lookups.fits,
    ...lookups.garmentLengths,
    ...lookups.bottomShapes,
    ...lookups.rises
  ];
  return all.find((x) => x.id === id)?.label ?? id.replace(/_/g, ' ');
}

function colourSwatch(id: string): string {
  const colours: Record<string, string> = {
    black: '#0e0d0c',
    white: '#f8f4ec',
    grey: '#9a958e',
    cream: '#eadfc9',
    beige: '#d6c4a8',
    brown: '#8a5f3d',
    navy: '#202c45',
    blue: '#496c8f',
    green: '#687158',
    red: '#9e4137',
    pink: '#d8a2a8',
    purple: '#796184',
    yellow: '#d7b657',
    orange: '#c97845',
    metallic: '#b7a47d',
    multi: 'linear-gradient(135deg, #0e0d0c 0 25%, #eadfc9 25% 50%, #9e4137 50% 75%, #687158 75%)'
  };
  return colours[id] ?? '#c4b8a8';
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ACTIVEWEAR_TOP_SUBCATEGORIES = new Set([
  'active_tops',
  'active_top',
  'top_activewear',
  'activewear_top',
  'activewear_tops',
  'tops_activewear',
  'athletic_top',
  'athletic_tops',
  'sports_bra',
  'active_tee',
  'active_tshirt',
  'sports_top',
  'sport_top',
  'sport_tops'
]);

const ACTIVEWEAR_BOTTOM_SUBCATEGORIES = new Set([
  'active_bottoms',
  'active_bottom',
  'bottom_activewear',
  'activewear_bottom',
  'activewear_bottoms',
  'bottoms_activewear',
  'athletic_bottom',
  'athletic_bottoms',
  'active_short',
  'active_shorts',
  'sport_bottom',
  'sports_bottom',
  'sports_bottoms',
  'legging',
  'leggings',
  'joggers'
]);

function isActivewearTopSubcategory(subcategoryId: string): boolean {
  const normalised = subcategoryId.trim().toLowerCase();
  if (ACTIVEWEAR_TOP_SUBCATEGORIES.has(normalised)) {
    return true;
  }

  return /(^|[_-])(top|jersey|tank|shirt|tshirt|tee|vest|hoodie|sweatshirt|bra|polo|sleeveless)($|[_-])/i.test(normalised);
}

function isActivewearBottomSubcategory(subcategoryId: string): boolean {
  const normalised = subcategoryId.trim().toLowerCase();
  if (ACTIVEWEAR_BOTTOM_SUBCATEGORIES.has(normalised)) {
    return true;
  }

  return /(^|[_-])(bottom|short|shorts|legging|leggings|pant|pants|trouser|tights|jogger|joggers)($|[_-])/i.test(normalised);
}

const AI_CONSENT_KEY = 'wardrobe-ai-openai-consent';
const PRIVACY_POLICY_URL = 'https://wardrobe.ai/privacy';
const TERMS_OF_USE_URL = 'https://wardrobe.ai/terms';
const SUPPORT_URL = 'mailto:support@wardrobe.ai';
const AI_DISCLOSURE_TEXT = 'Wardrobe AI uses OpenAI to classify wardrobe photos, generate cleaned display images, and suggest outfits from your saved wardrobe. Avoid uploading photos or prompts that you do not want processed by that provider.';
const MAX_BATCH_UPLOAD_COUNT = 10;
const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const IMAGE_COMPRESSION_TRIGGER_BYTES = 1.5 * 1024 * 1024;
const IMAGE_MIN_SIDE = 600;
const IMAGE_COMPRESSION_MAX_SIDES = [2200, 1800, 1400, 1000];
const IMAGE_COMPRESSION_QUALITIES = [0.82, 0.72, 0.62];
const MIME_IMAGE_OUTPUT_EXTENSION = 'jpeg';

async function hasAiConsent(): Promise<boolean> {
  const stored = await Preferences.get({ key: AI_CONSENT_KEY });
  return stored.value === 'accepted';
}

async function ensureAiConsent(prompt: string): Promise<boolean> {
  if (await hasAiConsent()) {
    return true;
  }

  const confirmed = window.confirm(prompt);
  if (!confirmed) {
    return false;
  }

  await Preferences.set({ key: AI_CONSENT_KEY, value: 'accepted' });
  return true;
}

async function clearAiConsent(): Promise<void> {
  await Preferences.remove({ key: AI_CONSENT_KEY });
}

function readMessage(error: unknown, fallback: string): string {
  const candidate = error as { error?: ApiMessage; status?: number; message?: string };
  if (candidate.status === 0) {
    return 'Could not reach Wardrobe AI. Check your connection and try again.';
  }

  return candidate.error?.message ?? candidate.message ?? fallback;
}
