import { CommonModule } from '@angular/common';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { IonicModule } from '@ionic/angular';
import { DeviceImageCacheService } from '../../device-image-cache.service';
import { LazyImageDirective } from '../../lazy-image.directive';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { emptyItemForm } from '../page-helpers';
import { ItemDetailPage } from './item-detail.page';
import { ImageGenerationStreamUpdate, WardrobeItemDto, WardrobeLookupsDto } from '../../models';

describe('Item preview recovery', () => {
  let page: ItemDetailPage;
  let api: jasmine.SpyObj<WardrobeApiService>;
  let update: (updates: ImageGenerationStreamUpdate[]) => void;
  let fallback: () => void;
  const queued: WardrobeItemDto = {
    ...emptyItemForm(), id: 'piece-1', name: 'Linen shirt', isArchived: false, isDeleted: false,
    wearCount: 0, lastWornAt: null, imageGenerationStatus: 'queued', createdAt: '', updatedAt: '',
    image: { originalUrl: '/original.jpg', displayUrl: '/original.jpg', canonicalUrl: null, thumbnailUrl: null }
  };
  const ready: WardrobeItemDto = {
    ...queued, imageGenerationStatus: 'complete', image: { ...queued.image, displayUrl: '/ready.jpg' }
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('WardrobeApiService', ['getLookups', 'getItem', 'streamImageGenerationStatuses'], { isOnline: true });
    api.getLookups.and.resolveTo({ categories: [] } as unknown as WardrobeLookupsDto);
    api.getItem.and.resolveTo(queued);
    api.streamImageGenerationStatuses.and.callFake((_items, _outfits, onUpdate, onError) => {
      update = onUpdate;
      fallback = onError!;
      return { close: () => {} };
    });
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, IonicModule.forRoot({ animated: false })],
      providers: [ItemDetailPage, { provide: WardrobeApiService, useValue: api },
        { provide: DeviceImageCacheService, useValue: { resolve: async (url: string) => url } },
        { provide: ActivatedRoute, useValue: { snapshot: {
          paramMap: convertToParamMap({ id: queued.id }), queryParamMap: convertToParamMap({})
        } } }]
    });
    page = TestBed.inject(ItemDetailPage);
  });

  afterEach(() => page.ngOnDestroy());

  it('retries a failed final image fetch without overwriting the edit draft', fakeAsync(() => {
    void page.ionViewWillEnter();
    flushMicrotasks();
    expect(api.streamImageGenerationStatuses).toHaveBeenCalledTimes(1);
    page.isEditModalOpen = true;
    page.form.name = 'My edited shirt';
    api.getItem.and.rejectWith(new Error('Connection interrupted'));
    update([{ kind: 'item', id: queued.id, status: 'complete' }]);
    flushMicrotasks();
    expect(page.item?.image.displayUrl).toBe('/original.jpg');
    api.getItem.and.resolveTo(ready);
    tick(1800);
    flushMicrotasks();
    expect(page.item?.image.displayUrl).toBe('/ready.jpg');
    expect(page.form.name).toBe('My edited shirt');
    tick(3600);
    expect(api.getItem).toHaveBeenCalledTimes(3);
  }));

  it('ignores a final image response and stream fallback after the user leaves', fakeAsync(() => {
    void page.ionViewWillEnter();
    flushMicrotasks();
    let finish!: (item: WardrobeItemDto) => void;
    api.getItem.and.returnValue(new Promise(resolve => { finish = resolve; }));
    update([{ kind: 'item', id: queued.id, status: 'complete' }]);
    page.ionViewWillLeave();
    finish(ready);
    flushMicrotasks();
    fallback();
    tick(3600);
    expect(page.item?.image.displayUrl).toBe('/original.jpg');
    expect(api.getItem).toHaveBeenCalledTimes(2);
  }));
});

describe('Item detail presentation', () => {
  it('fits the full image and keeps the image switch outside the preview', async () => {
    await TestBed.configureTestingModule({
      declarations: [ItemDetailPage, LazyImageDirective],
      imports: [CommonModule, FormsModule, RouterTestingModule, IonicModule.forRoot({ animated: false })],
      providers: [
        { provide: WardrobeApiService, useValue: {} },
        { provide: DeviceImageCacheService, useValue: { resolve: (url: string) => Promise.resolve(url) } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(ItemDetailPage);
    const app = document.createElement('ion-app');
    document.body.appendChild(app);
    app.appendChild(fixture.nativeElement);
    const page = fixture.componentInstance;
    const imageUrl = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="600"/%3E';
    page.item = {
      ...emptyItemForm(), id: 'piece-1', name: 'Linen shirt',
      isArchived: false, isDeleted: false, wearCount: 2, lastWornAt: null,
      image: { originalUrl: imageUrl, displayUrl: imageUrl, canonicalUrl: null, thumbnailUrl: null },
      imageGenerationStatus: 'complete', createdAt: '', updatedAt: ''
    };
    page.isLoading = false;
    fixture.detectChanges();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    await customElements.whenDefined('ion-content');
    await root.querySelector<HTMLIonContentElement>('ion-content')!.componentOnReady();
    expect(root.isConnected).toBeTrue();
    const stage = root.querySelector<HTMLElement>('.detail-image-stage')!;
    const image = root.querySelector<HTMLImageElement>('.detail-image')!;
    const switcher = root.querySelector<HTMLIonSegmentElement>('.detail-image-controls')!;
    expect(getComputedStyle(image).objectFit).toBe('contain');
    expect(stage.getBoundingClientRect().height).toBeGreaterThanOrEqual(320);
    expect(image.getBoundingClientRect().height).toBeLessThanOrEqual(stage.getBoundingClientRect().height);
    expect(stage.contains(switcher)).toBeFalse();
    switcher.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'original' } }));
    fixture.detectChanges();
    expect(page.activeImageLayer).toBe('original');
    expect(root.querySelectorAll('.metric-card').length).toBe(3);
    expect(root.querySelector('.detail-action-bar')?.textContent).toContain('Mark Worn Today');
    fixture.destroy();
    app.remove();
  });
});
