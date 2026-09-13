import { Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { ActionSheetController, AlertController } from '@ionic/angular';
import { WardrobeApiService } from '../../wardrobe-api.service';
import {
  IMAGE_COMPRESSION_MAX_SIDES,
  IMAGE_COMPRESSION_QUALITIES,
  IMAGE_COMPRESSION_TRIGGER_BYTES,
  IMAGE_MIN_SIDE,
  MAX_BATCH_UPLOAD_COUNT,
  MAX_UPLOAD_FILE_BYTES,
  MIME_IMAGE_OUTPUT_EXTENSION,
  ensureAiConsentWithAlert,
  hasAiConsent,
  lightImpact,
  noticeKind,
  NoticeKind,
  readMessage,
  successFeedback,
  warningFeedback
} from '../page-helpers';

type PreparedUploadFile = {
  file: File;
  name: string;
  originalBytes: number;
  preparedBytes: number;
};

@Component({
  selector: 'app-add-item',
  standalone: false,
  templateUrl: './add-item.page.html',
  styleUrls: ['./add-item.page.scss']
})
export class AddItemPage implements OnDestroy {
  private readonly api = inject(WardrobeApiService);
  private readonly router = inject(Router);
  private readonly actionSheet = inject(ActionSheetController);
  private readonly alertController = inject(AlertController);
  @ViewChild('cameraInput') private readonly cameraInput?: ElementRef<HTMLInputElement>;
  @ViewChild('batchInput') private readonly batchInput?: ElementRef<HTMLInputElement>;
  readonly maxBatchUploadCount = MAX_BATCH_UPLOAD_COUNT;
  message = '';
  statusMessage = '';
  isSaving = false;
  isPreparing = false;
  isPicking = false;
  private isViewActive = true;
  private destroyed = false;
  uploadError = false;
  hasAiConsent = false;
  batchFiles: PreparedUploadFile[] = [];
  batchPreviewUrls: string[] = [];
  isBatchSaving = false;

  async ionViewWillEnter(): Promise<void> {
    this.isViewActive = true;
    this.hasAiConsent = await hasAiConsent();
  }

  get uploadButtonLabel(): string {
    if (this.isSaving || this.isBatchSaving) {
      return 'Uploading...';
    }

    return this.batchFiles.length === 1 ? 'Upload photo' : 'Upload photos';
  }

  get messageKind(): NoticeKind {
    return noticeKind(this.message, this.uploadError);
  }

  get statusKind(): NoticeKind {
    return noticeKind(this.statusMessage);
  }

  activePreviewIndex = 0;

  get activePreviewUrl(): string {
    return this.batchPreviewUrls[this.activePreviewIndex] || this.batchPreviewUrls[0] || '';
  }

  get isScanning(): boolean {
    return this.isSaving || this.isBatchSaving || this.isPreparing || this.isPicking;
  }

  get scanningStatusText(): string {
    if (this.isPicking && !this.isPreparing) return 'Opening your photos...';
    if (this.statusMessage) return this.statusMessage;
    if (this.isPreparing) {
      return 'Optimising photo for analysis...';
    }
    if (this.isSaving || this.isBatchSaving) {
      return '✨ Gemini analyzing fabric, cut & color...';
    }
    return 'Scanning garment...';
  }

  selectActivePreview(index: number): void {
    this.activePreviewIndex = index;
    void lightImpact();
  }

  dismissError(): void {
    this.uploadError = false;
    this.message = '';
    void lightImpact();
  }

  removeActiveFile(): void {
    this.removeBatchFile(this.activePreviewIndex);
    if (this.activePreviewIndex >= this.batchFiles.length) {
      this.activePreviewIndex = Math.max(0, this.batchFiles.length - 1);
    }
  }

  captureCamera(): void {
    void this.capture(CameraSource.Camera);
  }

  openPhotoLibrary(): void {
    void this.pickFromPhotoLibrary();
  }

  async pickFromPhotoLibrary(): Promise<void> {
    if (this.isScanning) return;
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;

    if (!Capacitor.isNativePlatform()) {
      this.openBatchPicker();
      return;
    }

    try {
      const remainingCount = this.maxBatchUploadCount - this.batchFiles.length;
      if (remainingCount <= 0) {
        this.message = `You can upload up to ${this.maxBatchUploadCount} photos at once.`;
        this.uploadError = true;
        return;
      }

      this.isPicking = true;
      const result = await Camera.pickImages({ quality: 90, limit: remainingCount });
      if (!result?.photos?.length) {
        return;
      }

      const files: File[] = [];
      for (const [index, photo] of result.photos.entries()) {
        if (photo.webPath) {
          const blob = await this.readSelectedPhoto(photo.webPath);
          const ext = photo.format || 'jpg';
          const fileName = `wardrobe-photo-${Date.now()}-${index}.${ext}`;
          files.push(new File([blob], fileName, { type: blob.type || `image/${ext === 'png' ? 'png' : 'jpeg'}` }));
        }
      }

      if (files.length) {
        await this.addSelectedFiles(files);
      }
    } catch (error) {
      if (!this.isPickerCancellation(error)) {
        this.message = 'Could not open the selected photos. Check photo permissions in Settings and try again.';
        this.uploadError = true;
      }
    } finally {
      this.isPicking = false;
    }
  }

  async openAddPhotoOptions(): Promise<void> {
    if (this.isSaving || this.isBatchSaving || this.isPreparing) {
      return;
    }

    const sheet = await this.actionSheet.create({
      header: 'Add photos',
      buttons: [
        {
          text: 'Take photo',
          icon: 'camera-outline',
          handler: () => {
            void this.capture(CameraSource.Camera);
          }
        },
        {
          text: 'Select photos',
          icon: 'images-outline',
          handler: () => {
            void this.pickFromPhotoLibrary();
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });
    await sheet.present();
  }

  async capture(source: CameraSource.Camera | CameraSource.Photos): Promise<void> {
    if (this.isScanning) return;
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
    if (!Capacitor.isNativePlatform()) {
      this.openBrowserFilePicker(source);
      return;
    }

    try {
      this.isPicking = true;
      const photo = await Camera.getPhoto({ source, resultType: CameraResultType.DataUrl, quality: 90 });
      if (!photo.dataUrl) {
        return;
      }

      const sourceBlob = this.dataUrlToBlob(photo.dataUrl);
      const fileName = `wardrobe-item.${photo.format || 'jpg'}`;
      const sourceImage = new File([sourceBlob], fileName, { type: sourceBlob.type || 'image/jpeg' });
      await this.addSelectedFiles([sourceImage]);
    } catch (error) {
      if (this.isPickerCancellation(error)) return;
      this.message = source === CameraSource.Camera ? 'Camera was not available.' : 'Could not open photo library.';
      this.uploadError = true;
    } finally {
      this.isPicking = false;
    }
  }

  async handleCameraFileSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    await this.addSelectedFiles([file]);
  }

  async handlePhotoSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) {
      return;
    }

    await this.addSelectedFiles(files);
  }

  ionViewWillLeave(): void {
    this.isViewActive = false;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.isViewActive = false;
    this.revokeBatchPreviewUrls();
  }

  private revokeBatchPreviewUrls(): void {
    for (const previewUrl of this.batchPreviewUrls) {
      if (previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    }
  }

  async uploadSelectedPhotos(): Promise<void> {
    if (this.isScanning || !this.batchFiles.length) {
      return;
    }

    this.isSaving = true;
    this.statusMessage = 'Checking photo-processing permission...';
    try {
      const consentGiven = await ensureAiConsentWithAlert(
        this.alertController,
        'Wardrobe AI uses Google Gemini to classify wardrobe photos and generate cleaned display images. Do you want to continue with AI processing for this device?'
      );
      if (!consentGiven) {
        this.message = 'Gemini consent is required before you can upload wardrobe photos.';
        this.uploadError = true;
        void warningFeedback();
        return;
      }

      this.hasAiConsent = true;
      this.isSaving = false;

      if (this.batchFiles.length === 1) {
        await this.uploadSinglePreparedPhoto(this.batchFiles[0]);
        return;
      }

      await this.uploadPreparedPhotos();
    } catch (error) {
      this.message = readMessage(error, 'Could not start photo processing. Please try again.');
      this.uploadError = true;
    } finally {
      this.isSaving = false;
      if (this.uploadError) this.statusMessage = '';
    }
  }

  removeBatchFile(index: number): void {
    if (this.isSaving || this.isBatchSaving || this.isPreparing) {
      return;
    }

    const previewUrl = this.batchPreviewUrls[index];
    if (previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }

    this.batchFiles = this.batchFiles.filter((_, currentIndex) => currentIndex !== index);
    this.batchPreviewUrls = this.batchPreviewUrls.filter((_, currentIndex) => currentIndex !== index);
    if (this.activePreviewIndex >= this.batchFiles.length) {
      this.activePreviewIndex = Math.max(0, this.batchFiles.length - 1);
    }
    void lightImpact();
  }

  openBatchPicker(): void {
    if (this.isSaving || this.isBatchSaving || this.isPreparing) {
      return;
    }

    this.batchInput?.nativeElement.click();
  }

  clearBatchSelection(): void {
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
    this.revokeBatchPreviewUrls();
    this.batchFiles = [];
    this.batchPreviewUrls = [];

    if (this.batchInput) {
      this.batchInput.nativeElement.value = '';
    }
    void lightImpact();
  }

  private openBrowserFilePicker(source: CameraSource.Camera | CameraSource.Photos): void {
    if (source !== CameraSource.Camera) {
      this.openBatchPicker();
      return;
    }

    if (!this.cameraInput) {
      this.message = 'Camera was not available.';
      return;
    }

    this.cameraInput.nativeElement.click();
  }

  private async addSelectedFiles(files: File[]): Promise<void> {
    if (this.isPreparing || this.isSaving || this.isBatchSaving || this.destroyed) return;
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
    this.isPreparing = true;

    try {
      const remainingCount = this.maxBatchUploadCount - this.batchFiles.length;
      if (remainingCount <= 0) {
        this.message = `You can upload up to ${this.maxBatchUploadCount} photos at once.`;
        this.uploadError = true;
        return;
      }

      if (files.length > remainingCount) {
        this.message = `You selected ${files.length} photos. Only ${remainingCount} more ${remainingCount === 1 ? 'was' : 'were'} kept.`;
      }

      const preparedFiles = await this.prepareBatchImages(files.slice(0, remainingCount));
      if (this.destroyed) return;
      if (!preparedFiles.length) {
        if (!this.message) {
          this.message = 'No valid images in selection.';
        }
        this.uploadError = true;
        return;
      }

      this.batchFiles = [...this.batchFiles, ...preparedFiles];
      this.batchPreviewUrls = [
        ...this.batchPreviewUrls,
        ...preparedFiles.map((entry) => URL.createObjectURL(entry.file))
      ];
      if (!this.message && !this.uploadError) {
        this.statusMessage = preparedFiles.length === 1 ? 'Photo is ready for upload.' : 'Photos are ready for upload.';
      }
      void lightImpact();
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Could not prepare images. Try again.';
      this.uploadError = true;
      void warningFeedback();
    } finally {
      this.isPreparing = false;
      if (this.uploadError || this.message) this.statusMessage = '';
    }
  }

  private async uploadSinglePreparedPhoto(photo: PreparedUploadFile): Promise<void> {
    if (this.isSaving || this.isBatchSaving || this.isPreparing) {
      return;
    }

    this.isSaving = true;
    this.message = '';
    this.statusMessage = 'Uploading and analysing your photo...';
    this.uploadError = false;

    try {
      const created = await this.api.createItem(photo.file, photo.name);
      const itemsCreated = created?.items?.length ? created.items : (created?.id ? [created] : []);
      if (!itemsCreated.length) throw new Error('Could not confirm the upload. Check your wardrobe before uploading this photo again.');
      await this.completeUpload(itemsCreated.length, itemsCreated.length === 1 ? itemsCreated[0].id : undefined);
    } catch (error) {
      this.message = this.uploadFailureMessage(error, 'Could not upload photo. Try again.');
      this.uploadError = true;
      void warningFeedback();
    } finally {
      this.isSaving = false;
      if (this.uploadError) this.statusMessage = '';
    }
  }

  private async uploadPreparedPhotos(): Promise<void> {
    if (this.isSaving || this.isBatchSaving || this.isPreparing || !this.batchFiles.length) {
      return;
    }

    this.isBatchSaving = true;
    this.message = '';
    this.statusMessage = `Uploading and analysing ${this.batchFiles.length} photos. This may take a few minutes...`;
    this.uploadError = false;
    try {
      const result = await this.api.createItems(this.batchFiles.map((entry) => entry.file));
      if (result.results.length !== this.batchFiles.length || result.results.some(entry =>
        entry.success && !(entry.items?.length || entry.item))) {
        throw new Error('Could not confirm every upload. Check your wardrobe before uploading these photos again.');
      }
      const failures = result.results.filter((entry) => !entry.success);

      const totalItemsCreated = result.results.reduce((count, r) => {
        if (!r.success) return count;
        return count + (r.items?.length || (r.item ? 1 : 0));
      }, 0);

      if (!failures.length) {
        await this.completeUpload(totalItemsCreated);
        return;
      }

      const remainingFiles: PreparedUploadFile[] = [];
      const remainingUrls: string[] = [];

      for (let i = 0; i < this.batchFiles.length; i++) {
        const file = this.batchFiles[i];
        const previewUrl = this.batchPreviewUrls[i];
        const itemResult = result.results[i];
        const succeeded = itemResult ? itemResult.success : false;

        if (succeeded) {
          if (previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl);
          }
        } else {
          remainingFiles.push(file);
          if (previewUrl) {
            remainingUrls.push(previewUrl);
          }
        }
      }

      this.batchFiles = remainingFiles;
      this.batchPreviewUrls = remainingUrls;
      if (this.activePreviewIndex >= this.batchFiles.length) {
        this.activePreviewIndex = Math.max(0, this.batchFiles.length - 1);
      }

      const failureSummary = failures
        .slice(0, 3)
        .map((entry) => `${entry.fileName}: ${entry.error || 'Could not upload item. Try again.'}`)
        .join(' ');
      this.message = result.succeededCount > 0
        ? `${totalItemsCreated} garment${totalItemsCreated === 1 ? '' : 's'} added. ${result.failedCount} photo${result.failedCount === 1 ? '' : 's'} could not be uploaded. ${failureSummary}`
        : failureSummary || 'Could not upload photos. Try again.';
      this.uploadError = true;
      void warningFeedback();
    } catch (error) {
      this.message = this.uploadFailureMessage(error, 'Could not upload photos. Try again.');
      this.uploadError = true;
      void warningFeedback();
    } finally {
      this.isBatchSaving = false;
      if (this.uploadError) this.statusMessage = '';
    }
  }

  private async prepareBatchImages(files: File[]): Promise<PreparedUploadFile[]> {
    const prepared: PreparedUploadFile[] = [];
    const skippedMessages: string[] = [];

    for (const [index, file] of files.entries()) {
      if (this.destroyed) break;
      this.statusMessage = `Preparing photo ${index + 1} of ${files.length}...`;
      const validationMessage = this.validateImageFile(file);
      if (validationMessage) {
        skippedMessages.push(files.length === 1 ? validationMessage : `${file.name}: ${validationMessage}`);
        continue;
      }

      try {
        const entry = await this.prepareImageForUpload(file);
        prepared.push(entry);
      } catch (error) {
        const errText = error instanceof Error ? error.message : 'Could not prepare image.';
        skippedMessages.push(files.length === 1 ? errText : `${file.name}: ${errText}`);
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

  private isPickerCancellation(error: unknown): boolean {
    return /cancelled|canceled|cancel/i.test(String((error as { message?: string })?.message ?? error));
  }

  private uploadFailureMessage(error: unknown, fallback: string): string {
    const failure = error as { status?: number; name?: string };
    if (failure?.status === 0 || failure?.name === 'TimeoutError') {
      return 'The upload response was interrupted. Your photos may already be saved. Check your wardrobe before uploading them again.';
    }
    return readMessage(error, fallback);
  }

  private async completeUpload(count: number, itemId?: string): Promise<void> {
    // Clear acknowledged uploads before navigation so a navigation failure cannot invite a duplicate upload.
    this.clearBatchSelection();
    this.statusMessage = `${count} garment${count === 1 ? '' : 's'} added. Cleaned previews may still be processing.`;
    void successFeedback();
    if (!this.isViewActive || this.destroyed) return;
    try {
      const navigated = itemId
        ? await this.router.navigate(['/tabs/wardrobe', itemId], { queryParams: { mode: 'edit', newlyAdded: 'true' } })
        : await this.router.navigate(['/tabs/wardrobe'], { queryParams: { newlyAddedCount: count } });
      if (!navigated) this.statusMessage += ' Open Wardrobe to view them.';
    } catch {
      this.statusMessage += ' Open Wardrobe to view them.';
    }
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
    if (!file) {
      return 'No file was selected.';
    }

    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    const hasImageExtension = /\.(jpe?g|png|webp|heic|heif|bmp|tiff?|gif)$/i.test(name);

    if ((!/^image\/(jpeg|jpg|png|webp|heic|heif|bmp|tiff?|gif)$/.test(type) && type !== '' && type !== 'application/octet-stream') || (!type.startsWith('image/') && !hasImageExtension)) {
      return 'Unsupported file format. Please select a photo (JPEG, PNG, WebP, or HEIC).';
    }

    if (!file.size) {
      return 'The selected photo file is empty or unreadable.';
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
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = await this.decodeImage(sourceUrl);
      if (image.naturalWidth < IMAGE_MIN_SIDE || image.naturalHeight < IMAGE_MIN_SIDE) {
        throw new Error(`Photo is too small (${image.naturalWidth}×${image.naturalHeight}px). Please select a photo at least 600×600 pixels for garment classification.`);
      }

      const sourceMaxSide = Math.max(image.naturalWidth, image.naturalHeight);
      const mustConvert = !/^image\/(jpeg|png|webp)$/.test(file.type.toLowerCase());
      const mustResize = sourceMaxSide > IMAGE_COMPRESSION_MAX_SIDES[0];
      if (!mustConvert && !mustResize && originalBytes <= IMAGE_COMPRESSION_TRIGGER_BYTES) {
        return {
          file,
          name: fileName,
          originalBytes,
          preparedBytes: originalBytes
        };
      }

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Could not prepare image canvas.');
      }

      let smallestBlob: Blob | null = null;
      for (const maxSide of IMAGE_COMPRESSION_MAX_SIDES) {
        const scale = Math.min(1, maxSide / sourceMaxSide);
        const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
        const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, targetWidth, targetHeight);
        context.drawImage(image, 0, 0, targetWidth, targetHeight);

        for (const quality of IMAGE_COMPRESSION_QUALITIES) {
          const compressedBlob = await this.toBlob(canvas, `image/${MIME_IMAGE_OUTPUT_EXTENSION}`, quality);
          if (compressedBlob.size && (!smallestBlob || compressedBlob.size < smallestBlob.size)) {
            smallestBlob = compressedBlob;
          }

          if (compressedBlob.size && compressedBlob.size <= MAX_UPLOAD_FILE_BYTES && (mustConvert || mustResize || compressedBlob.size < originalBytes)) {
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

      if (!mustConvert && !mustResize && originalBytes <= MAX_UPLOAD_FILE_BYTES && (!smallestBlob || smallestBlob.size >= originalBytes)) {
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
      const timer = setTimeout(() => {
        image.onload = null;
        image.onerror = null;
        image.src = '';
        reject(new Error('This photo took too long to open. Try a smaller photo or export it as JPEG.'));
      }, 15_000);
      image.onload = () => { clearTimeout(timer); resolve(image); };
      image.onerror = () => { clearTimeout(timer); reject(new Error('Could not decode or display this image format. Please select a JPEG, PNG, or WebP photo.')); };
      image.src = url;
    });
  }

  private toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Photo conversion took too long. Try a smaller photo.')), 15_000);
      try {
        canvas.toBlob((value) => {
        clearTimeout(timer);
        if (!value) {
          reject(new Error('Could not compress image.'));
          return;
        }

        resolve(value);
        }, type, quality);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  private async readSelectedPhoto(url: string): Promise<Blob> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Could not read the selected photo. Please choose it again.');
      return await response.blob();
    } finally {
      clearTimeout(timer);
    }
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
