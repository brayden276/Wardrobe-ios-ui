import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';
import { AuthService } from './auth.service';
import { ApiMessage, GeneratedOutfitDto, OutfitDto, UpdateWardrobeItemRequest, WardrobeItemDto, WardrobeLookupsDto } from './models';
import { WardrobeApiService } from './wardrobe-api.service';

@Component({
  selector: 'app-login',
  standalone: false,
  template: `
    <ion-content class="app-content">
      <section class="screen login-screen">
        <div>
          <h1 class="plain-title">Wardrobe AI</h1>
          <p class="muted">Your private wardrobe catalogue and outfit builder.</p>
        </div>
        <form class="panel form-stack" (ngSubmit)="submit()">
          <label>
            Email
            <ion-input class="field" type="email" [(ngModel)]="email" name="email"></ion-input>
          </label>
          <label>
            Password
            <ion-input class="field" type="password" [(ngModel)]="password" name="password"></ion-input>
          </label>
          <label *ngIf="mode === 'register'">
            Name
            <ion-input class="field" [(ngModel)]="displayName" name="displayName"></ion-input>
          </label>
          <ion-button class="primary-button" expand="block" type="submit" [disabled]="isBusy">{{ mode === 'login' ? 'Sign in' : 'Create account' }}</ion-button>
          <ion-button class="secondary-button" fill="outline" expand="block" type="button" (click)="toggleMode()">{{ mode === 'login' ? 'Create account' : 'I already have an account' }}</ion-button>
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

  toggleMode(): void {
    this.mode = this.mode === 'login' ? 'register' : 'login';
    this.message = '';
  }

  async submit(): Promise<void> {
    this.isBusy = true;
    this.message = '';
    try {
      if (this.mode === 'login') {
        await this.auth.login(this.email, this.password);
      } else {
        await this.auth.register(this.email, this.password, this.displayName);
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
          <ion-searchbar class="wardrobe-search" [(ngModel)]="search" placeholder="Search black jeans, blazers..." (ionInput)="load()"></ion-searchbar>
          <button type="button" class="filter-button" aria-label="Clear wardrobe filters" (click)="clearFilters()" [disabled]="!hasFilters">
            <ion-icon name="options-outline"></ion-icon>
          </button>
        </div>
        <article class="panel filter-panel">
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
                <ion-select class="field" [(ngModel)]="visibleMaterialId" name="visibleMaterialId" (ionChange)="load()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.visibleMaterials || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Neckline
                <ion-select class="field" [(ngModel)]="necklineId" name="necklineId" (ionChange)="load()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.necklines || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Sleeve
                <ion-select class="field" [(ngModel)]="sleeveLengthId" name="sleeveLengthId" (ionChange)="load()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.sleeveLengths || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Fit
                <ion-select class="field" [(ngModel)]="fitId" name="fitId" (ionChange)="load()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.fits || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Length
                <ion-select class="field" [(ngModel)]="lengthId" name="lengthId" (ionChange)="load()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.garmentLengths || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Shape
                <ion-select class="field" [(ngModel)]="bottomShapeId" name="bottomShapeId" (ionChange)="load()">
                  <ion-select-option [value]="null">Any</ion-select-option>
                  <ion-select-option *ngFor="let option of lookups?.bottomShapes || []" [value]="option.id">{{ option.label }}</ion-select-option>
                </ion-select>
              </label>
              <label>
                Rise
                <ion-select class="field" [(ngModel)]="riseId" name="riseId" (ionChange)="load()">
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
        <ion-fab-button class="fab-camera" routerLink="/tabs/add"><ion-icon name="camera-outline"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `
})
export class WardrobePage {
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
  search = '';
  isLoading = true;
  message = '';

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

  async load(): Promise<void> {
    this.isLoading = true;
    this.message = '';
    try {
      this.lookups ??= await this.api.getLookups();
      const params: Record<string, string | boolean> = {
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
      this.items = await this.api.getItems(params);
    } catch (error) {
      this.message = readMessage(error, 'Could not load wardrobe. Pull down or try again.');
      this.items = [];
    } finally {
      this.isLoading = false;
    }
  }

  async setCategory(categoryId: string | null): Promise<void> {
    this.categoryId = categoryId;
    this.subcategoryId = null;
    await this.load();
  }

  async setSubcategory(subcategoryId: string | null): Promise<void> {
    this.subcategoryId = subcategoryId;
    await this.load();
  }

  async setColour(colourId: string | null): Promise<void> {
    this.colourId = colourId;
    await this.load();
  }

  async setPattern(patternId: string | null): Promise<void> {
    this.patternId = patternId;
    await this.load();
  }

  async setIncludeArchived(includeArchived: boolean): Promise<void> {
    this.includeArchived = includeArchived;
    await this.load();
  }

  async clearFilters(): Promise<void> {
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
    await this.load();
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
        <div class="capture-stage">
          <img *ngIf="previewUrl" [src]="previewUrl" alt="Selected wardrobe item">
          <div class="capture-placeholder" *ngIf="!previewUrl">
            <ion-icon name="scan-outline"></ion-icon>
            <p>Place one item flat on a plain surface.</p>
          </div>
        </div>
        <article class="capture-dock">
          <div class="camera-control-row">
            <button type="button" class="round-control" (click)="capture(CameraSource.Photos)" [disabled]="isSaving" aria-label="Choose from library">
              <ion-icon name="images-outline"></ion-icon>
            </button>
            <button type="button" class="shutter-button" (click)="capture(CameraSource.Camera)" [disabled]="isSaving" aria-label="Take photo"></button>
            <button type="button" class="round-control" (click)="clearSelection()" [disabled]="isSaving || !previewUrl" aria-label="Clear selected photo">
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </div>
          <ion-button class="primary-button olive-button" expand="block" (click)="imageBlob ? upload() : capture(CameraSource.Camera)" [disabled]="isSaving">{{ isSaving ? 'Processing item...' : imageBlob ? 'Submit photo' : 'Take photo' }}</ion-button>
          <ion-button class="light-button" expand="block" (click)="capture(CameraSource.Photos)" [disabled]="isSaving">{{ imageBlob ? 'Choose different photo' : 'Choose from library' }}</ion-button>
          <ion-button class="secondary-button retry-button" fill="outline" expand="block" *ngIf="imageBlob && message && !isSaving" (click)="upload()">Try again</ion-button>
          <div class="processing-line" *ngIf="isSaving">
            <ion-spinner name="crescent"></ion-spinner>
            <span>Uploading and categorising item...</span>
          </div>
          <p>{{ imageBlob ? 'Ready to submit for categorisation.' : 'One item, clearly visible.' }}</p>
          <p class="muted consent-note">Wardrobe AI sends uploaded wardrobe photos to OpenAI to classify items and generate cleaned display images.</p>
          <p class="muted consent-note">Only upload clothing photos you are comfortable sharing with that provider.</p>
          <p class="muted" *ngIf="message">{{ message }}</p>
        </article>
        <article class="panel form-stack batch-panel">
          <div class="panel-heading">
            <h2 class="section-title">Batch upload</h2>
            <button type="button" class="icon-button" aria-label="Choose batch photos" (click)="openBatchPicker()" [disabled]="isBatchSaving">
              <ion-icon name="images-outline"></ion-icon>
            </button>
          </div>
          <div class="batch-summary" *ngIf="batchFiles.length">
            <span>{{ batchFiles.length }} selected</span>
            <ion-button class="quiet-button compact-button" fill="clear" size="small" (click)="clearBatchSelection()" [disabled]="isBatchSaving">Clear</ion-button>
          </div>
          <div class="batch-grid" *ngIf="batchFiles.length">
            <button type="button" class="batch-item" *ngFor="let file of batchFiles; let index = index" (click)="removeBatchFile(index)" [disabled]="isBatchSaving">
              <img [src]="batchPreviewUrls[index]" [alt]="file.name">
              <span>{{ file.name }}</span>
            </button>
          </div>
          <p class="muted" *ngIf="!batchFiles.length">Select multiple photos and upload them together.</p>
          <p class="muted consent-note">Batch uploads use the same OpenAI-powered classification flow as single-item uploads.</p>
          <ion-button class="primary-button" expand="block" (click)="uploadBatch()" [disabled]="isBatchSaving || !batchFiles.length">{{ isBatchSaving ? 'Uploading batch...' : 'Upload batch' }}</ion-button>
        </article>
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
  previewUrl: string | null = null;
  imageBlob: Blob | null = null;
  imageFileName = 'wardrobe-item.jpg';
  message = '';
  isSaving = false;
  batchFiles: File[] = [];
  batchPreviewUrls: string[] = [];
  isBatchSaving = false;

  async capture(source: CameraSource.Camera | CameraSource.Photos): Promise<void> {
    this.message = '';
    if (!Capacitor.isNativePlatform()) {
      this.openBrowserFilePicker(source);
      return;
    }

    try {
      const photo = await Camera.getPhoto({ source, resultType: CameraResultType.DataUrl, quality: 90 });
      if (!photo.dataUrl) {
        return;
      }

      this.setPreviewUrl(photo.dataUrl);
      this.imageBlob = this.dataUrlToBlob(photo.dataUrl);
      this.imageFileName = `wardrobe-item.${photo.format || 'jpg'}`;
    } catch {
      this.message = source === CameraSource.Camera ? 'Camera was not available.' : 'Could not open photo library.';
    }
  }

  async handleFileSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    this.setPreviewUrl(URL.createObjectURL(file));
    this.imageBlob = file;
    this.imageFileName = file.name || 'wardrobe-item.jpg';
  }

  clearSelection(): void {
    this.setPreviewUrl(null);
    this.imageBlob = null;
    this.imageFileName = 'wardrobe-item.jpg';
    this.message = '';
  }

  async handleBatchSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) {
      return;
    }

    this.clearBatchSelection();
    this.batchFiles = files;
    this.batchPreviewUrls = files.map((file) => URL.createObjectURL(file));
  }

  async upload(fileName = this.imageFileName): Promise<void> {
    if (!this.imageBlob) return;

    if (!await ensureAiConsent(
      'Wardrobe AI uses OpenAI to classify wardrobe photos and generate cleaned display images. Do you want to continue with AI processing for this device?'))
    {
      this.message = 'OpenAI consent is required before you can upload wardrobe photos.';
      return;
    }

    this.isSaving = true;
    this.message = '';
    try {
      await this.api.createItem(this.imageBlob, fileName);
      await this.router.navigateByUrl('/tabs/wardrobe');
    } catch (error) {
      this.message = readMessage(error, 'Could not upload item. Try again.');
    } finally {
      this.isSaving = false;
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
      return;
    }

    this.isBatchSaving = true;
    this.message = '';
    try {
      const result = await this.api.createItems(this.batchFiles);
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
    } finally {
      this.isBatchSaving = false;
    }
  }

  removeBatchFile(index: number): void {
    if (this.isBatchSaving) {
      return;
    }

    const nextFiles = this.batchFiles.filter((_, currentIndex) => currentIndex !== index);
    this.clearBatchSelection();
    this.batchFiles = nextFiles;
    this.batchPreviewUrls = nextFiles.map((file) => URL.createObjectURL(file));
  }

  openBatchPicker(): void {
    if (this.isBatchSaving) {
      return;
    }

    this.batchInput?.nativeElement.click();
  }

  clearBatchSelection(): void {
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
          <button type="button" class="nav-button" aria-label="Edit item" (click)="editing = true">
            <ion-icon name="create-outline"></ion-icon>
          </button>
        </header>
        <div class="product-stage">
          <img class="product-image" [src]="item.image.displayUrl" [alt]="item.name">
        </div>
        <ion-button class="taupe-button" expand="block" (click)="markWorn()" *ngIf="!editing" [disabled]="isMarkingWorn">{{ isMarkingWorn ? 'Marking worn...' : 'Mark worn' }}</ion-button>
        <div class="detail-chips">
          <span class="detail-chip" *ngFor="let tag of visibleTags">{{ tag }}</span>
        </div>
        <ion-button class="taupe-button" expand="block" (click)="editing = true" *ngIf="!editing">Edit details</ion-button>
        <a class="text-link" *ngIf="item.image.originalUrl" [href]="item.image.originalUrl" target="_blank">View original</a>
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
          <ion-button class="primary-button" expand="block" type="submit" [disabled]="isSaving">{{ isSaving ? 'Saving...' : 'Save details' }}</ion-button>
          <ion-button class="secondary-button" fill="outline" expand="block" type="button" (click)="deleteItem()">Archive item</ion-button>
          <ion-button class="secondary-button" fill="clear" expand="block" type="button" (click)="cancelEdit()">Cancel</ion-button>
          <p class="muted" *ngIf="message">{{ message }}</p>
        </form>
      </section>
    </ion-content>
  `
})
export class ItemDetailPage {
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
  editing = false;

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

  private async loadItem(): Promise<void> {
    this.isLoading = true;
    this.message = '';
    this.item = null;
    this.editing = false;
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
    } catch (error) {
      this.message = readMessage(error, 'Could not load item.');
    } finally {
      this.isLoading = false;
    }
  }

  async markWorn(): Promise<void> {
    if (!this.item) return;
    this.isMarkingWorn = true;
    this.message = '';
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
      this.editing = false;
    } catch (error) {
      this.message = readMessage(error, 'Could not save details.');
    } finally {
      this.isSaving = false;
    }
  }

  async deleteItem(): Promise<void> {
    if (!this.item) return;
    try {
      await this.api.deleteItem(this.item.id);
      await this.router.navigateByUrl('/tabs/wardrobe');
    } catch (error) {
      this.message = readMessage(error, 'Could not archive item.');
    }
  }

  cancelEdit(): void {
    if (this.item) {
      this.form = { ...this.item, secondaryColourIds: this.item.secondaryColourIds.slice() };
    }
    this.message = '';
    this.editing = false;
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
          <ion-button class="primary-button" expand="block" (click)="search()" [disabled]="isBusy || !query.trim()">{{ isBusy ? 'Building...' : 'Build outfits' }}</ion-button>
          <p class="muted consent-note">Wardrobe AI sends your outfit request and wardrobe item details to OpenAI to generate outfit suggestions.</p>
        </article>
        <article class="panel form-stack manual-builder">
          <div class="panel-heading">
            <h2 class="section-title">Manual builder</h2>
            <button type="button" class="icon-button" aria-label="Clear selected manual items" (click)="clearManualSelection()" [disabled]="!manualItemIds.length || isBusy">
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </div>
          <label>
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
          <ion-button class="primary-button" expand="block" (click)="saveManual()" [disabled]="isBusy || !manualCanSave">{{ isBusy ? 'Saving...' : 'Save manual outfit' }}</ion-button>
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
            <ion-button class="primary-button small-action" (click)="save(outfit)">Save outfit</ion-button>
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
  isBusy = false;

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

    this.isBusy = true;
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
      this.isBusy = false;
    }
  }

  async saveManual(): Promise<void> {
    if (!this.manualCanSave) {
      this.message = this.manualHint || 'Add more clothing items to build complete outfits.';
      return;
    }

    this.isBusy = true;
    this.message = '';
    try {
      await this.api.saveOutfit(this.manualName.trim() || 'Manual outfit', null, 'Built manually from selected wardrobe items.', this.manualItemIds);
      this.message = 'Outfit saved.';
    } catch (error) {
      this.message = readMessage(error, 'Could not save outfit.');
    } finally {
      this.isBusy = false;
    }
  }

  async save(outfit: GeneratedOutfitDto): Promise<void> {
    this.message = '';
    try {
      await this.api.saveOutfit(outfit.title, this.query, outfit.explanation, outfit.itemIds, outfit.imageUrl);
      this.message = 'Outfit saved.';
    } catch (error) {
      this.message = readMessage(error, 'Could not save outfit.');
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

    if (!selected.some((item) => item.categoryId === 'footwear')) {
      return 'Add shoes to complete the outfit.';
    }

    return 'Select a top and bottom, a dress, or one piece with shoes.';
  }

  private selectedManualItems(): WardrobeItemDto[] {
    return this.manualItemIds
      .map((id) => this.items.find((item) => item.id === id))
      .filter((item): item is WardrobeItemDto => !!item);
  }

  private isValidManualOutfit(items: WardrobeItemDto[]): boolean {
    const count = (predicate: (item: WardrobeItemDto) => boolean): number => items.filter(predicate).length;
    const tops = count((item) => item.categoryId === 'tops' || item.categoryId === 'knitwear');
    const bottoms = count((item) => item.categoryId === 'bottoms');
    const dresses = count((item) => item.categoryId === 'dresses');
    const onePieces = count((item) => item.categoryId === 'one_pieces');
    const footwear = count((item) => item.categoryId === 'footwear');
    const outerwear = count((item) => item.categoryId === 'outerwear');
    const bags = count((item) => item.categoryId === 'bags');
    const supportedItems = tops + bottoms + dresses + onePieces + footwear + outerwear + bags + count((item) => item.categoryId === 'accessories');

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
            <div class="outfit-item-list">
              <span *ngFor="let item of outfit.items">{{ item.name }}</span>
            </div>
          </div>
          <div class="outfit-actions">
            <ion-button class="secondary-button compact-button" fill="outline" (click)="open(outfit)">Open</ion-button>
            <ion-button class="secondary-button compact-button" fill="outline" (click)="markWorn(outfit)">Mark worn</ion-button>
            <ion-button class="quiet-button compact-button" fill="clear" (click)="remove(outfit)">Delete</ion-button>
          </div>
        </article>
        <article class="panel outfit-detail-panel" *ngIf="selectedOutfit">
          <div class="panel-heading">
            <h2 class="section-title">{{ selectedOutfit.name }}</h2>
            <button type="button" class="icon-button" aria-label="Close outfit details" (click)="close()">
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </div>
          <img class="outfit-detail-image" *ngIf="selectedOutfit.imageUrl" [src]="selectedOutfit.imageUrl" [alt]="selectedOutfit.name">
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
        <article class="panel" *ngIf="!isLoading && !message && !outfits.length">
          <h2 class="plain-title">No saved outfits</h2>
          <p class="muted">Build an outfit and save the ones worth repeating.</p>
        </article>
      </section>
    </ion-content>
  `
})
export class OutfitsPage {
  private readonly api = inject(WardrobeApiService);
  outfits: OutfitDto[] = [];
  selectedOutfit: OutfitDto | null = null;
  isLoading = true;
  message = '';

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.isLoading = true;
    this.message = '';
    try {
      this.outfits = await this.api.getOutfits();
      if (this.selectedOutfit) {
        this.selectedOutfit = this.outfits.find((outfit) => outfit.id === this.selectedOutfit?.id) ?? null;
      }
    } catch (error) {
      this.message = readMessage(error, 'Could not load outfits.');
      this.outfits = [];
    } finally {
      this.isLoading = false;
    }
  }

  open(outfit: OutfitDto): void {
    this.selectedOutfit = outfit;
  }

  close(): void {
    this.selectedOutfit = null;
  }

  async markWorn(outfit: OutfitDto): Promise<void> {
    try {
      await this.api.markWorn(outfit.id);
      this.message = 'Marked as worn.';
    } catch (error) {
      this.message = readMessage(error, 'Could not mark outfit as worn.');
    }
  }

  async remove(outfit: OutfitDto): Promise<void> {
    try {
      await this.api.deleteOutfit(outfit.id);
      await this.load();
    } catch (error) {
      this.message = readMessage(error, 'Could not delete outfit.');
    }
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
        <article class="panel settings-card">
          <h1 class="plain-title">{{ auth.session?.user?.displayName || 'Wardrobe AI' }}</h1>
          <p class="muted">{{ auth.session?.user?.email }}</p>
        </article>
        <article class="panel settings-card">
          <h2 class="section-title">Device session</h2>
          <p class="muted">This device stores your Wardrobe AI session in local app preferences until you sign out or delete your account.</p>
          <p class="muted" *ngIf="sessionExpiresAtLabel">Current session expires {{ sessionExpiresAtLabel }}.</p>
          <ion-button class="secondary-button" fill="outline" (click)="logout()" [disabled]="isBusy">{{ isBusy ? 'Working...' : 'Sign out' }}</ion-button>
        </article>
        <article class="panel settings-card">
          <h2 class="section-title">AI processing</h2>
          <p class="muted">{{ aiConsentAccepted ? 'This device is allowed to send wardrobe photos and outfit requests to OpenAI.' : 'This device has not granted OpenAI processing consent yet.' }}</p>
          <p class="muted">{{ aiDisclosure }}</p>
          <ion-button class="secondary-button" fill="outline" (click)="resetAiConsent()" [disabled]="isBusy || !aiConsentAccepted">Require consent again</ion-button>
        </article>
        <article class="panel settings-card">
          <h2 class="section-title">Legal and support</h2>
          <a class="text-link" [href]="privacyPolicyUrl" target="_blank" rel="noreferrer">Privacy policy</a>
          <a class="text-link" [href]="termsUrl" target="_blank" rel="noreferrer">Terms of use</a>
          <a class="text-link" [href]="supportUrl" target="_blank" rel="noreferrer">Support</a>
        </article>
        <article class="panel settings-card danger-panel">
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
  private readonly router = inject(Router);
  readonly privacyPolicyUrl = PRIVACY_POLICY_URL;
  readonly termsUrl = TERMS_OF_USE_URL;
  readonly supportUrl = SUPPORT_URL;
  readonly aiDisclosure = AI_DISCLOSURE_TEXT;
  aiConsentAccepted = false;
  isBusy = false;
  message = '';

  async ionViewWillEnter(): Promise<void> {
    this.aiConsentAccepted = await hasAiConsent();
    this.message = '';
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

const AI_CONSENT_KEY = 'wardrobe-ai-openai-consent';
const PRIVACY_POLICY_URL = 'https://wardrobe.ai/privacy';
const TERMS_OF_USE_URL = 'https://wardrobe.ai/terms';
const SUPPORT_URL = 'mailto:support@wardrobe.ai';
const AI_DISCLOSURE_TEXT = 'Wardrobe AI uses OpenAI to classify wardrobe photos, generate cleaned display images, and suggest outfits from your saved wardrobe. Avoid uploading photos or prompts that you do not want processed by that provider.';

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
