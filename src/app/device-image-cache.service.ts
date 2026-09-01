import { Injectable, Injector, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class DeviceImageCacheService {
  private readonly injector = inject(Injector);
  private authService?: AuthService;
  private readonly cacheDirectory = 'image-cache';
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly resolvedUrls = new Map<string, string>();
  private readonly maxResolvedUrlCount = 300;

  private get auth(): AuthService {
    if (!this.authService) {
      this.authService = this.injector.get(AuthService);
    }
    return this.authService;
  }

  async resolve(url: string | null): Promise<string | null> {
    if (!url || !/^https?:/i.test(url) || !Capacitor.isNativePlatform()) {
      return url;
    }

    const cacheKey = this.cacheKey(url);
    const cachedUrl = this.resolvedUrls.get(cacheKey);
    if (cachedUrl) {
      return cachedUrl;
    }

    const path = `${this.cacheDirectory}/${this.fileName(cacheKey, url)}`;
    try {
      const localUrl = await this.localUrl(path);
      this.rememberResolvedUrl(cacheKey, localUrl);
      return localUrl;
    } catch {
      // Cache miss. Let the browser show the remote image immediately and warm the device cache in the background.
    }

    this.primeNativeCache(url, cacheKey, path);
    return url;
  }

  async clearCache(): Promise<void> {
    this.resolvedUrls.clear();
    this.inFlight.clear();
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    try {
      await Filesystem.rmdir({
        path: this.cacheDirectory,
        directory: Directory.Data,
        recursive: true
      });
    } catch {
      // Cache directory might not exist yet.
    }
  }

  private rememberResolvedUrl(cacheKey: string, resolvedUrl: string): void {
    if (this.resolvedUrls.size >= this.maxResolvedUrlCount) {
      const oldestKey = this.resolvedUrls.keys().next().value;
      if (oldestKey) {
        this.resolvedUrls.delete(oldestKey);
      }
    }

    this.resolvedUrls.set(cacheKey, resolvedUrl);
  }

  private primeNativeCache(url: string, cacheKey: string, path: string): void {
    if (this.inFlight.has(cacheKey)) {
      return;
    }

    const promise = this.writeNativeCache(url, path)
      .then((resolvedUrl) => {
        if (resolvedUrl) {
          this.rememberResolvedUrl(cacheKey, resolvedUrl);
        }
      })
      .catch(() => {
        // Keep image display independent from cache write failures.
      })
      .finally(() => this.inFlight.delete(cacheKey));

    this.inFlight.set(cacheKey, promise);
  }

  private async writeNativeCache(url: string, path: string): Promise<string | null> {
    try {
      const accessToken = this.auth.token;
      const response = await fetch(url, accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined);
      if (!response.ok) {
        return url;
      }

      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) {
        return url;
      }

      await Filesystem.writeFile({
        path,
        data: await this.blobToBase64(blob),
        directory: Directory.Data,
        recursive: true
      });

      return await this.localUrl(path);
    } catch {
      return null;
    }
  }

  private async localUrl(path: string): Promise<string> {
    await Filesystem.stat({
      path,
      directory: Directory.Data
    });

    const result = await Filesystem.getUri({
      path,
      directory: Directory.Data
    });

    return Capacitor.convertFileSrc(result.uri);
  }

  private fileName(cacheKey: string, sourceUrl: string): string {
    return `${this.hash(cacheKey)}${this.extension(sourceUrl)}`;
  }

  private cacheKey(value: string): string {
    try {
      const parsed = new URL(value);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return value.split('?', 2)[0];
    }
  }

  private hash(value: string): string {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }

    return Math.abs(hash).toString(36);
  }

  private extension(value: string): string {
    try {
      const pathname = new URL(value).pathname;
      const match = /\.(jpe?g|png|webp|gif)$/i.exec(pathname);
      return match ? match[0].toLowerCase() : '.img';
    } catch {
      return '.img';
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.onerror = () => reject(new Error('Could not cache image.'));
      reader.readAsDataURL(blob);
    });
  }
}
