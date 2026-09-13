import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Capacitor } from '@capacitor/core';
import { CameraWeb } from '@capacitor/camera/dist/esm/web';
import { Preferences } from '@capacitor/preferences';
import { IonicModule } from '@ionic/angular';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { WardrobeItemDto } from '../../models';
import { emptyItemForm } from '../page-helpers';
import { AddItemPage } from './add-item.page';

describe('Photo upload recovery', () => {
  let page: AddItemPage;
  let api: jasmine.SpyObj<WardrobeApiService>;
  let navigate: jasmine.Spy;
  const savedItem: WardrobeItemDto = {
    ...emptyItemForm(), id: 'shirt-1', name: 'Shirt', isArchived: false, isDeleted: false,
    wearCount: 0, lastWornAt: null, imageGenerationStatus: 'queued', createdAt: '', updatedAt: '',
    image: { originalUrl: '/original.jpg', displayUrl: '/original.jpg', canonicalUrl: null, thumbnailUrl: null }
  };

  async function photo(name = 'photo.png', width = 800, height = 800): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    return new File([blob], name, { type: 'image/png' });
  }

  function select(files: File[]): Promise<void> {
    return page.handlePhotoSelection({ target: { files, value: 'selected' } } as unknown as Event);
  }

  beforeEach(async () => {
    await Preferences.set({ key: 'wardrobe-ai-gemini-consent', value: 'accepted' });
    api = jasmine.createSpyObj('WardrobeApiService', ['createItem', 'createItems']);
    api.createItem.and.resolveTo({ ...savedItem, items: [savedItem] });
    TestBed.configureTestingModule({
      declarations: [AddItemPage], imports: [CommonModule, IonicModule.forRoot({ animated: false }), RouterTestingModule],
      providers: [AddItemPage, { provide: WardrobeApiService, useValue: api }]
    });
    page = TestBed.inject(AddItemPage);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
  });

  afterEach(async () => {
    page.ngOnDestroy();
    await Preferences.remove({ key: 'wardrobe-ai-gemini-consent' });
  });

  it('keeps selected previews usable when leaving and returning to the tab', async () => {
    await select([await photo()]);
    const preview = page.batchPreviewUrls[0];
    const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
    page.ionViewWillLeave();
    await page.ionViewWillEnter();
    expect(page.batchFiles.length).toBe(1);
    expect(page.activePreviewUrl).toBe(preview);
    expect(revoke).not.toHaveBeenCalledWith(preview);
    expect((await fetch(preview)).ok).toBeTrue();
  });

  it('converts a browser-decodable photo with a non-API format to JPEG even below the size threshold', async () => {
    // Simulate a decoded HEIC selection; actual HEIC codec availability belongs to device verification.
    const source = await photo();
    await select([new File([source], 'photo.heic', { type: 'image/heic' })]);
    expect(page.uploadError).toBeFalse();
    expect(page.batchFiles[0].file.type).toBe('image/jpeg');
    expect(page.batchFiles[0].name).toBe('photo.jpeg');
    expect(page.batchFiles[0].originalBytes).toBeLessThan(1.5 * 1024 * 1024);
  });

  it('resizes large pixel dimensions even when the file is small and flattens transparency onto white', async () => {
    await select([await photo('wide.png', 3000, 1800)]);
    const prepared = page.batchFiles[0].file;
    expect(prepared.type).toBe('image/jpeg');
    const bitmap = await createImageBitmap(prepared);
    expect(bitmap.width).toBe(2200);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([255, 255, 255, 255]);
    bitmap.close();
  });

  it('retains valid photos when another selection is corrupt', async () => {
    await select([await photo(), new File(['invalid'], 'broken.jpg', { type: 'image/jpeg' })]);
    expect(page.batchFiles.length).toBe(1);
    expect(page.message).toContain('broken.jpg');
    expect(page.isPreparing).toBeFalse();
    expect(page.uploadError).toBeTrue();
  });

  it('does not add photos from a selection that finishes after the page is destroyed', async () => {
    const selected = select([await photo()]);
    page.ngOnDestroy();
    await selected;
    expect(page.batchFiles).toEqual([]);
    expect(page.batchPreviewUrls).toEqual([]);
  });

  it('treats cancelling the native photo picker as cancellation without opening another picker', async () => {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
    const picker = spyOn(CameraWeb.prototype, 'pickImages').and.rejectWith(new Error('User cancelled photos app'));
    const single = spyOn(CameraWeb.prototype, 'getPhoto').and.rejectWith(new Error('Unexpected fallback'));
    await page.pickFromPhotoLibrary();
    expect(picker).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
    expect(page.uploadError).toBeFalse();
    expect(page.isPicking).toBeFalse();
  });

  it('prevents another upload while the first request is pending', async () => {
    await select([await photo()]);
    let finish!: (value: WardrobeItemDto) => void;
    api.createItem.and.returnValue(new Promise(resolve => finish = resolve));
    const upload = page.uploadSelectedPhotos();
    await new Promise(resolve => setTimeout(resolve, 0));
    await page.uploadSelectedPhotos();
    expect(api.createItem).toHaveBeenCalledTimes(1);
    finish(savedItem);
    await upload;
    expect(page.batchFiles).toEqual([]);
  });

  it('clears acknowledged photos even when navigation fails', async () => {
    await select([await photo()]);
    navigate.and.rejectWith(new Error('Navigation failed'));
    await page.uploadSelectedPhotos();
    expect(page.batchFiles).toEqual([]);
    expect(page.uploadError).toBeFalse();
    expect(page.statusMessage).toContain('1 garment added');
    await page.uploadSelectedPhotos();
    expect(api.createItem).toHaveBeenCalledTimes(1);
  });

  it('finishes a background upload without navigating away from the user’s current tab', async () => {
    await select([await photo()]);
    page.ionViewWillLeave();
    await page.uploadSelectedPhotos();
    expect(page.batchFiles).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    await page.ionViewWillEnter();
    expect(page.statusMessage).toContain('1 garment added');
  });

  it('retries only the failed photo after a partial batch success', async () => {
    await select([await photo('good.png'), await photo('retry.png')]);
    api.createItems.and.resolveTo({ succeededCount: 1, failedCount: 1, results: [
      { fileName: 'good.png', success: true, item: savedItem, error: null },
      { fileName: 'retry.png', success: false, item: null, error: 'The photo is too dark.' }
    ] });
    await page.uploadSelectedPhotos();
    expect(page.batchFiles.map(file => file.name)).toEqual(['retry.png']);
    expect(page.message).toContain('1 garment added');
    expect(page.message).toContain('too dark');
    await page.uploadSelectedPhotos();
    expect(api.createItem).toHaveBeenCalledOnceWith(jasmine.any(File), 'retry.png');
    expect(page.batchFiles).toEqual([]);
  });

  it('keeps the selection and explains uncertainty when the upload response is lost', async () => {
    await select([await photo()]);
    api.createItem.and.rejectWith({ status: 0 });
    await page.uploadSelectedPhotos();
    expect(page.batchFiles.length).toBe(1);
    expect(page.message).toContain('may already be saved');
    expect(page.isScanning).toBeFalse();
    expect(api.createItem).toHaveBeenCalledTimes(1);
  });

  it('shows preparation progress before the first preview exists', async () => {
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(AddItemPage);
    fixture.componentInstance.isPreparing = true;
    fixture.componentInstance.statusMessage = 'Preparing photo 1 of 2...';
    fixture.detectChanges();
    const status = fixture.nativeElement.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toContain('Preparing photo 1 of 2');
    expect(status.querySelector('ion-spinner')).not.toBeNull();
    fixture.destroy();
  });
});
