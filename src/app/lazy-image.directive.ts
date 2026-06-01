import { AfterViewInit, Directive, ElementRef, HostBinding, Input, NgZone, OnChanges, OnDestroy, Renderer2, SimpleChanges, inject } from '@angular/core';
import { DeviceImageCacheService } from './device-image-cache.service';
import { ImageLoadQueueService } from './image-load-queue.service';

@Directive({
  selector: 'img[appLazyImage]',
  standalone: false
})
export class LazyImageDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input() appLazyImage: string | null = null;
  @Input() appLazyImagePriority = false;
  @HostBinding('class.image-loaded') isLoaded = false;
  @HostBinding('class.image-failed') hasFailed = false;

  private readonly element = inject(ElementRef<HTMLImageElement>);
  private readonly renderer = inject(Renderer2);
  private readonly zone = inject(NgZone);
  private readonly imageCache = inject(DeviceImageCacheService);
  private readonly queue = inject(ImageLoadQueueService);
  private observer: IntersectionObserver | null = null;
  private isVisible = false;
  private loadToken = 0;
  private currentImageKey: string | null = null;
  private pendingImageKey: string | null = null;
  private loadedImageKey: string | null = null;

  ngAfterViewInit(): void {
    if (this.appLazyImagePriority) {
      this.isVisible = true;
      this.loadVisibleImage();
      return;
    }

    this.observe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['appLazyImage']) {
      return;
    }

    const nextImageKey = this.imageKey(changes['appLazyImage'].currentValue as string | null);
    if (!changes['appLazyImage'].firstChange && this.currentImageKey === nextImageKey) {
      return;
    }

    this.currentImageKey = nextImageKey;
    this.loadToken++;
    this.pendingImageKey = null;
    this.loadedImageKey = null;
    this.isLoaded = false;
    this.hasFailed = false;
    this.renderer.removeAttribute(this.element.nativeElement, 'src');

    if (this.isVisible) {
      this.loadVisibleImage();
    }
  }

  ngOnDestroy(): void {
    this.loadToken++;
    this.observer?.disconnect();
    this.observer = null;
  }

  private observe(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.isVisible = true;
      this.loadVisibleImage();
      return;
    }

    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.observer?.disconnect();
          this.observer = null;
          this.zone.run(() => {
            this.isVisible = true;
            this.loadVisibleImage();
          });
        }
      }, { rootMargin: '160px 0px' });

      this.observer.observe(this.element.nativeElement);
    });
  }

  private loadVisibleImage(): void {
    const sourceUrl = this.appLazyImage;
    const sourceKey = this.currentImageKey ?? this.imageKey(sourceUrl);
    if (!sourceUrl || !sourceKey || this.pendingImageKey === sourceKey || this.loadedImageKey === sourceKey) {
      return;
    }

    const token = this.loadToken;
    this.pendingImageKey = sourceKey;
    const task = async (): Promise<void> => {
      try {
        const resolvedUrl = await this.imageCache.resolve(sourceUrl);
        if (!resolvedUrl || token !== this.loadToken) {
          return;
        }

        await this.setImageSource(resolvedUrl, token, sourceKey);
      } finally {
        if (this.pendingImageKey === sourceKey) {
          this.pendingImageKey = null;
        }
      }
    };

    if (this.appLazyImagePriority) {
      void this.zone.runOutsideAngular(task);
      return;
    }

    void this.queue.enqueue(() => this.zone.runOutsideAngular(task));
  }

  private imageKey(value: string | null): string | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = new URL(value);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return value.split('?', 2)[0];
    }
  }

  private setImageSource(url: string, token: number, imageKey: string): Promise<void> {
    return new Promise((resolve) => {
      const image = this.element.nativeElement;
      const finish = (loaded: boolean): void => {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        if (token === this.loadToken) {
          this.zone.run(() => {
            this.isLoaded = loaded;
            this.hasFailed = !loaded;
            this.loadedImageKey = loaded ? imageKey : null;
          });
        }
        resolve();
      };
      const onLoad = (): void => finish(true);
      const onError = (): void => finish(false);

      image.addEventListener('load', onLoad, { once: true });
      image.addEventListener('error', onError, { once: true });
      this.renderer.setAttribute(image, 'src', url);

      if (image.complete && image.naturalWidth > 0) {
        finish(true);
      }
    });
  }
}
