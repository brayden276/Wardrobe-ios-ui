import { CommonModule } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { IonicModule } from '@ionic/angular';
import { apiBaseUrl } from '../../api-url';
import { AuthService } from '../../auth.service';
import { DeviceImageCacheService } from '../../device-image-cache.service';
import { LazyImageDirective } from '../../lazy-image.directive';
import { OutfitDto } from '../../models';
import { OfflineDataService } from '../../offline-data.service';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { OutfitsPage } from './outfits.page';

describe('Saved outfit workflows', () => {
  let page: OutfitsPage;
  let http: HttpTestingController;
  let auth: { token: string; session: { user: { id: string } } | null };
  const favouriteKey = 'wb_favorite_outfits_user-1';
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const baseUrl = apiBaseUrl();
  const outfit: OutfitDto = {
    id: 'outfit-1', name: 'Original look', prompt: 'Work', explanation: 'Original notes',
    imageUrl: null, thumbnailUrl: null, imageGenerationStatus: 'complete', isDeleted: false,
    items: [], wearCount: 3, lastWornAt: '2026-09-01T09:00:00Z',
    createdAt: '2026-08-01T09:00:00Z', updatedAt: '2026-08-01T09:00:00Z'
  };

  beforeEach(() => {
    auth = { token: 'access-token', session: null };
    localStorage.removeItem(favouriteKey);
    localStorage.removeItem(`${favouriteKey}_synced`);
    TestBed.configureTestingModule({
      declarations: [OutfitsPage, LazyImageDirective],
      imports: [CommonModule, FormsModule, IonicModule.forRoot({ animated: false }), RouterTestingModule],
      providers: [
        OutfitsPage, provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: OfflineDataService, useValue: { write: () => Promise.resolve(), read: () => Promise.resolve(null) } },
        { provide: DeviceImageCacheService, useValue: { resolve: (url: string | null) => Promise.resolve(url) } }
      ]
    });
    page = TestBed.inject(OutfitsPage);
    http = TestBed.inject(HttpTestingController);
    page.outfits = [outfit];
    page.isLoading = false;
    page.updateVisibleOutfits();
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem(favouriteKey);
    localStorage.removeItem(`${favouriteKey}_synced`);
  });

  it('imports existing device favourites once, merges remote favourites and honours later remote removals', async () => {
    auth.session = { user: { id: 'user-1' } };
    localStorage.setItem(favouriteKey, JSON.stringify([outfit.id]));
    const load = page.ionViewWillEnter();
    http.expectOne(`${baseUrl}/api/lookups/wardrobe`).flush({ categories: [] });
    http.expectOne(`${baseUrl}/api/outfits`).flush({ outfits: [outfit, { ...outfit, id: 'outfit-2' }] });
    await settle();
    http.expectOne(`${baseUrl}/api/wardrobe/favourites`).flush({ favourites: [{ targetType: 'outfit', targetId: 'outfit-2' }] });
    await settle();
    const imported = http.expectOne(`${baseUrl}/api/wardrobe/favourites/outfit/${outfit.id}`);
    expect(imported.request.method).toBe('PUT');
    expect(imported.request.body).toEqual({ isFavourite: true });
    imported.flush(null);
    await load;
    expect([...page.favoriteOutfitIds].sort()).toEqual(['outfit-1', 'outfit-2']);
    expect(localStorage.getItem(`${favouriteKey}_synced`)).toBe('true');

    const reload = page.syncFavorites();
    http.expectOne(`${baseUrl}/api/wardrobe/favourites`).flush({ favourites: [] });
    await reload;
    http.expectNone(`${baseUrl}/api/wardrobe/favourites/outfit/${outfit.id}`);
    expect(page.favoriteOutfitIds.size).toBe(0);
  });

  it('keeps legacy favourites and retries migration after a failed upload', async () => {
    auth.session = { user: { id: 'user-1' } };
    page.favoriteOutfitIds.add(outfit.id);
    localStorage.setItem(favouriteKey, JSON.stringify([outfit.id]));
    const sync = page.syncFavorites();
    http.expectOne(`${baseUrl}/api/wardrobe/favourites`).flush({ favourites: [] });
    await settle();
    http.expectOne(`${baseUrl}/api/wardrobe/favourites/outfit/${outfit.id}`).flush({}, { status: 500, statusText: 'Server error' });
    await sync;
    expect(page.isFavorite(outfit.id)).toBeTrue();
    expect(localStorage.getItem(`${favouriteKey}_synced`)).toBeNull();
    expect(page.favoriteMessage).not.toBe('');

    const retry = page.syncFavorites();
    http.expectOne(`${baseUrl}/api/wardrobe/favourites`).flush({ favourites: [] });
    await settle();
    http.expectOne(`${baseUrl}/api/wardrobe/favourites/outfit/${outfit.id}`).flush(null);
    await retry;
    expect(localStorage.getItem(`${favouriteKey}_synced`)).toBe('true');
  });

  it('persists heart changes, prevents duplicate requests and retains state on failure', async () => {
    auth.session = { user: { id: 'user-1' } };
    const add = page.toggleFavorite(outfit);
    await page.toggleFavorite(outfit);
    const request = http.expectOne(`${baseUrl}/api/wardrobe/favourites/outfit/${outfit.id}`);
    expect(page.isFavorite(outfit.id)).toBeFalse();
    request.flush(null);
    await add;
    expect(page.isFavorite(outfit.id)).toBeTrue();
    page.setOutfitFilter('favorites');
    expect(page.visibleOutfits.length).toBe(1);

    const failedRemoval = page.toggleFavorite(outfit);
    http.expectOne(`${baseUrl}/api/wardrobe/favourites/outfit/${outfit.id}`).flush({}, { status: 500, statusText: 'Server error' });
    await failedRemoval;
    expect(page.isFavorite(outfit.id)).toBeTrue();

    const remove = page.toggleFavorite(outfit);
    const deletion = http.expectOne(`${baseUrl}/api/wardrobe/favourites/outfit/${outfit.id}`);
    expect(deletion.request.body).toEqual({ isFavourite: false });
    deletion.flush(null);
    await remove;
    expect(page.visibleOutfits.length).toBe(0);
    expect(localStorage.getItem(favouriteKey)).toBe('[]');
  });

  it('keeps offline favourites readable and does not send changes', async () => {
    auth.session = { user: { id: 'user-1' } };
    page.favoriteOutfitIds.add(outfit.id);
    TestBed.inject(WardrobeApiService).setOnlineStatus(false);
    await page.syncFavorites();
    await page.toggleFavorite(outfit);
    expect(page.isFavorite(outfit.id)).toBeTrue();
    expect(page.canChangeFavorites).toBeFalse();
    expect(page.favoriteMessage).toContain('Connect');
  });

  it('does not import or apply favourites after the account changes', async () => {
    auth.session = { user: { id: 'user-1' } };
    page.favoriteOutfitIds.add(outfit.id);
    const sync = page.syncFavorites();
    auth.session = { user: { id: 'user-2' } };
    http.expectOne(`${baseUrl}/api/wardrobe/favourites`).flush({ favourites: [] });
    await sync;
    http.expectNone(`${baseUrl}/api/wardrobe/favourites/outfit/${outfit.id}`);
    expect(localStorage.getItem(`${favouriteKey}_synced`)).toBeNull();
  });

  it('saves name and notes through the authenticated API and updates the card, detail and cached list', async () => {
    const api = TestBed.inject(WardrobeApiService);
    const initialLoad = api.getOutfits();
    http.expectOne(`${baseUrl}/api/outfits`).flush({ outfits: [outfit] });
    await initialLoad;
    page.editOutfit(outfit);
    page.outfitForm = { name: '  Friday look  ', explanation: '  Dinner with friends  ' };

    const save = page.saveOutfit();
    const request = http.expectOne(`${baseUrl}/api/outfits/${outfit.id}`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-token');
    expect(request.request.body).toEqual({ name: 'Friday look', explanation: 'Dinner with friends' });
    request.flush({ outfit: { ...outfit, ...request.request.body } });
    await save;

    expect(page.selectedOutfit?.name).toBe('Friday look');
    expect(page.visibleOutfits[0].outfit.explanation).toBe('Dinner with friends');
    expect(page.selectedOutfit?.wearCount).toBe(3);
    expect(page.isEditingOutfit).toBeFalse();
    const reload = api.getOutfits();
    http.expectOne(`${baseUrl}/api/outfits`).flush({ outfits: [page.selectedOutfit] });
    expect((await reload)[0].name).toBe('Friday look');
  });

  it('allows notes to be cleared without changing garments or the generation prompt', async () => {
    page.editOutfit(outfit);
    page.outfitForm.explanation = '';
    const save = page.saveOutfit();
    const request = http.expectOne(`${baseUrl}/api/outfits/${outfit.id}`);
    expect(request.request.body).toEqual({ name: outfit.name, explanation: '' });
    request.flush({ outfit: { ...outfit, explanation: null } });
    await save;
    expect(page.selectedOutfit?.explanation).toBeNull();
    expect(page.selectedOutfit?.prompt).toBe(outfit.prompt);
  });

  it('rejects invalid fields before sending a request', async () => {
    page.editOutfit(outfit);
    for (const form of [
      { name: '  ', explanation: '' },
      { name: 'x'.repeat(257), explanation: '' },
      { name: 'Look', explanation: 'x'.repeat(2001) }
    ]) {
      page.outfitForm = form;
      await page.saveOutfit();
      expect(page.editMessage).toContain('1–256');
    }
    http.expectNone(`${baseUrl}/api/outfits/${outfit.id}`);
  });

  it('retains edits on failure and supports retry without closing or submitting twice', async () => {
    page.editOutfit(outfit);
    page.outfitForm.name = 'My edited look';
    const save = page.saveOutfit();
    await page.saveOutfit();
    page.close();
    page.cancelOutfitEdit();
    expect(page.isEditingOutfit).toBeTrue();
    http.expectOne(`${baseUrl}/api/outfits/${outfit.id}`).flush({ message: 'Try again' }, { status: 500, statusText: 'Server error' });
    await save;
    expect(page.outfitForm.name).toBe('My edited look');
    expect(page.selectedOutfit?.name).toBe(outfit.name);
    expect(page.editMessage).toBe('Try again');
    const retry = page.saveOutfit();
    http.expectOne(`${baseUrl}/api/outfits/${outfit.id}`).flush({ outfit: { ...outfit, name: 'My edited look' } });
    await retry;
    expect(page.selectedOutfit?.name).toBe('My edited look');
  });

  it('keeps the draft and explains that saving needs a connection when offline', async () => {
    TestBed.inject(WardrobeApiService).setOnlineStatus(false);
    page.editOutfit(outfit);
    page.outfitForm.name = 'Offline edit';
    await page.saveOutfit();
    expect(page.isEditingOutfit).toBeTrue();
    expect(page.outfitForm.name).toBe('Offline edit');
    expect(page.editMessage).toContain('connection');
  });

  it('discards a cancelled draft when the editor is reopened', () => {
    page.editOutfit(outfit);
    page.outfitForm.name = 'Unsaved';
    page.cancelOutfitEdit();
    page.editOutfit(outfit);
    expect(page.outfitForm.name).toBe(outfit.name);
    expect(page.outfits[0].name).toBe(outfit.name);
  });

  it('unlocks the editor and retains the draft when a save times out', fakeAsync(() => {
    page.editOutfit(outfit);
    page.outfitForm.name = 'My new look';
    void page.saveOutfit();
    const request = http.expectOne(`${baseUrl}/api/outfits/${outfit.id}`);
    tick(10_001);
    flushMicrotasks();
    expect(request.cancelled).toBeTrue();
    expect(page.isSavingOutfit).toBeFalse();
    expect(page.isEditingOutfit).toBeTrue();
    expect(page.outfitForm.name).toBe('My new look');
    expect(page.editMessage).not.toBe('');
    page.cancelOutfitEdit();
    expect(page.isEditingOutfit).toBeFalse();
  }));

  it('renders the outfit sheet editor and its save controls', async () => {
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(OutfitsPage);
    fixture.componentInstance.isLoading = false;
    fixture.componentInstance.outfits = [outfit];
    fixture.detectChanges();
    const modal: HTMLIonModalElement = fixture.nativeElement.querySelector('ion-modal');
    fixture.componentInstance.editOutfit(outfit);
    fixture.detectChanges();
    await modal.present();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(modal.querySelector('ion-input')?.label).toBe('Name');
    expect(modal.querySelector('ion-textarea')?.label).toBe('Notes');
    expect(modal.querySelector('button[type="submit"]')?.textContent).toContain('Save Changes');
    const cancel = modal.querySelector<HTMLButtonElement>('.sheet-modal-footer .text-btn')!;
    expect(getComputedStyle(cancel).minHeight).toBe('44px');
    expect(getComputedStyle(cancel).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(await modal.getCurrentBreakpoint()).toBe(1);
    const footer = modal.querySelector<HTMLElement>('.sheet-modal-footer')!;
    expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(modal.getBoundingClientRect().bottom + 1);

    fixture.componentInstance.cancelOutfitEdit();
    fixture.detectChanges();
    const favouriteButton = modal.querySelector<HTMLButtonElement>('.sheet-btn-secondary')!;
    favouriteButton.click();
    fixture.detectChanges();
    expect(favouriteButton.disabled).toBeTrue();
    expect(favouriteButton.getAttribute('aria-busy')).toBe('true');
    expect(favouriteButton.textContent).toContain('Saving...');
    http.expectOne(`${baseUrl}/api/wardrobe/favourites/outfit/${outfit.id}`).flush(null);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(favouriteButton.disabled).toBeFalse();
    expect(favouriteButton.textContent).toContain('Favorited');
    await modal.dismiss();
    fixture.destroy();
  });
});
