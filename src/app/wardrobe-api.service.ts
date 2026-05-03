import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './auth.service';
import {
  GeneratedOutfitDto,
  OutfitDto,
  UpdateWardrobeItemRequest,
  WardrobeItemDto,
  WardrobeLookupsDto
} from './models';

@Injectable({ providedIn: 'root' })
export class WardrobeApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  async getLookups(): Promise<WardrobeLookupsDto> {
    return firstValueFrom(this.http.get<WardrobeLookupsDto>(this.url('/api/lookups/wardrobe'), this.authOptions()));
  }

  async getItems(params: Record<string, string> = {}): Promise<WardrobeItemDto[]> {
    const query = new URLSearchParams(params).toString();
    const response = await firstValueFrom(this.http.get<{ items: WardrobeItemDto[] }>(this.url(`/api/wardrobe/items${query ? `?${query}` : ''}`), this.authOptions()));
    return response.items;
  }

  async getItem(id: string): Promise<WardrobeItemDto> {
    return firstValueFrom(this.http.get<WardrobeItemDto>(this.url(`/api/wardrobe/items/${id}`), this.authOptions()));
  }

  async createItem(image: Blob, fileName: string): Promise<WardrobeItemDto> {
    const body = new FormData();
    body.append('image', image, fileName);
    const response = await firstValueFrom(this.http.post<{ item: WardrobeItemDto }>(this.url('/api/wardrobe/items'), body, this.authOptions()));
    return response.item;
  }

  async updateItem(id: string, request: UpdateWardrobeItemRequest): Promise<WardrobeItemDto> {
    const response = await firstValueFrom(this.http.put<{ item: WardrobeItemDto }>(this.url(`/api/wardrobe/items/${id}`), request, this.authOptions()));
    return response.item;
  }

  async deleteItem(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.url(`/api/wardrobe/items/${id}`), this.authOptions()));
  }

  async searchOutfits(query: string, requiredItemId: string | null = null): Promise<GeneratedOutfitDto[]> {
    const response = await firstValueFrom(this.http.post<{ outfits: GeneratedOutfitDto[] }>(this.url('/api/outfits/search'), { query, requiredItemId }, this.authOptions()));
    return response.outfits;
  }

  async saveOutfit(name: string, prompt: string | null, explanation: string | null, itemIds: string[]): Promise<OutfitDto> {
    const response = await firstValueFrom(this.http.post<{ outfit: OutfitDto }>(this.url('/api/outfits'), { name, prompt, explanation, itemIds }, this.authOptions()));
    return response.outfit;
  }

  async getOutfits(): Promise<OutfitDto[]> {
    const response = await firstValueFrom(this.http.get<{ outfits: OutfitDto[] }>(this.url('/api/outfits'), this.authOptions()));
    return response.outfits;
  }

  async deleteOutfit(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.url(`/api/outfits/${id}`), this.authOptions()));
  }

  async markWorn(id: string): Promise<void> {
    await firstValueFrom(this.http.post(this.url(`/api/outfits/${id}/wear-logs`), {}, this.authOptions()));
  }

  private url(path: string): string {
    return `${environment.apiBaseUrl}${path}`;
  }

  private authOptions(): { headers: HttpHeaders } {
    return { headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token ?? ''}` }) };
  }
}
