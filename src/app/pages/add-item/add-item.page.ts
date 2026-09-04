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

type AddItemProcessingKind = 'preparingPhotos' | 'uploadingSinglePhoto' | 'uploadingBatchPhotos';

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
  readonly CameraSource = CameraSource;
  readonly maxBatchUploadCount = MAX_BATCH_UPLOAD_COUNT;
  message = '';
  statusMessage = '';
  isSaving = false;
  isPreparing = false;
  uploadError = false;
  hasAiConsent = false;
  batchFiles: PreparedUploadFile[] = [];
  batchPreviewUrls: string[] = [];
  isBatchSaving = false;
  processingKind: AddItemProcessingKind | null = null;
  processingStepIndex = 0;

  async ionViewWillEnter(): Promise<void> {
    this.hasAiConsent = await hasAiConsent();
  }
  private readonly processingStepsByKind: Record<AddItemProcessingKind, string[]> = {
    preparingPhotos: ['Reading selected photos', 'Checking image quality', 'Optimising photos', 'Preparing upload queue'],
    uploadingSinglePhoto: ['Uploading photo', 'Classifying clothing', 'Starting image cleanup', 'Opening wardrobe'],
    uploadingBatchPhotos: ['Uploading photos', 'Classifying items', 'Starting image cleanup', 'Opening wardrobe']
  };

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
    return this.isSaving || this.isBatchSaving || this.isPreparing;
  }

  get scanningStatusText(): string {
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
    void this.capture(CameraSource.Photos);
  }

  get isFullPageProcessing(): boolean {
    return false;
  }

  get processingTitle(): string {
    switch (this.processingKind) {
      case 'preparingPhotos':
        return 'Preparing photos';
      case 'uploadingSinglePhoto':
      case 'uploadingBatchPhotos':
        return 'Adding clothing items';
      default:
        return '';
    }
  }

  get processingDetail(): string {
    switch (this.processingKind) {
      case 'preparingPhotos':
        return 'Checking and optimising the selected photos before upload.';
      case 'uploadingSinglePhoto':
        return 'Sending the photo to Wardrobe AI and creating the item.';
      case 'uploadingBatchPhotos':
        return 'Sending the selected photos to Wardrobe AI and creating the items.';
      default:
        return '';
    }
  }

  get processingSteps(): string[] {
    return this.processingKind ? this.processingStepsByKind[this.processingKind] : [];
  }

  processingStepState(index: number): string {
    if (!this.processingKind) {
      return '';
    }

    if (index < this.processingStepIndex) {
      return 'complete';
    }

    return index === this.processingStepIndex ? 'active' : 'pending';
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
            this.openBatchPicker();
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
      await this.addSelectedFiles([sourceImage]);
    } catch {
      this.message = source === CameraSource.Camera ? 'Camera was not available.' : 'Could not open photo library.';
      this.uploadError = true;
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

  ionViewDidLeave(): void {
    this.revokeBatchPreviewUrls();
  }

  ngOnDestroy(): void {
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
    if (this.isSaving || this.isBatchSaving || this.isPreparing || !this.batchFiles.length) {
      return;
    }

    this.isSaving = true;
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

      this.isSaving = false;

      if (this.batchFiles.length === 1) {
        await this.uploadSinglePreparedPhoto(this.batchFiles[0]);
        return;
      }

      await this.uploadPreparedPhotos();
    } finally {
      this.isSaving = false;
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
    this.message = '';
    this.statusMessage = '';
    this.uploadError = false;
    this.isPreparing = true;
    this.startProcessing('preparingPhotos');

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

      this.setProcessingStep(1);
      this.setProcessingStep(2);
      const preparedFiles = await this.prepareBatchImages(files.slice(0, remainingCount));
      this.setProcessingStep(3);
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
      this.stopProcessing('preparingPhotos');
    }
  }

  private async uploadSinglePreparedPhoto(photo: PreparedUploadFile): Promise<void> {
    if (this.isSaving || this.isBatchSaving || this.isPreparing) {
      return;
    }

    this.isSaving = true;
    this.message = '';
    this.statusMessage = 'Uploading photo...';
    this.uploadError = false;
    this.startProcessing('uploadingSinglePhoto');

    try {
      this.setProcessingStep(1);
      const created = await this.api.createItem(photo.file, photo.name);
      this.setProcessingStep(2);
      this.clearBatchSelection();
      void successFeedback();
      this.setProcessingStep(3);
      if (created?.id) {
        await this.router.navigate(['/tabs/wardrobe', created.id], {
          queryParams: { mode: 'edit', newlyAdded: 'true' }
        });
      } else {
        await this.router.navigateByUrl('/tabs/wardrobe');
      }
    } catch (error) {
      this.message = readMessage(error, 'Could not upload photo. Try again.');
      this.uploadError = true;
      void warningFeedback();
    } finally {
      this.isSaving = false;
      this.statusMessage = '';
      this.stopProcessing('uploadingSinglePhoto');
    }
  }

  private async uploadPreparedPhotos(): Promise<void> {
    if (this.isSaving || this.isBatchSaving || this.isPreparing || !this.batchFiles.length) {
      return;
    }

    this.isBatchSaving = true;
    this.message = '';
    this.statusMessage = `Uploading ${this.batchFiles.length} photos...`;
    this.uploadError = false;
    this.startProcessing('uploadingBatchPhotos');
    try {
      this.setProcessingStep(1);
      const result = await this.api.createItems(this.batchFiles.map((entry) => entry.file));
      this.setProcessingStep(2);
      const failures = result.results.filter((entry) => !entry.success);

      if (!failures.length) {
        this.clearBatchSelection();
        void successFeedback();
        this.setProcessingStep(3);
        await this.router.navigateByUrl('/tabs/wardrobe');
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

      const failureSummary = failures
        .slice(0, 3)
        .map((entry) => `${entry.fileName}: ${entry.error || 'Could not upload item. Try again.'}`)
        .join(' ');
      this.message = result.succeededCount > 0
        ? `${result.succeededCount} item${result.succeededCount === 1 ? '' : 's'} added. ${result.failedCount} could not be uploaded. ${failureSummary}`
        : failureSummary || 'Could not upload photos. Try again.';
      this.uploadError = true;
      void warningFeedback();
    } catch (error) {
      this.message = readMessage(error, 'Could not upload photos. Try again.');
      this.uploadError = true;
      void warningFeedback();
    } finally {
      this.isBatchSaving = false;
      this.statusMessage = '';
      this.stopProcessing('uploadingBatchPhotos');
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
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = await this.decodeImage(sourceUrl);
      if (image.naturalWidth < IMAGE_MIN_SIDE || image.naturalHeight < IMAGE_MIN_SIDE) {
        throw new Error('Images must be at least 600x600 for reliable classification.');
      }

      if (originalBytes <= IMAGE_COMPRESSION_TRIGGER_BYTES) {
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

  private startProcessing(kind: AddItemProcessingKind): void {
    this.processingKind = kind;
    this.processingStepIndex = 0;
  }

  private setProcessingStep(index: number): void {
    if (!this.processingKind) {
      return;
    }

    this.processingStepIndex = Math.min(index, this.processingSteps.length - 1);
  }

  private stopProcessing(kind: AddItemProcessingKind): void {
    if (this.processingKind !== kind) {
      return;
    }

    this.processingKind = null;
    this.processingStepIndex = 0;
  }
}
