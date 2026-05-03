import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
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
      <ion-router-outlet></ion-router-outlet>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="wardrobe" routerLink="/tabs/wardrobe"><ion-icon name="shirt-outline"></ion-icon><ion-label>Wardrobe</ion-label></ion-tab-button>
        <ion-tab-button tab="add" routerLink="/tabs/add"><ion-icon name="add-circle-outline"></ion-icon><ion-label>Add</ion-label></ion-tab-button>
        <ion-tab-button tab="outfits" routerLink="/tabs/outfits"><ion-icon name="albums-outline"></ion-icon><ion-label>Outfits</ion-label></ion-tab-button>
        <ion-tab-button tab="builder" routerLink="/tabs/builder"><ion-icon name="sparkles-outline"></ion-icon><ion-label>Builder</ion-label></ion-tab-button>
        <ion-tab-button tab="settings" routerLink="/tabs/settings"><ion-icon name="settings-outline"></ion-icon><ion-label>Settings</ion-label></ion-tab-button>
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
          <button type="button" class="filter-button" aria-label="Clear wardrobe filters" (click)="clearFilters()" [disabled]="!categoryId && !search.trim()">
            <ion-icon name="options-outline"></ion-icon>
          </button>
        </div>
        <div class="chip-row">
          <button type="button" class="chip" [class.active]="!categoryId" (click)="setCategory(null)">All</button>
          <button type="button" class="chip" *ngFor="let category of lookups?.categories || []" [class.active]="categoryId === category.id" (click)="setCategory(category.id)">{{ category.label }}</button>
        </div>
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
            <h2 class="plain-title">No items yet</h2>
            <p class="muted">Add one item from the camera and it will appear here immediately.</p>
          </article>
        </ng-template>
      </section>
      <ion-fab vertical="bottom" horizontal="end" slot="fixed">
        <ion-fab-button class="fab-camera" routerLink="/tabs/add"><ion-icon name="camera-outline"></ion-icon></ion-fab-button>
      </ion-fab>
    </ion-content>
  `
})
export class WardrobePage implements OnInit {
  private readonly api = inject(WardrobeApiService);
  items: WardrobeItemDto[] = [];
  lookups: WardrobeLookupsDto | null = null;
  categoryId: string | null = null;
  search = '';
  isLoading = true;
  message = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.isLoading = true;
    this.message = '';
    try {
      this.lookups ??= await this.api.getLookups();
      const params: Record<string, string> = {};
      if (this.categoryId) params['categoryId'] = this.categoryId;
      if (this.search.trim()) params['search'] = this.search.trim();
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
    await this.load();
  }

  async clearFilters(): Promise<void> {
    this.categoryId = null;
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
        <div class="capture-stage">
          <img *ngIf="previewUrl" [src]="previewUrl" alt="Selected wardrobe item">
          <div class="capture-placeholder" *ngIf="!previewUrl">
            <ion-icon name="scan-outline"></ion-icon>
            <p>Place one item flat on a plain surface.</p>
          </div>
        </div>
        <article class="capture-dock">
          <div class="camera-control-row">
            <button type="button" class="round-control" disabled aria-label="Flash disabled">
              <ion-icon name="flash-outline"></ion-icon>
            </button>
            <button type="button" class="shutter-button" (click)="capture(CameraSource.Camera)" [disabled]="isSaving" aria-label="Take photo"></button>
            <button type="button" class="round-control" (click)="capture(CameraSource.Photos)" [disabled]="isSaving" aria-label="Choose from library">
              <ion-icon name="images-outline"></ion-icon>
            </button>
          </div>
          <ion-button class="primary-button olive-button" expand="block" (click)="capture(CameraSource.Camera)" [disabled]="isSaving">{{ isSaving ? 'Saving item...' : 'Take photo' }}</ion-button>
          <ion-button class="light-button" expand="block" (click)="capture(CameraSource.Photos)" [disabled]="isSaving">Choose from library</ion-button>
          <ion-button class="secondary-button retry-button" fill="outline" expand="block" *ngIf="imageBlob && message && !isSaving" (click)="upload()">Try again</ion-button>
          <p>One item, clearly visible.</p>
          <p class="muted" *ngIf="message">{{ message }}</p>
        </article>
      </section>
    </ion-content>
  `
})
export class AddItemPage {
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  readonly CameraSource = CameraSource;
  previewUrl: string | null = null;
  imageBlob: Blob | null = null;
  message = '';
  isSaving = false;

  async capture(source: CameraSource.Camera | CameraSource.Photos): Promise<void> {
    this.message = '';
    try {
      const photo = await Camera.getPhoto({ source, resultType: CameraResultType.Uri, quality: 90 });
      if (!photo.webPath) {
        return;
      }

      this.previewUrl = photo.webPath;
      this.imageBlob = await (await fetch(photo.webPath)).blob();
      await this.upload();
    } catch {
      this.message = source === CameraSource.Camera ? 'Camera was not available.' : 'Could not open photo library.';
    }
  }

  async upload(): Promise<void> {
    if (!this.imageBlob) return;
    this.isSaving = true;
    this.message = '';
    try {
      await this.api.createItem(this.imageBlob, 'wardrobe-item.jpg');
      await this.router.navigateByUrl('/tabs/wardrobe');
    } catch (error) {
      this.message = readMessage(error, 'Could not upload item. Try again.');
    } finally {
      this.isSaving = false;
    }
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
export class ItemDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  item: WardrobeItemDto | null = null;
  lookups: WardrobeLookupsDto | null = null;
  form: UpdateWardrobeItemRequest = emptyItemForm();
  message = '';
  isLoading = true;
  isSaving = false;
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

  async ngOnInit(): Promise<void> {
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
        </article>
        <h2 class="section-title" *ngIf="results.length">Outfit ideas</h2>
        <article class="outfit-card idea-card" *ngFor="let outfit of results">
          <div class="outfit-images">
            <img *ngFor="let id of outfit.itemIds" [src]="imageFor(id)" [alt]="nameFor(id)">
          </div>
          <div class="outfit-copy">
            <h3>{{ outfit.title }}</h3>
            <p class="muted">{{ outfit.explanation }}</p>
            <ion-button class="primary-button small-action" (click)="save(outfit)">Save outfit</ion-button>
          </div>
        </article>
        <p class="muted" *ngIf="message">{{ message }}</p>
      </section>
    </ion-content>
  `
})
export class BuilderPage implements OnInit {
  private readonly api = inject(WardrobeApiService);
  query = 'Smart casual dinner using my black jeans, no heels';
  chips = ['Work', 'Dinner', 'Brunch', 'No heels', 'Smart casual'];
  items: WardrobeItemDto[] = [];
  results: GeneratedOutfitDto[] = [];
  requiredItemId: string | null = null;
  message = '';
  isBusy = false;

  async ngOnInit(): Promise<void> {
    try {
      this.items = await this.api.getItems();
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

  async search(): Promise<void> {
    this.isBusy = true;
    this.message = '';
    try {
      this.items = await this.api.getItems();
      this.results = await this.api.searchOutfits(this.query, this.requiredItemId);
      if (!this.results.length) {
        this.message = 'Could not build an outfit from the current wardrobe.';
      }
    } catch (error) {
      this.results = [];
      this.message = readMessage(error, 'Could not build an outfit from the current wardrobe.');
    } finally {
      this.isBusy = false;
    }
  }

  async save(outfit: GeneratedOutfitDto): Promise<void> {
    this.message = '';
    try {
      await this.api.saveOutfit(outfit.title, this.query, outfit.explanation, outfit.itemIds);
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
          <div class="outfit-images">
            <img *ngFor="let item of outfit.items" [src]="item.image.displayUrl" [alt]="item.name">
          </div>
          <div class="outfit-copy">
            <h3>{{ outfit.name }}</h3>
            <p class="muted">{{ outfit.explanation || 'Saved from your wardrobe.' }}</p>
          </div>
          <div class="outfit-actions">
            <ion-button class="secondary-button compact-button" fill="outline" (click)="markWorn(outfit)">Mark worn</ion-button>
            <ion-button class="quiet-button compact-button" fill="clear" (click)="remove(outfit)">Delete</ion-button>
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
export class OutfitsPage implements OnInit {
  private readonly api = inject(WardrobeApiService);
  outfits: OutfitDto[] = [];
  isLoading = true;
  message = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.isLoading = true;
    this.message = '';
    try {
      this.outfits = await this.api.getOutfits();
    } catch (error) {
      this.message = readMessage(error, 'Could not load outfits.');
      this.outfits = [];
    } finally {
      this.isLoading = false;
    }
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
          <ion-button class="secondary-button" fill="outline" (click)="logout()">Sign out</ion-button>
        </article>
      </section>
    </ion-content>
  `
})
export class SettingsPage {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
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

function readMessage(error: unknown, fallback: string): string {
  const candidate = error as { error?: ApiMessage };
  return candidate.error?.message ?? fallback;
}
