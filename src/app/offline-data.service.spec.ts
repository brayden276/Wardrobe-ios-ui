import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { PreferencesWeb } from '@capacitor/preferences/dist/esm/web';
import { OfflineDataService, OFFLINE_DATA_TTL_MS } from './offline-data.service';

describe('OfflineDataService recovery', () => {
  let service: OfflineDataService;
  const userId = 'offline-test-user';
  const key = `wardrobe-offline-v1:${userId}:items`;

  beforeEach(async () => {
    await Preferences.clear();
    service = TestBed.inject(OfflineDataService);
  });

  afterEach(async () => {
    await Preferences.clear();
  });

  it('round-trips a fresh account-scoped snapshot', async () => {
    await service.write(userId, 'items', [{ id: 'item-1' }]);
    expect(await service.read(userId, 'items')).toEqual([{ id: 'item-1' }]);
    expect(await service.read('another-user', 'items')).toBeNull();
  });

  for (const savedAt of ['invalid', undefined, new Date(Date.now() + 86_400_000).toISOString(), new Date(Date.now() - OFFLINE_DATA_TTL_MS - 1000).toISOString()]) {
    it(`rejects a snapshot with invalid or stale timestamp ${savedAt}`, async () => {
      await Preferences.set({ key, value: JSON.stringify({ userId, savedAt, value: ['old'] }) });
      expect(await service.read(userId, 'items')).toBeNull();
      expect((await Preferences.get({ key })).value).toBeNull();
    });
  }

  for (const value of ['{broken', 'null']) {
    it(`recovers from malformed snapshot ${value} even if removal fails`, async () => {
      await Preferences.set({ key, value });
      spyOn(PreferencesWeb.prototype, 'remove').and.rejectWith(new Error('Storage unavailable'));
      expect(await service.read(userId, 'items')).toBeNull();
    });
  }

  it('returns a cache miss when device storage cannot be read', async () => {
    spyOn(PreferencesWeb.prototype, 'get').and.rejectWith(new Error('Storage unavailable'));
    spyOn(PreferencesWeb.prototype, 'remove').and.rejectWith(new Error('Storage unavailable'));
    expect(await service.read(userId, 'items')).toBeNull();
  });

  it('does not fail a successful network operation when saving its snapshot fails', async () => {
    await service.write(userId, 'items', ['old']);
    spyOn(PreferencesWeb.prototype, 'set').and.rejectWith(new Error('Quota exceeded'));
    await expectAsync(service.write(userId, 'items', ['new'])).toBeResolved();
    expect(await service.read(userId, 'items')).toBeNull();
  });

  it('recovers when both saving and removing an optional snapshot fail', async () => {
    spyOn(PreferencesWeb.prototype, 'set').and.rejectWith(new Error('Storage unavailable'));
    spyOn(PreferencesWeb.prototype, 'remove').and.rejectWith(new Error('Storage unavailable'));
    await expectAsync(service.write(userId, 'items', ['new'])).toBeResolved();
  });

  it('still reports a failed account data cleanup', async () => {
    await service.write(userId, 'items', ['private']);
    spyOn(PreferencesWeb.prototype, 'remove').and.rejectWith(new Error('Storage unavailable'));
    await expectAsync(service.clearUser(userId)).toBeRejected();
  });
});
