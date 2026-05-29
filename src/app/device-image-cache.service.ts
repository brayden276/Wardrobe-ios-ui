import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class DeviceImageCacheService {
  private readonly auth = inject(AuthService);
  private readonly cacheDirectory = 'image-cache';
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly resolvedUrls = new Map<string, string>();
  private readonly maxResolvedUrlCount = 300;

  async resolve(url: string | null): Promise<string | null> {
    if (!url || !/^https?:/i.test(url) || !Capacitor.isNativePlatform()) {
      return url;
    }

    const cachedUrl = this.resolvedUrls.get(url);
    if (cachedUrl) {
      return cachedUrl;
    }

    let promise = this.inFlight.get(url);
    if (!promise) {
      promise = this.resolveNativeUrl(url)
        .then((resolvedUrl) => {
          this.rememberResolvedUrl(url, resolvedUrl);
          return resolvedUrl;
        })
        .finally(() => this.inFlight.delete(url));
      this.inFlight.set(url, promise);
    }

    return promise;
  }

  private rememberResolvedUrl(url: string, resolvedUrl: string): void {
    if (this.resolvedUrls.size >= this.maxResolvedUrlCount) {
      const oldestUrl = this.resolvedUrls.keys().next().value;
      if (oldestUrl) {
        this.resolvedUrls.delete(oldestUrl);
      }
    }

    this.resolvedUrls.set(url, resolvedUrl);
  }

  private async resolveNativeUrl(url: string): Promise<string> {
    const path = `${this.cacheDirectory}/${this.fileName(url)}`;

    try {
      return await this.localUrl(path);
    } catch {
      // Cache miss. Download below and fall back to the remote URL on failure.
    }

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
      return url;
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

  private fileName(url: string): string {
    return `${this.hash(url)}${this.extension(url)}`;
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
