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
    const key = this.key(userId, resource);
    try {
      const stored = await Preferences.get({ key });
      if (!stored.value) return null;
      const parsed = JSON.parse(stored.value) as OfflineEnvelope<T>;
      if (parsed.userId !== userId) return null;
      const savedAt = Date.parse(parsed.savedAt);
      if (!Number.isFinite(savedAt) || savedAt > Date.now() || Date.now() - savedAt > maxAgeMs) {
        await this.removeSnapshot(key);
        return null;
      }
      return parsed.value ?? null;
    } catch {
      // Offline snapshots are optional: an unreadable cache is a cache miss.
      await this.removeSnapshot(key);
      return null;
    }
  }

  async write<T>(userId: string, resource: string, value: T): Promise<void> {
    const envelope: OfflineEnvelope<T> = { userId, savedAt: new Date().toISOString(), value };
    try {
      await Preferences.set({ key: this.key(userId, resource), value: JSON.stringify(envelope) });
    } catch {
      // Keep a successful network operation usable if device storage is full.
      // Discard the previous snapshot so it is not mistaken for the new data.
      await this.removeSnapshot(this.key(userId, resource));
    }
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

  private async removeSnapshot(key: string): Promise<void> {
    try {
      await Preferences.remove({ key });
    } catch {
      // Recovery must also work when the storage backend itself is unavailable.
    }
  }
}
