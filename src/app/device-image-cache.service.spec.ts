import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FilesystemWeb } from '@capacitor/filesystem/dist/esm/web';
import { DeviceImageCacheService } from './device-image-cache.service';
import { AuthService } from './auth.service';

describe('DeviceImageCacheService', () => {
  let service: DeviceImageCacheService;
  let mockAuthService: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    mockAuthService = jasmine.createSpyObj<AuthService>('AuthService', [], {
      token: 'mock-jwt-token'
    });

    TestBed.configureTestingModule({
      providers: [
        DeviceImageCacheService,
        { provide: AuthService, useValue: mockAuthService }
      ]
    });

    service = TestBed.inject(DeviceImageCacheService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('URL Hashing, Extensions, and Cache Keys', () => {
    it('should strip query parameters and hash cache keys deterministically', () => {
      const url1 = 'https://api.wardrobe.ai/uploads/shirt.jpg?v=123';
      const url2 = 'https://api.wardrobe.ai/uploads/shirt.jpg?v=456';
      const url3 = 'https://api.wardrobe.ai/uploads/pants.jpg';

      const key1 = (service as any).cacheKey(url1);
      const key2 = (service as any).cacheKey(url2);
      const key3 = (service as any).cacheKey(url3);

      expect(key1).toBe('https://api.wardrobe.ai/uploads/shirt.jpg');
      expect(key2).toBe('https://api.wardrobe.ai/uploads/shirt.jpg');
      expect(key1).toBe(key2);
      expect(key3).toBe('https://api.wardrobe.ai/uploads/pants.jpg');

      const hash1 = (service as any).hash(key1);
      const hash2 = (service as any).hash(key2);
      const hash3 = (service as any).hash(key3);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(typeof hash1).toBe('string');
      expect(hash1.length).toBeGreaterThan(0);
    });

    it('should resolve known file extensions correctly', () => {
      expect((service as any).extension('https://example.com/item.jpeg')).toBe('.jpeg');
      expect((service as any).extension('https://example.com/item.JPG')).toBe('.jpg');
      expect((service as any).extension('https://example.com/item.png?width=200')).toBe('.png');
      expect((service as any).extension('https://example.com/item.webp')).toBe('.webp');
      expect((service as any).extension('https://example.com/item.gif')).toBe('.gif');
    });

    it('should fallback to .img for unknown or missing file extensions', () => {
      expect((service as any).extension('https://example.com/item.unknown')).toBe('.img');
      expect((service as any).extension('https://example.com/item')).toBe('.img');
      expect((service as any).extension('invalid-url')).toBe('.img');
    });

    it('should generate combined file names with hash and extension', () => {
      const url = 'https://api.wardrobe.ai/uploads/jacket.png?size=large';
      const key = (service as any).cacheKey(url);
      const fileName = (service as any).fileName(key, url);

      expect(fileName).toMatch(/^[a-z0-9]+\.png$/);
    });
  });

  describe('resolve()', () => {
    it('should return null or non-http URLs as is without caching', async () => {
      expect(await service.resolve(null)).toBeNull();
      expect(await service.resolve('')).toBe('');
      expect(await service.resolve('data:image/png;base64,123')).toBe('data:image/png;base64,123');
      expect(await service.resolve('blob:http://localhost/abc')).toBe('blob:http://localhost/abc');
    });

    it('should return original URL when not running on native platform', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);

      const url = 'https://api.wardrobe.ai/uploads/shirt.jpg';
      const resolved = await service.resolve(url);

      expect(resolved).toBe(url);
    });

    it('should return in-memory cached URL when already resolved', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      const localUrlSpy = spyOn<any>(service, 'localUrl');

      const url = 'https://api.wardrobe.ai/uploads/shirt.jpg';
      const key = (service as any).cacheKey(url);

      (service as any).rememberResolvedUrl(key, 'capacitor://localhost/_capacitor_file_/mock.jpg');

      const resolved = await service.resolve(url);
      expect(resolved).toBe('capacitor://localhost/_capacitor_file_/mock.jpg');
      expect(localUrlSpy).not.toHaveBeenCalled();
    });

    it('should return local converted file URL when local cache exists on disk', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      const localUrlSpy = spyOn<any>(service, 'localUrl').and.returnValue(Promise.resolve('capacitor://localhost/_capacitor_file_/shirt.jpg'));

      const url = 'https://api.wardrobe.ai/uploads/shirt.jpg';
      const resolved = await service.resolve(url);

      expect(resolved).toBe('capacitor://localhost/_capacitor_file_/shirt.jpg');
      expect(localUrlSpy).toHaveBeenCalled();
    });

    it('should return remote URL on cache miss and prime native cache in background', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
      spyOn<any>(service, 'localUrl').and.returnValue(Promise.reject(new Error('Cache miss')));

      const writeNativeSpy = spyOn<any>(service, 'writeNativeCache').and.returnValue(Promise.resolve('capacitor://localhost/cached.jpg'));

      const url = 'https://api.wardrobe.ai/uploads/new-shirt.jpg';
      const resolved = await service.resolve(url);

      expect(resolved).toBe(url);
      expect(writeNativeSpy).toHaveBeenCalled();
    });
  });

  describe('writeNativeCache() and primeNativeCache()', () => {
    it('should fetch image with auth token and write base64 data to filesystem', async () => {
      const mockBlob = new Blob(['image-binary-data'], { type: 'image/jpeg' });
      const mockResponse = {
        ok: true,
        blob: () => Promise.resolve(mockBlob)
      };
      spyOn(window, 'fetch').and.returnValue(Promise.resolve(mockResponse as any));
      spyOn<any>(service, 'blobToBase64').and.returnValue(Promise.resolve('YmFzZTY0ZGF0YQ=='));
      const writeFileSpy = spyOn(FilesystemWeb.prototype, 'writeFile').and.returnValue(Promise.resolve({ uri: 'file:///path' }));
      spyOn<any>(service, 'localUrl').and.returnValue(Promise.resolve('capacitor://localhost/cached-image.jpg'));

      const result = await (service as any).writeNativeCache('https://api.wardrobe.ai/uploads/item.jpg', 'image-cache/test.jpg');

      expect(window.fetch).toHaveBeenCalledWith('https://api.wardrobe.ai/uploads/item.jpg', {
        headers: { Authorization: 'Bearer mock-jwt-token' }
      });
      expect(writeFileSpy).toHaveBeenCalledWith(jasmine.objectContaining({
        path: 'image-cache/test.jpg'
      }));
      expect(result).toBe('capacitor://localhost/cached-image.jpg');
    });

    it('should return original URL when fetch response is not ok', async () => {
      const mockResponse = new Response('Not found', { status: 404 });
      spyOn(window, 'fetch').and.returnValue(Promise.resolve(mockResponse));

      const result = await (service as any).writeNativeCache('https://api.wardrobe.ai/uploads/missing.jpg', 'image-cache/missing.jpg');
      expect(result).toBe('https://api.wardrobe.ai/uploads/missing.jpg');
    });

    it('should return null when fetch throws an error', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.reject(new Error('Network error')));

      const result = await (service as any).writeNativeCache('https://api.wardrobe.ai/uploads/err.jpg', 'image-cache/err.jpg');
      expect(result).toBeNull();
    });

    it('should deduplicate in-flight caching operations for the same cache key', () => {
      const writeSpy = spyOn<any>(service, 'writeNativeCache').and.returnValue(new Promise(() => {}));

      (service as any).primeNativeCache('https://api.wardrobe.ai/uploads/item.jpg', 'item-key', 'path1');
      (service as any).primeNativeCache('https://api.wardrobe.ai/uploads/item.jpg', 'item-key', 'path1');

      expect(writeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearCache()', () => {
    it('should clear in-memory caches on non-native platform', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);

      (service as any).rememberResolvedUrl('key1', 'url1');
      (service as any).inFlight.set('key1', Promise.resolve());

      await service.clearCache();

      expect((service as any).resolvedUrls.size).toBe(0);
      expect((service as any).inFlight.size).toBe(0);
    });

    it('should clear in-memory caches and resolve cleanly on native platform', async () => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);

      (service as any).rememberResolvedUrl('key1', 'url1');
      (service as any).inFlight.set('key1', Promise.resolve());

      await expectAsync(service.clearCache()).toBeResolved();

      expect((service as any).resolvedUrls.size).toBe(0);
      expect((service as any).inFlight.size).toBe(0);
    });
  });

  describe('Cache Eviction', () => {
    it('should evict the oldest resolved URL when maxResolvedUrlCount is reached', () => {
      const maxCount = (service as any).maxResolvedUrlCount;

      for (let i = 0; i < maxCount; i++) {
        (service as any).rememberResolvedUrl(`key_${i}`, `url_${i}`);
      }

      expect((service as any).resolvedUrls.has('key_0')).toBeTrue();
      expect((service as any).resolvedUrls.size).toBe(maxCount);

      (service as any).rememberResolvedUrl('new_key', 'new_url');

      expect((service as any).resolvedUrls.has('key_0')).toBeFalse();
      expect((service as any).resolvedUrls.has('new_key')).toBeTrue();
      expect((service as any).resolvedUrls.size).toBe(maxCount);
    });
  });

  describe('blobToBase64()', () => {
    it('should convert blob to base64 string', async () => {
      const blob = new Blob(['hello world'], { type: 'text/plain' });
      const base64 = await (service as any).blobToBase64(blob);

      expect(typeof base64).toBe('string');
      expect(base64.length).toBeGreaterThan(0);
    });
  });
});
