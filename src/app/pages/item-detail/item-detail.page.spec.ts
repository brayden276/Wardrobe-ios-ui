import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { IonicModule } from '@ionic/angular';
import { DeviceImageCacheService } from '../../device-image-cache.service';
import { LazyImageDirective } from '../../lazy-image.directive';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { emptyItemForm } from '../page-helpers';
import { ItemDetailPage } from './item-detail.page';

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
