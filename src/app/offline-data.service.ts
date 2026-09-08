import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

interface OfflineEnvelope<T> {
  userId: string;
  savedAt: string;
  value: T;
}

/** Offline snapshots older than this are treated as stale and ignored (7 days). */
export const OFFLINE_DATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class OfflineDataService {
  private readonly prefix = 'wardrobe-offline-v1';

  async read<T>(userId: string, resource: string, maxAgeMs = OFFLINE_DATA_TTL_MS): Promise<T | null> {
    const stored = await Preferences.get({ key: this.key(userId, resource) });
    if (!stored.value) return null;
    try {
      const parsed = JSON.parse(stored.value) as OfflineEnvelope<T>;
      if (parsed.userId !== userId) return null;
      const savedAt = Date.parse(parsed.savedAt);
      if (!Number.isNaN(savedAt) && Date.now() - savedAt > maxAgeMs) {
        await Preferences.remove({ key: this.key(userId, resource) });
        return null;
      }
      return parsed.value;
    } catch {
      await Preferences.remove({ key: this.key(userId, resource) });
      return null;
    }
  }

  async write<T>(userId: string, resource: string, value: T): Promise<void> {
    const envelope: OfflineEnvelope<T> = { userId, savedAt: new Date().toISOString(), value };
    await Preferences.set({ key: this.key(userId, resource), value: JSON.stringify(envelope) });
  }

  async clearUser(userId: string): Promise<void> {
    const keys = await Preferences.keys();
    await Promise.all(keys.keys
      .filter((key) => key.startsWith(`${this.prefix}:${encodeURIComponent(userId)}:`))
      .map((key) => Preferences.remove({ key })));
  }

  private key(userId: string, resource: string): string {
    return `${this.prefix}:${encodeURIComponent(userId)}:${resource}`;
  }
}
