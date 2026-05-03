namespace WardrobeAi.Api;

public sealed record RegisterRequest(string Email, string Password, string? DisplayName);
public sealed record LoginRequest(string Email, string Password);
public sealed record AuthUserDto(Guid Id, string Email, string DisplayName);
public sealed record AuthResponse(string AccessToken, AuthUserDto User);

public sealed record LookupOptionDto(string Id, string Label);
public sealed record WardrobeCategoryLookupDto(string Id, string Label, IReadOnlyList<LookupOptionDto> Subcategories);
public sealed record WardrobeLookupsDto(
    IReadOnlyList<WardrobeCategoryLookupDto> Categories,
    IReadOnlyList<LookupOptionDto> Colours,
    IReadOnlyList<LookupOptionDto> Patterns,
    IReadOnlyList<LookupOptionDto> VisibleMaterials,
    IReadOnlyList<LookupOptionDto> Necklines,
    IReadOnlyList<LookupOptionDto> SleeveLengths,
    IReadOnlyList<LookupOptionDto> Fits,
    IReadOnlyList<LookupOptionDto> GarmentLengths,
    IReadOnlyList<LookupOptionDto> BottomShapes,
    IReadOnlyList<LookupOptionDto> Rises,
    IReadOnlyList<LookupOptionDto> Occasions,
    IReadOnlyList<LookupOptionDto> Formalities);

public sealed record WardrobeItemImageDto(string OriginalUrl, string DisplayUrl, string? CanonicalUrl, string? ThumbnailUrl);

public sealed record WardrobeItemDto(
    Guid Id,
    string Name,
    string CategoryId,
    string SubcategoryId,
    string PrimaryColourId,
    IReadOnlyList<string> SecondaryColourIds,
    string? PatternId,
    string? VisibleMaterialId,
    string? NecklineId,
    string? SleeveLengthId,
    string? FitId,
    string? LengthId,
    string? BottomShapeId,
    string? RiseId,
    WardrobeItemImageDto Image,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record CreateWardrobeItemResponse(WardrobeItemDto Item);
public sealed record GetWardrobeItemsResponse(IReadOnlyList<WardrobeItemDto> Items);
public sealed record UpdateWardrobeItemResponse(WardrobeItemDto Item);

public sealed class UpdateWardrobeItemRequest
{
    public string Name { get; set; } = string.Empty;
    public string CategoryId { get; set; } = string.Empty;
    public string SubcategoryId { get; set; } = string.Empty;
    public string PrimaryColourId { get; set; } = string.Empty;
    public List<string> SecondaryColourIds { get; set; } = [];
    public string? PatternId { get; set; }
    public string? VisibleMaterialId { get; set; }
    public string? NecklineId { get; set; }
    public string? SleeveLengthId { get; set; }
    public string? FitId { get; set; }
    public string? LengthId { get; set; }
    public string? BottomShapeId { get; set; }
    public string? RiseId { get; set; }
}

public sealed record SearchOutfitsRequest(string Query, Guid? RequiredItemId);
public sealed record GeneratedOutfitDto(string Title, IReadOnlyList<Guid> ItemIds, string Explanation);
public sealed record SearchOutfitsResponse(IReadOnlyList<GeneratedOutfitDto> Outfits);
public sealed record CreateOutfitRequest(string Name, string? Prompt, string? Explanation, IReadOnlyList<Guid> ItemIds);
public sealed record OutfitDto(Guid Id, string Name, string? Prompt, string? Explanation, IReadOnlyList<WardrobeItemDto> Items, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record GetOutfitsResponse(IReadOnlyList<OutfitDto> Outfits);
public sealed record CreateOutfitResponse(OutfitDto Outfit);
public sealed record WearLogDto(Guid Id, Guid? OutfitId, Guid? WardrobeItemId, DateTimeOffset WornAt);

public sealed class ClassifiedWardrobeItem
{
    public string Name { get; set; } = string.Empty;
    public string CategoryId { get; set; } = string.Empty;
    public string SubcategoryId { get; set; } = string.Empty;
    public string PrimaryColourId { get; set; } = string.Empty;
    public List<string> SecondaryColourIds { get; set; } = [];
    public string? PatternId { get; set; }
    public string? VisibleMaterialId { get; set; }
    public string? NecklineId { get; set; }
    public string? SleeveLengthId { get; set; }
    public string? FitId { get; set; }
    public string? LengthId { get; set; }
    public string? BottomShapeId { get; set; }
    public string? RiseId { get; set; }
    public string? InputIssue { get; set; }
}

public sealed record OutfitComfortIntent(bool NoHeels, bool Walkable, bool WarmWeather, bool ColdWeather, bool Modest);

public sealed record OutfitSearchIntent(
    string? OccasionId,
    string? FormalityId,
    Guid? RequiredItemId,
    IReadOnlyList<string> IncludeCategoryIds,
    IReadOnlyList<string> ExcludeCategoryIds,
    IReadOnlyList<string> ExcludeSubcategoryIds,
    IReadOnlyList<string> PreferredColourIds,
    IReadOnlyList<string> AvoidedColourIds,
    OutfitComfortIntent Comfort,
    int OutfitCount);

public sealed record OutfitCandidate(IReadOnlyList<Guid> ItemIds, int Score, IReadOnlyList<string> ScoreReasons);
public sealed record GeneratedImage(Stream Stream, string ContentType);

public sealed class WardrobeAiOptions
{
    public const string SectionName = "WardrobeAi";
    public string JwtIssuer { get; set; } = "WardrobeAi";
    public string JwtAudience { get; set; } = "WardrobeAi.App";
    public string JwtSigningKey { get; set; } = "local-development-signing-key-change-before-production";
    public string ImageSigningKey { get; set; } = "local-development-image-key-change-before-production";
    public string StorageRoot { get; set; } = "storage/images";
    public string? OpenAiApiKey { get; set; }
    public string OpenAiModel { get; set; } = "gpt-5.4-mini";
    public string OpenAiImageModel { get; set; } = "gpt-image-2";
    public bool EnsureDatabaseCreatedOnStartup { get; set; } = true;
    public bool SeedDevelopmentUser { get; set; } = true;
    public string SeedUserEmail { get; set; } = "test@admin.com";
    public string SeedUserPassword { get; set; } = "Password123!";
    public string SeedUserDisplayName { get; set; } = "Wardrobe Admin";
    public string[] CorsOrigins { get; set; } =
    [
        "http://localhost:4200",
        "https://localhost:4200",
        "http://localhost:8100",
        "https://localhost:8100",
        "capacitor://localhost",
        "ionic://localhost"
    ];
}
