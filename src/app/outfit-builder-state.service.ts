import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { GeneratedOutfitDto, OutfitDto } from './models';

export interface OutfitBuilderDraft {
  builderMode: 'generate' | 'manual';
  query: string;
  occasion: string;
  dressCode: string;
  selectedAvoids: string[];
  requiredItemId: string | null;
  manualName: string;
  manualItemIds: string[];
  results: GeneratedOutfitDto[];
  lastGeneratedPrompt: string;
  hasGeneratedSearchRun: boolean;
  savedOutfits: [string, OutfitDto][];
  wornOutfitKeys: string[];
}

/** Keeps the current user's outfit draft across supporting screens and tab recreation. */
@Injectable({ providedIn: 'root' })
export class OutfitBuilderStateService {
  private readonly auth = inject(AuthService);
  private ownerId: string | null = null;
  private draft: OutfitBuilderDraft | null = null;

  get accountId(): string | null {
    const id = this.auth.session?.user.id ?? null;
    if (id !== this.ownerId) {
      this.ownerId = id;
      this.draft = null;
    }
    return id;
  }

  read(): OutfitBuilderDraft | null {
    return this.accountId && this.draft ? structuredClone(this.draft) : null;
  }

  save(draft: OutfitBuilderDraft, ownerId: string | null): void {
    if (ownerId && ownerId === this.accountId) this.draft = structuredClone(draft);
  }
}
