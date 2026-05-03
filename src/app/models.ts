export interface AuthUserDto {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUserDto;
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
  image: WardrobeItemImageDto;
  createdAt: string;
  updatedAt: string;
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
}

export interface OutfitDto {
  id: string;
  name: string;
  prompt: string | null;
  explanation: string | null;
  items: WardrobeItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiMessage {
  message?: string;
}
