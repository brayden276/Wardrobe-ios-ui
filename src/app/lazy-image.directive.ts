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

  ngAfterViewInit(): void {
    this.observe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['appLazyImage']) {
      return;
    }

    this.loadToken++;
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
    if (!sourceUrl) {
      return;
    }

    const token = this.loadToken;
    void this.queue.enqueue(async () => {
      const resolvedUrl = await this.imageCache.resolve(sourceUrl);
      if (!resolvedUrl || token !== this.loadToken) {
        return;
      }

      await this.setImageSource(resolvedUrl, token);
    }, this.appLazyImagePriority);
  }

  private setImageSource(url: string, token: number): Promise<void> {
    return new Promise((resolve) => {
      const image = this.element.nativeElement;
      const finish = (loaded: boolean): void => {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        if (token === this.loadToken) {
          this.isLoaded = loaded;
          this.hasFailed = !loaded;
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
