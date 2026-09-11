import { Component, HostListener, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { OutfitDto, WardrobeLookupsDto } from '../../models';
import { WardrobeApiService } from '../../wardrobe-api.service';
import { AuthService } from '../../auth.service';
import { confirmAction, lightImpact, lookupLabel, noticeKind, NoticeKind, readMessage, successFeedback, warningFeedback } from '../page-helpers';

export interface OutfitCard {
  outfit: OutfitDto;
  imageUrl: string | null;
  isSelected: boolean;
  isMarking: boolean;
  isRemoving: boolean;
  isFavorite: boolean;
  isFavoriting: boolean;
  actionMessage: string;
}

@Component({
  selector: 'app-outfits',
  standalone: false,
  templateUrl: './outfits.page.html',
  styleUrls: ['./outfits.page.scss']
})
export class OutfitsPage {
  private readonly api = inject(WardrobeApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly actionSheetController = inject(ActionSheetController);
  private readonly toastController = inject(ToastController);

  private readonly FAVORITES_STORAGE_PREFIX = 'wb_favorite_outfits';

  outfits: OutfitDto[] = [];
  lookups: WardrobeLookupsDto | null = null;
  selectedOutfit: OutfitDto | null = null;
  isEditingOutfit = false;
  isSavingOutfit = false;
  outfitForm = { name: '', explanation: '' };
  editMessage = '';
  isLoading = true;
  message = '';
  isSelectionMode = false;
  isDeletingSelected = false;
  selectedOutfitIds = new Set<string>();
  favoriteOutfitIds = new Set<string>();
  favoriteMessage = '';
  isLoadingFavorites = false;
  private readonly updatingFavoriteIds = new Set<string>();

  readonly markingOutfitIds = new Set<string>();
  private readonly deletingOutfitIds = new Set<string>();
  private readonly outfitRenderIncrement = 20;
  private outfitLongPressHandle: ReturnType<typeof setTimeout> | null = null;
  private suppressNextOutfitClick = false;
  private readonly selectionLongPressMs = 450;
  private activeLoad: Promise<void> | null = null;
  private hasPendingLoad = false;
  private hasPendingForceRefresh = false;

  readonly skeletonPlaceholders = [0, 1, 2];
  visibleOutfitCount = this.outfitRenderIncrement;
  visibleOutfits: OutfitCard[] = [];

  outfitSearch = '';
  outfitFilter: 'all' | 'favorites' | 'worn' | 'recent' = 'all';

  get filteredOutfits(): OutfitDto[] {
    let list = this.outfits;
    const query = this.outfitSearch.trim().toLowerCase();
    if (query) {
      list = list.filter((o) =>
        o.name.toLowerCase().includes(query) ||
        (o.explanation && o.explanation.toLowerCase().includes(query)) ||
        o.items.some((item) => item.name.toLowerCase().includes(query)));
    }

    if (this.outfitFilter === 'favorites') {
      list = list.filter((o) => this.favoriteOutfitIds.has(o.id));
    } else if (this.outfitFilter === 'worn') {
      list = list.slice().sort((a, b) => b.wearCount - a.wearCount);
    } else if (this.outfitFilter === 'recent') {
      list = list.slice().sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }

    return list;
  }

  setOutfitFilter(filter: 'all' | 'favorites' | 'worn' | 'recent'): void {
    this.outfitFilter = filter;
    this.visibleOutfitCount = this.outfitRenderIncrement;
    this.updateVisibleOutfits();
    void lightImpact();
  }

  onSearchInput(): void {
    this.visibleOutfitCount = this.outfitRenderIncrement;
    this.updateVisibleOutfits();
  }

  get isAllVisibleSelected(): boolean {
    return this.filteredOutfits.length > 0 && this.filteredOutfits.every((outfit) => this.selectedOutfitIds.has(outfit.id));
  }

  toggleSelectAll(): void {
    if (this.isAllVisibleSelected) {
      this.clearSelection();
    } else {
      for (const outfit of this.filteredOutfits) {
        this.selectedOutfitIds.add(outfit.id);
      }
      this.updateVisibleOutfits();
    }
    void lightImpact();
  }

  get canShowMoreOutfits(): boolean {
    return this.visibleOutfitCount < this.filteredOutfits.length;
  }

  get loadingMessage(): string {
    return this.outfits.length ? 'Refreshing outfits...' : 'Loading outfits...';
  }

  get selectedCount(): number {
    return this.selectedOutfitIds.size;
  }


  get messageKind(): NoticeKind {
    return noticeKind(this.message);
  }

  get canRetryMessage(): boolean {
    return this.messageKind === 'error' || this.messageKind === 'offline';
  }

  @HostListener('document:keydown.escape')
  onEscapePress(): void {
    if (this.selectedOutfit) {
      this.close();
    }
  }

  showMoreOutfits(): void {
    this.visibleOutfitCount = Math.min(this.filteredOutfits.length, this.visibleOutfitCount + this.outfitRenderIncrement);
    this.updateVisibleOutfits();
  }

  async ionViewWillEnter(): Promise<void> {
    this.loadFavorites();
    await this.load();
  }

  async refreshOutfits(event: Event): Promise<void> {
    try {
      await this.load(true);
    } finally {
      (event.target as { complete?: () => void } | null)?.complete?.();
    }
  }

  async load(forceRefresh = false): Promise<void> {
    if (this.activeLoad) {
      this.hasPendingLoad = true;
      this.hasPendingForceRefresh = this.hasPendingForceRefresh || forceRefresh;
      return this.activeLoad;
    }

    do {
      forceRefresh = forceRefresh || this.hasPendingForceRefresh;
      this.hasPendingLoad = false;
      this.hasPendingForceRefresh = false;
      this.activeLoad = this.loadCore(forceRefresh);
      try {
        await this.activeLoad;
      } finally {
        this.activeLoad = null;
      }
      forceRefresh = false;
    } while (this.hasPendingLoad);
  }

  private async loadCore(forceRefresh: boolean): Promise<void> {
    this.isLoading = true;
    this.message = '';
    const hadLoadedOutfits = this.outfits.length > 0;
    try {
      const [lookups, outfits] = await Promise.all([
        this.lookups ? Promise.resolve(this.lookups) : this.api.getLookups().catch(() => null),
        this.api.getOutfits({ forceRefresh })
      ]);
      this.lookups = lookups;
      this.outfits = outfits;
      await this.syncFavorites();
      this.pruneSelectedOutfits();
      this.pruneFavoriteIds();
      if (this.selectedOutfit) {
        this.selectedOutfit = this.outfits.find((outfit) => outfit.id === this.selectedOutfit?.id) ?? null;
      }
      this.updateVisibleOutfits();
    } catch (error) {
      this.message = readMessage(error, 'Could not load outfits.');
      if (!hadLoadedOutfits) {
        this.outfits = [];
        this.updateVisibleOutfits();
      }
    } finally {
      this.isLoading = false;
    }
  }

  loadFavorites(): void {
    try {
      const raw = localStorage.getItem(this.FAFavoritesKey());
      if (raw) {
        const ids: string[] = JSON.parse(raw);
        this.favoriteOutfitIds = new Set(ids);
      } else {
        this.favoriteOutfitIds = new Set();
      }
    } catch {
      this.favoriteOutfitIds = new Set();
    }
  }

  saveFavorites(): void {
    try {
      localStorage.setItem(this.FAFavoritesKey(), JSON.stringify(Array.from(this.favoriteOutfitIds)));
    } catch {
      // Ignore local storage error
    }
  }

  private FAFavoritesKey(): string {
    const userId = this.auth.session?.user?.id;
    return userId ? `${this.FAVORITES_STORAGE_PREFIX}_${userId}` : this.FAVORITES_STORAGE_PREFIX;
  }

  get canChangeFavorites(): boolean {
    return this.api.isOnline && !this.isLoadingFavorites;
  }

  async syncFavorites(): Promise<void> {
    const userId = this.auth.session?.user.id;
    if (!userId || this.isLoadingFavorites || this.updatingFavoriteIds.size) return;
    if (!this.api.isOnline) {
      this.favoriteMessage = 'Favourites are available on this device. Connect to sync or change them.';
      return;
    }
    this.isLoadingFavorites = true;
    this.favoriteMessage = '';
    const storageKey = this.FAFavoritesKey();
    try {
      const favourites = await this.api.getFavourites();
      if (this.auth.session?.user.id !== userId) return;
      const ids = new Set(favourites.filter((favourite) => favourite.targetType === 'outfit').map((favourite) => favourite.targetId));
      if (localStorage.getItem(`${storageKey}_synced`) !== 'true') {
        const outfitIds = new Set(this.outfits.map((outfit) => outfit.id));
        const legacyIds = [...this.favoriteOutfitIds].filter((id) => outfitIds.has(id) && !ids.has(id));
        for (const id of legacyIds) {
          if (this.auth.session?.user.id !== userId) return;
          await this.api.setFavourite('outfit', id, true);
          ids.add(id);
        }
        if (this.auth.session?.user.id !== userId) return;
        localStorage.setItem(`${storageKey}_synced`, 'true');
      }
      if (this.auth.session?.user.id !== userId) return;
      this.favoriteOutfitIds = ids;
      this.saveFavorites();
      this.updateVisibleOutfits();
    } catch (error) {
      if (this.auth.session?.user.id === userId) {
        this.favoriteMessage = readMessage(error, 'Could not sync favourites. Your saved favourites are still on this device.');
      }
    } finally {
      this.isLoadingFavorites = false;
    }
  }

  async toggleFavorite(outfit: OutfitDto, event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.canChangeFavorites || this.updatingFavoriteIds.has(outfit.id)) return;
    const userId = this.auth.session?.user.id;
    const isFavourite = !this.favoriteOutfitIds.has(outfit.id);
    this.updatingFavoriteIds.add(outfit.id);
    this.favoriteMessage = '';
    this.updateVisibleOutfits();
    try {
      await this.api.setFavourite('outfit', outfit.id, isFavourite);
      if (this.auth.session?.user.id !== userId) return;
      if (isFavourite) this.favoriteOutfitIds.add(outfit.id);
      else this.favoriteOutfitIds.delete(outfit.id);
      this.saveFavorites();
      void lightImpact();
    } catch (error) {
      if (this.auth.session?.user.id === userId) this.favoriteMessage = readMessage(error, 'Could not update favourite.');
    } finally {
      this.updatingFavoriteIds.delete(outfit.id);
      this.updateVisibleOutfits();
    }
  }

  isFavorite(outfitId: string): boolean {
    return this.favoriteOutfitIds.has(outfitId);
  }

  formatSubcategory(subcategoryId: string | null): string {
    if (!subcategoryId) return '';
    if (this.lookups) {
      return lookupLabel(this.lookups, subcategoryId);
    }
    return subcategoryId.replace(/_/g, ' ');
  }

  viewGarmentDetail(itemId: string, event?: Event): void {
    event?.stopPropagation();
    this.close();
    void this.router.navigate(['/tabs/wardrobe', itemId]);
  }

  open(outfit: OutfitDto, event?: Event): void {
    this.clearOutfitLongPress();
    if (this.suppressNextOutfitClick) {
      event?.preventDefault();
      event?.stopPropagation();
      this.suppressNextOutfitClick = false;
      return;
    }

    if (this.isSelectionMode) {
      event?.preventDefault();
      event?.stopPropagation();
      this.toggleOutfitSelection(outfit.id);
      return;
    }

    this.selectedOutfit = outfit;
    this.cancelOutfitEdit();
    void lightImpact();
  }

  editOutfit(outfit: OutfitDto): void {
    if (this.isSavingOutfit) return;
    this.selectedOutfit = outfit;
    this.outfitForm = { name: outfit.name, explanation: outfit.explanation ?? '' };
    this.editMessage = '';
    this.isEditingOutfit = true;
  }

  cancelOutfitEdit(): void {
    if (this.isSavingOutfit) return;
    this.isEditingOutfit = false;
    this.editMessage = '';
  }

  async saveOutfit(): Promise<void> {
    if (!this.selectedOutfit || this.isSavingOutfit) return;
    const name = this.outfitForm.name.trim();
    const explanation = this.outfitForm.explanation.trim();
    if (!name || name.length > 256 || explanation.length > 2000) {
      this.editMessage = 'Enter a name of 1–256 characters and notes of up to 2000 characters.';
      return;
    }

    this.isSavingOutfit = true;
    this.editMessage = '';
    try {
      const updated = await this.api.updateOutfit(this.selectedOutfit.id, { name, explanation });
      this.outfits = this.outfits.map((outfit) => outfit.id === updated.id ? updated : outfit);
      this.selectedOutfit = updated;
      this.isEditingOutfit = false;
      this.updateVisibleOutfits();
      void successFeedback();
    } catch (error) {
      this.editMessage = readMessage(error, 'Could not save outfit. Your changes are still here.');
    } finally {
      this.isSavingOutfit = false;
    }
  }

  onCardClick(outfit: OutfitDto, event?: Event): void {
    if (this.isSelectionMode) {
      event?.preventDefault();
      event?.stopPropagation();
      this.toggleOutfitSelection(outfit.id);
    }
  }

  close(): void {
    if (this.isSavingOutfit) return;
    this.selectedOutfit = null;
    this.cancelOutfitEdit();
    this.message = '';
    void lightImpact();
  }

  async markWorn(outfit: OutfitDto): Promise<void> {
    if (this.markingOutfitIds.has(outfit.id)) return;
    this.markingOutfitIds.add(outfit.id);
    this.updateVisibleOutfits();
    try {
      await this.api.markWorn(outfit.id);
      try {
        const outfits = await this.api.getOutfits({ forceRefresh: true });
        const selectedOutfitId = this.selectedOutfit?.id ?? null;
        this.outfits = outfits;
        this.selectedOutfit = selectedOutfitId ? outfits.find((candidate) => candidate.id === selectedOutfitId) ?? null : null;
        this.updateVisibleOutfits();
      } catch {
        this.updateOutfitAfterWear(outfit.id);
      }
      void successFeedback();
      void this.showToast(`Logged wear for "${outfit.name}"!`);
    } catch (error) {
      this.message = readMessage(error, 'Could not mark outfit as worn.');
      void warningFeedback();
    } finally {
      this.markingOutfitIds.delete(outfit.id);
      this.updateVisibleOutfits();
    }
  }

  async openOutfitMenu(outfit: OutfitDto, event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    void lightImpact();

    const isFav = this.isFavorite(outfit.id);
    const actionSheet = await this.actionSheetController.create({
      header: outfit.name,
      buttons: [
        {
          text: 'Edit Outfit',
          icon: 'create-outline',
          handler: () => { this.editOutfit(outfit); }
        },
        {
          text: 'Wear This Outfit Today',
          icon: 'checkmark-circle-outline',
          handler: () => {
            void this.markWorn(outfit);
          }
        },
        {
          text: isFav ? 'Remove from Favorites' : 'Add to Favorites',
          icon: isFav ? 'heart-dislike-outline' : 'heart-outline',
          handler: () => {
            void this.toggleFavorite(outfit);
          }
        },
        {
          text: 'View Garment Details',
          icon: 'shirt-outline',
          handler: () => {
            this.open(outfit);
          }
        },
        {
          text: 'Delete Outfit',
          role: 'destructive',
          icon: 'trash-outline',
          handler: () => {
            void this.remove(outfit);
          }
        },
        {
          text: 'Cancel',
          role: 'cancel',
          icon: 'close'
        }
      ]
    });
    await actionSheet.present();
  }

  async remove(outfit: OutfitDto): Promise<void> {
    if (this.deletingOutfitIds.has(outfit.id)) {
      return;
    }

    const confirmed = await confirmAction(this.alertController, {
      title: 'Delete outfit?',
      message: `"${outfit.name}" will be removed from saved outfits. Wardrobe items stay available.`,
      confirmLabel: 'Delete outfit',
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    this.deletingOutfitIds.add(outfit.id);
    this.updateVisibleOutfits();
    try {
      await this.api.deleteOutfit(outfit.id);
      if (this.selectedOutfit?.id === outfit.id) {
        this.selectedOutfit = null;
      }
      await this.load(true);
      void successFeedback();
      void this.showToast(`Deleted "${outfit.name}".`, 'trash-outline');
    } catch (error) {
      this.message = readMessage(error, 'Could not delete outfit.');
      void warningFeedback();
    } finally {
      this.deletingOutfitIds.delete(outfit.id);
      this.updateVisibleOutfits();
    }
  }

  enterSelectionMode(): void {
    this.isSelectionMode = true;
    this.selectedOutfit = null;
    this.message = '';
    this.updateVisibleOutfits();
    void lightImpact();
  }

  cancelSelectionMode(): void {
    this.clearOutfitLongPress();
    this.isSelectionMode = false;
    this.selectedOutfitIds.clear();
    this.message = '';
    this.updateVisibleOutfits();
    void lightImpact();
  }

  clearSelection(): void {
    this.selectedOutfitIds.clear();
    this.updateVisibleOutfits();
  }

  selectVisibleOutfits(): void {
    for (const outfit of this.filteredOutfits) {
      this.selectedOutfitIds.add(outfit.id);
    }
    this.updateVisibleOutfits();
  }

  toggleOutfitSelection(outfitId: string): void {
    if (this.selectedOutfitIds.has(outfitId)) {
      this.selectedOutfitIds.delete(outfitId);
      this.updateVisibleOutfits();
      void lightImpact();
      return;
    }

    this.selectedOutfitIds.add(outfitId);
    this.updateVisibleOutfits();
    void lightImpact();
  }

  beginOutfitPress(outfit: OutfitDto): void {
    if (this.isSelectionMode || this.isLoading || this.isDeletingSelected || this.selectedOutfit) {
      return;
    }

    this.clearOutfitLongPress();
    this.outfitLongPressHandle = setTimeout(() => {
      this.outfitLongPressHandle = null;
      this.suppressNextOutfitClick = true;
      this.enterSelectionMode();
      this.selectedOutfitIds.add(outfit.id);
      this.updateVisibleOutfits();
    }, this.selectionLongPressMs);
  }

  endOutfitPress(): void {
    this.clearOutfitLongPress();
  }

  cancelOutfitPress(): void {
    this.clearOutfitLongPress();
  }

  suppressContextMenu(event: Event): void {
    if (this.isSelectionMode || this.suppressNextOutfitClick) {
      event.preventDefault();
    }
  }

  async deleteSelectedOutfits(): Promise<void> {
    if (!this.selectedOutfitIds.size || this.isDeletingSelected) {
      return;
    }

    const ids = Array.from(this.selectedOutfitIds);
    const confirmed = await confirmAction(this.alertController, {
      title: ids.length === 1 ? 'Delete selected outfit?' : 'Delete selected outfits?',
      message: ids.length === 1
        ? 'This removes 1 saved outfit. Wardrobe items stay available.'
        : `This removes ${ids.length} saved outfits. Wardrobe items stay available.`,
      confirmLabel: ids.length === 1 ? 'Delete outfit' : 'Delete outfits',
      destructive: true
    });
    if (!confirmed) {
      return;
    }

    this.isDeletingSelected = true;
    try {
      const result = await this.api.deleteOutfits(ids);
      this.selectedOutfitIds.clear();
      this.isSelectionMode = false;
      await this.load(true);
      void successFeedback();
      void this.showToast(result.deletedCount === 1 ? 'Deleted 1 outfit.' : `Deleted ${result.deletedCount} outfits.`, 'trash-outline');
    } catch (error) {
      this.message = readMessage(error, 'Could not delete selected outfits.');
      void warningFeedback();
    } finally {
      this.isDeletingSelected = false;
      this.updateVisibleOutfits();
    }
  }

  trackById(_: number, outfit: OutfitDto): string {
    return outfit.id;
  }

  trackByCardId(_: number, card: OutfitCard): string {
    return card.outfit.id;
  }

  trackByOutfitItemId(_: number, item: OutfitDto['items'][number]): string {
    return item.id;
  }

  trackByValue(_: number, value: string | number): string | number {
    return value;
  }

  outfitItemImageUrl(item: OutfitDto['items'][number]): string {
    return item.image.thumbnailUrl || item.image.displayUrl;
  }

  private async showToast(message: string, icon = 'checkmark-circle-outline'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2200,
      position: 'bottom',
      icon,
      cssClass: 'ios-toast'
    });
    await toast.present();
  }

  private updateOutfitAfterWear(outfitId: string): void {
    const now = new Date().toISOString();
    this.outfits = this.outfits.map((candidate) => candidate.id === outfitId
      ? {
          ...candidate,
          wearCount: candidate.wearCount + 1,
          lastWornAt: now,
          updatedAt: now
        }
      : candidate);
    if (this.selectedOutfit?.id === outfitId) {
      this.selectedOutfit = this.outfits.find((candidate) => candidate.id === outfitId) ?? null;
    }
    this.updateVisibleOutfits();
  }

  private pruneSelectedOutfits(): void {
    if (!this.selectedOutfitIds.size) {
      return;
    }

    const visibleIds = new Set(this.outfits.map((outfit) => outfit.id));
    this.selectedOutfitIds = new Set(Array.from(this.selectedOutfitIds).filter((id) => visibleIds.has(id)));
    if (this.isSelectionMode && !this.selectedOutfitIds.size) {
      this.isSelectionMode = false;
    }
    this.updateVisibleOutfits();
  }

  private pruneFavoriteIds(): void {
    if (!this.favoriteOutfitIds.size || !this.outfits.length) {
      return;
    }
    const activeOutfitIds = new Set(this.outfits.map((o) => o.id));
    let changed = false;
    for (const id of this.favoriteOutfitIds) {
      if (!activeOutfitIds.has(id)) {
        this.favoriteOutfitIds.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.saveFavorites();
    }
  }

  resetFilters(): void {
    this.outfitSearch = '';
    this.setOutfitFilter('all');
  }

  updateVisibleOutfits(): void {
    this.visibleOutfits = this.filteredOutfits.slice(0, this.visibleOutfitCount).map((outfit) => {
      const isMarking = this.markingOutfitIds.has(outfit.id);
      const isRemoving = this.deletingOutfitIds.has(outfit.id);
      return {
        outfit,
        imageUrl: outfit.thumbnailUrl || outfit.imageUrl,
        isSelected: this.selectedOutfitIds.has(outfit.id),
        isMarking,
        isRemoving,
        isFavorite: this.favoriteOutfitIds.has(outfit.id),
        isFavoriting: this.updatingFavoriteIds.has(outfit.id),
        actionMessage: isMarking
          ? `Marking "${outfit.name}" as worn...`
          : isRemoving
            ? `Deleting "${outfit.name}"...`
            : ''
      };
    });
  }

  private clearOutfitLongPress(): void {
    if (this.outfitLongPressHandle) {
      clearTimeout(this.outfitLongPressHandle);
    }
    this.outfitLongPressHandle = null;
  }
}
