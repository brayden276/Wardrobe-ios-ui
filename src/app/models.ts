export interface AuthUserDto {
  id: string;
  email: string;
  displayName: string;
  provider?: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: string;
  user: AuthUserDto;
}

export interface AuthProviderDto {
  provider: string;
  enabled: boolean;
  clientId: string;
}

export interface LookupOptionDto {
  id: string;
  label: string;
}

export interface WardrobeCategoryLookupDto extends LookupOptionDto {
  subcategories: LookupOptionDto[];
}

export interface WardrobeLookupsDto {
  categories: WardrobeCategoryLookupDto[];
  colours: LookupOptionDto[];
  patterns: LookupOptionDto[];
  visibleMaterials: LookupOptionDto[];
  necklines: LookupOptionDto[];
  sleeveLengths: LookupOptionDto[];
  fits: LookupOptionDto[];
  garmentLengths: LookupOptionDto[];
  bottomShapes: LookupOptionDto[];
  rises: LookupOptionDto[];
  occasions: LookupOptionDto[];
  formalities: LookupOptionDto[];
}

export interface WardrobeItemImageDto {
  originalUrl: string;
  displayUrl: string;
  canonicalUrl: string | null;
  thumbnailUrl: string | null;
}

export interface WardrobeItemDto {
  id: string;
  name: string;
  categoryId: string;
  subcategoryId: string;
  primaryColourId: string;
  secondaryColourIds: string[];
  patternId: string | null;
  visibleMaterialId: string | null;
  necklineId: string | null;
  sleeveLengthId: string | null;
  fitId: string | null;
  lengthId: string | null;
  bottomShapeId: string | null;
  riseId: string | null;
  isArchived: boolean;
  wearCount: number;
  lastWornAt: string | null;
  image: WardrobeItemImageDto;
  imageGenerationStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageGenerationStreamUpdate {
  kind: 'item' | 'outfit';
  id: string;
  status: string | null;
}

export interface WardrobeItemUploadResultDto {
  fileName: string;
  success: boolean;
  item: WardrobeItemDto | null;
  error: string | null;
}

export interface BatchWardrobeItemsResponse {
  results: WardrobeItemUploadResultDto[];
  succeededCount: number;
  failedCount: number;
}

export interface UpdateWardrobeItemRequest {
  name: string;
  categoryId: string;
  subcategoryId: string;
  primaryColourId: string;
  secondaryColourIds: string[];
  patternId: string | null;
  visibleMaterialId: string | null;
  necklineId: string | null;
  sleeveLengthId: string | null;
  fitId: string | null;
  lengthId: string | null;
  bottomShapeId: string | null;
  riseId: string | null;
}

export interface GeneratedOutfitDto {
  title: string;
  itemIds: string[];
  explanation: string;
  imageUrl: string | null;
}

export interface OutfitDto {
  id: string;
  name: string;
  prompt: string | null;
  explanation: string | null;
  imageUrl: string | null;
  imageGenerationStatus: string | null;
  items: WardrobeItemDto[];
  wearCount: number;
  lastWornAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiUsageCostSummaryDto {
  totalCostUsd: number;
  wardrobeItemClassifications: number;
  outfitSearches: number;
  displayImages: number;
  outfitImages: number;
}

export interface ApiMessage {
  message?: string;
}
