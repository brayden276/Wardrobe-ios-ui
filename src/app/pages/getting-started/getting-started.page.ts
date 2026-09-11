import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../auth.service';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { readMessage } from '../page-helpers';

@Component({
  selector: 'app-getting-started',
  standalone: false,
  templateUrl: './getting-started.page.html',
  styleUrls: ['./getting-started.page.scss']
})
export class GettingStartedPage {
  private readonly api = inject(WardrobeApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  get returnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl');
    return url === '/tabs/settings' || url === '/tabs/builder' ? url : '/tabs/wardrobe';
  }
  isLoading = false;
  message = '';
  progress: { hasItems: boolean; hasOutfits: boolean; hasWornOutfit: boolean } | null = null;
  private loadId = 0;

  ionViewWillEnter(): Promise<void> {
    return this.loadProgress();
  }

  ionViewWillLeave(): void {
    this.loadId++;
    this.isLoading = false;
  }

  async loadProgress(): Promise<void> {
    const loadId = ++this.loadId;
    const userId = this.auth.session?.user.id;
    this.progress = null;
    this.message = '';
    this.isLoading = true;
    try {
      const [items, outfits] = await Promise.all([this.api.getItems(), this.api.getOutfits()]);
      if (loadId !== this.loadId || userId !== this.auth.session?.user.id) return;
      this.progress = {
        hasItems: items.some((item) => !item.isArchived && !item.isDeleted),
        hasOutfits: outfits.length > 0,
        hasWornOutfit: outfits.some((outfit) => outfit.wearCount > 0)
      };
    } catch (error) {
      if (loadId === this.loadId && userId === this.auth.session?.user.id) {
        this.message = readMessage(error, 'Could not load your progress. You can still use the guide below.');
      }
    } finally {
      if (loadId === this.loadId) this.isLoading = false;
    }
  }
}
