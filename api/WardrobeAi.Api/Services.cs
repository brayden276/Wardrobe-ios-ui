using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace WardrobeAi.Api;

public interface ICurrentUserAccessor
{
    Guid UserId { get; }
}

public sealed class CurrentUserAccessor(IHttpContextAccessor accessor) : ICurrentUserAccessor
{
    public Guid UserId
    {
        get
        {
            var value = accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
            return Guid.TryParse(value, out var id) ? id : throw new UnauthorizedAccessException();
        }
    }
}

public interface IPasswordService
{
    string Hash(string password);
    bool Verify(string hash, string password);
}

public sealed class PasswordService : IPasswordService
{
    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 120_000, HashAlgorithmName.SHA256, 32);
        return $"{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public bool Verify(string hash, string password)
    {
        try
        {
            var parts = hash.Split('.');
            if (parts.Length != 2)
            {
                return false;
            }

            var salt = Convert.FromBase64String(parts[0]);
            var expected = Convert.FromBase64String(parts[1]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, 120_000, HashAlgorithmName.SHA256, 32);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }
}

public interface IJwtTokenService
{
    string Create(AppUser user);
}

public sealed class JwtTokenService(IOptions<WardrobeAiOptions> options) : IJwtTokenService
{
    public string Create(AppUser user)
    {
        var config = options.Value;
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config.JwtSigningKey)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            config.JwtIssuer,
            config.JwtAudience,
            [new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), new Claim(ClaimTypes.Email, user.Email)],
            expires: DateTime.UtcNow.AddDays(14),
            signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public interface IImageStorageService
{
    Task<string> SaveOriginalAsync(Guid userId, Guid itemId, IFormFile file, CancellationToken cancellationToken);
    Task<string> SaveCanonicalAsync(Guid userId, Guid itemId, Stream source, string contentType, CancellationToken cancellationToken);
    Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken);
}

public sealed class LocalImageStorageService(IOptions<WardrobeAiOptions> options) : IImageStorageService
{
    private readonly string root = Path.GetFullPath(options.Value.StorageRoot);

    public async Task<string> SaveOriginalAsync(Guid userId, Guid itemId, IFormFile file, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(extension))
        {
            extension = ".jpg";
        }

        var key = $"{userId}/original/{itemId}{extension.ToLowerInvariant()}";
        await using var output = File.Create(PathForKey(key));
        await file.CopyToAsync(output, cancellationToken);
        return key;
    }

    public async Task<string> SaveCanonicalAsync(Guid userId, Guid itemId, Stream source, string contentType, CancellationToken cancellationToken)
    {
        var extension = contentType.Equals("image/png", StringComparison.OrdinalIgnoreCase) ? ".png" : ".jpg";
        var key = $"{userId}/canonical/{itemId}{extension}";
        await using var output = File.Create(PathForKey(key));
        source.Position = 0;
        await source.CopyToAsync(output, cancellationToken);
        return key;
    }

    public Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        return Task.FromResult((Stream)File.OpenRead(PathForKey(key)));
    }

    private string PathForKey(string key)
    {
        var path = Path.GetFullPath(Path.Combine(root, key.Replace('/', Path.DirectorySeparatorChar)));
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Invalid image key.");
        }

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        return path;
    }
}

public interface IImageUrlSigner
{
    string Sign(string key);
    bool Validate(string key, long expires, string signature);
}

public sealed class ImageUrlSigner(IOptions<WardrobeAiOptions> options, IHttpContextAccessor accessor) : IImageUrlSigner
{
    public string Sign(string key)
    {
        var expires = DateTimeOffset.UtcNow.AddHours(12).ToUnixTimeSeconds();
        var signature = Signature(key, expires);
        var request = accessor.HttpContext?.Request;
        var prefix = request is null ? string.Empty : $"{request.Scheme}://{request.Host}";
        return $"{prefix}/api/images?key={Uri.EscapeDataString(key)}&expires={expires}&signature={Uri.EscapeDataString(signature)}";
    }

    public bool Validate(string key, long expires, string signature)
    {
        if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() > expires)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(Signature(key, expires)), Encoding.UTF8.GetBytes(signature));
    }

    private string Signature(string key, long expires)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(options.Value.ImageSigningKey));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{key}:{expires}")));
    }
}

public interface IWardrobeAiService
{
    Task<ClassifiedWardrobeItem> ClassifyItemAsync(Stream imageStream, CancellationToken cancellationToken);
    Task<GeneratedImage?> GenerateCanonicalImageAsync(Stream imageStream, WardrobeItem item, CancellationToken cancellationToken);
    Task<OutfitSearchIntent> ParseOutfitSearchAsync(string query, Guid? requiredItemId, CancellationToken cancellationToken);
    Task<IReadOnlyList<GeneratedOutfitDto>> RankAndExplainOutfitsAsync(OutfitSearchIntent intent, IReadOnlyList<OutfitCandidate> candidates, IReadOnlyList<WardrobeItem> items, CancellationToken cancellationToken);
}

public sealed class FakeWardrobeAiService : IWardrobeAiService
{
    private static readonly ClassifiedWardrobeItem[] DemoClassifications =
    [
        new()
        {
            Name = "Black jeans",
            CategoryId = "bottoms",
            SubcategoryId = "jeans",
            PrimaryColourId = "black",
            PatternId = "solid",
            VisibleMaterialId = "denim",
            BottomShapeId = "straight",
            RiseId = "mid"
        },
        new()
        {
            Name = "Cream cami",
            CategoryId = "tops",
            SubcategoryId = "cami",
            PrimaryColourId = "cream",
            PatternId = "solid",
            SleeveLengthId = "spaghetti_strap",
            FitId = "regular",
            LengthId = "hip_length"
        },
        new()
        {
            Name = "White sneakers",
            CategoryId = "footwear",
            SubcategoryId = "sneakers",
            PrimaryColourId = "white",
            PatternId = "solid"
        },
        new()
        {
            Name = "Sage blazer",
            CategoryId = "outerwear",
            SubcategoryId = "blazer",
            PrimaryColourId = "green",
            PatternId = "solid",
            FitId = "regular",
            LengthId = "hip_length"
        },
        new()
        {
            Name = "Tan tote bag",
            CategoryId = "bags",
            SubcategoryId = "tote_bag",
            PrimaryColourId = "beige",
            PatternId = "solid"
        }
    ];

    public async Task<ClassifiedWardrobeItem> ClassifyItemAsync(Stream imageStream, CancellationToken cancellationToken)
    {
        var sample = DemoClassifications[(int)(imageStream.Length % DemoClassifications.Length)];
        await Task.CompletedTask;
        return new ClassifiedWardrobeItem
        {
            Name = sample.Name,
            CategoryId = sample.CategoryId,
            SubcategoryId = sample.SubcategoryId,
            PrimaryColourId = sample.PrimaryColourId,
            SecondaryColourIds = sample.SecondaryColourIds.ToList(),
            PatternId = sample.PatternId,
            VisibleMaterialId = sample.VisibleMaterialId,
            NecklineId = sample.NecklineId,
            SleeveLengthId = sample.SleeveLengthId,
            FitId = sample.FitId,
            LengthId = sample.LengthId,
            BottomShapeId = sample.BottomShapeId,
            RiseId = sample.RiseId
        };
    }

    public async Task<GeneratedImage?> GenerateCanonicalImageAsync(Stream imageStream, WardrobeItem item, CancellationToken cancellationToken)
    {
        var copy = new MemoryStream();
        imageStream.Position = 0;
        await imageStream.CopyToAsync(copy, cancellationToken);
        copy.Position = 0;
        return new GeneratedImage(copy, item.OriginalImageContentType);
    }

    public Task<OutfitSearchIntent> ParseOutfitSearchAsync(string query, Guid? requiredItemId, CancellationToken cancellationToken)
    {
        var lower = query.ToLowerInvariant();
        var noHeels = lower.Contains("no heels", StringComparison.Ordinal);
        var occasion = lower.Contains("work", StringComparison.Ordinal) ? "work" : lower.Contains("dinner", StringComparison.Ordinal) ? "smart_casual" : null;
        return Task.FromResult(new OutfitSearchIntent(
            occasion,
            lower.Contains("formal", StringComparison.Ordinal) ? "5" : lower.Contains("smart casual", StringComparison.Ordinal) ? "3" : null,
            requiredItemId,
            [],
            [],
            noHeels ? ["heels"] : [],
            [],
            [],
            new OutfitComfortIntent(noHeels, lower.Contains("walk", StringComparison.Ordinal), false, false, false),
            3));
    }

    public Task<IReadOnlyList<GeneratedOutfitDto>> RankAndExplainOutfitsAsync(OutfitSearchIntent intent, IReadOnlyList<OutfitCandidate> candidates, IReadOnlyList<WardrobeItem> items, CancellationToken cancellationToken)
    {
        var results = candidates
            .OrderByDescending(x => x.Score)
            .Take(Math.Clamp(intent.OutfitCount, 1, 3))
            .Select((candidate, index) => new GeneratedOutfitDto(index == 0 ? "Dinner in denim" : $"Outfit {index + 1}", candidate.ItemIds, "Uses pieces from your wardrobe while respecting the request."))
            .ToList();
        return Task.FromResult<IReadOnlyList<GeneratedOutfitDto>>(results);
    }
}

public sealed class WardrobeClassificationNormaliser
{
    public ClassifiedWardrobeItem Normalise(ClassifiedWardrobeItem item)
    {
        if (item.SubcategoryId == "jeans")
        {
            item.CategoryId = "bottoms";
            item.VisibleMaterialId ??= "denim";
        }

        if (item.CategoryId is "footwear" or "bags" or "accessories")
        {
            item.NecklineId = null;
            item.SleeveLengthId = null;
            item.BottomShapeId = null;
            item.RiseId = null;
        }

        if (item.CategoryId != "bottoms")
        {
            item.BottomShapeId = null;
            item.RiseId = null;
        }

        if (item.CategoryId is not ("tops" or "dresses" or "outerwear" or "knitwear"))
        {
            item.NecklineId = null;
            item.SleeveLengthId = null;
        }

        if (!LookupCatalog.IsCategory(item.CategoryId) || !LookupCatalog.IsSubcategory(item.CategoryId, item.SubcategoryId) || !LookupCatalog.IsColour(item.PrimaryColourId))
        {
            item.InputIssue = "not_clothing_or_accessory";
        }

        return item;
    }
}

public static class WardrobeMapper
{
    public static WardrobeItemDto ToDto(this WardrobeItem item, IImageUrlSigner signer)
    {
        var original = signer.Sign(item.OriginalImageKey);
        var canonical = item.CanonicalImageKey is null ? null : signer.Sign(item.CanonicalImageKey);
        var thumbnail = item.ThumbnailImageKey is null ? null : signer.Sign(item.ThumbnailImageKey);
        return new WardrobeItemDto(
            item.Id,
            item.Name,
            item.CategoryId,
            item.SubcategoryId,
            item.PrimaryColourId,
            item.SecondaryColourIds,
            item.PatternId,
            item.VisibleMaterialId,
            item.NecklineId,
            item.SleeveLengthId,
            item.FitId,
            item.LengthId,
            item.BottomShapeId,
            item.RiseId,
            new WardrobeItemImageDto(original, canonical ?? original, canonical, thumbnail),
            item.CreatedAt,
            item.UpdatedAt);
    }
}

public interface IWardrobeService
{
    Task<WardrobeItemDto> CreateAsync(Guid userId, IFormFile image, CancellationToken cancellationToken);
    Task<IReadOnlyList<WardrobeItemDto>> FindAllAsync(Guid userId, string? categoryId, string? subcategoryId, string? colourId, string? patternId, string? search, bool includeArchived, CancellationToken cancellationToken);
    Task<WardrobeItemDto?> FindByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken);
    Task<WardrobeItemDto?> UpdateAsync(Guid userId, Guid id, UpdateWardrobeItemRequest request, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken);
}

public sealed class WardrobeService(WardrobeDbContext db, IWardrobeAiService ai, IImageStorageService storage, WardrobeClassificationNormaliser normaliser, IImageUrlSigner signer) : IWardrobeService
{
    public async Task<WardrobeItemDto> CreateAsync(Guid userId, IFormFile image, CancellationToken cancellationToken)
    {
        if (image.Length <= 0 || image.Length > 10 * 1024 * 1024 || !image.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Could not upload item. Try again.");
        }

        await using var stream = image.OpenReadStream();
        var classification = normaliser.Normalise(await ai.ClassifyItemAsync(stream, cancellationToken));
        if (classification.InputIssue is not null)
        {
            throw new InvalidOperationException("Place one item flat on a plain surface and retake the photo.");
        }

        var item = new WardrobeItem
        {
            UserId = userId,
            Name = classification.Name,
            CategoryId = classification.CategoryId,
            SubcategoryId = classification.SubcategoryId,
            PrimaryColourId = classification.PrimaryColourId,
            SecondaryColourIds = classification.SecondaryColourIds,
            PatternId = classification.PatternId,
            VisibleMaterialId = classification.VisibleMaterialId,
            NecklineId = classification.NecklineId,
            SleeveLengthId = classification.SleeveLengthId,
            FitId = classification.FitId,
            LengthId = classification.LengthId,
            BottomShapeId = classification.BottomShapeId,
            RiseId = classification.RiseId
        };

        item.OriginalImageKey = await storage.SaveOriginalAsync(userId, item.Id, image, cancellationToken);
        item.OriginalImageContentType = image.ContentType;
        db.WardrobeItems.Add(item);
        db.CanonicalImageJobs.Add(new CanonicalImageJob { WardrobeItemId = item.Id });
        await db.SaveChangesAsync(cancellationToken);
        return item.ToDto(signer);
    }

    public async Task<IReadOnlyList<WardrobeItemDto>> FindAllAsync(Guid userId, string? categoryId, string? subcategoryId, string? colourId, string? patternId, string? search, bool includeArchived, CancellationToken cancellationToken)
    {
        var query = db.WardrobeItems.AsNoTracking().Where(x => x.UserId == userId);
        if (!includeArchived)
        {
            query = query.Where(x => !x.IsArchived);
        }

        if (!string.IsNullOrWhiteSpace(categoryId)) query = query.Where(x => x.CategoryId == categoryId);
        if (!string.IsNullOrWhiteSpace(subcategoryId)) query = query.Where(x => x.SubcategoryId == subcategoryId);
        if (!string.IsNullOrWhiteSpace(colourId)) query = query.Where(x => x.PrimaryColourId == colourId || x.SecondaryColourIds.Contains(colourId));
        if (!string.IsNullOrWhiteSpace(patternId)) query = query.Where(x => x.PatternId == patternId);
        if (!string.IsNullOrWhiteSpace(search)) query = query.Where(x => EF.Functions.ILike(x.Name, $"%{search}%"));

        return await query.OrderByDescending(x => x.CreatedAt).Select(x => x.ToDto(signer)).ToListAsync(cancellationToken);
    }

    public async Task<WardrobeItemDto?> FindByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken) =>
        (await db.WardrobeItems.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == userId && x.Id == id && !x.IsArchived, cancellationToken))?.ToDto(signer);

    public async Task<WardrobeItemDto?> UpdateAsync(Guid userId, Guid id, UpdateWardrobeItemRequest request, CancellationToken cancellationToken)
    {
        var item = await db.WardrobeItems.FirstOrDefaultAsync(x => x.UserId == userId && x.Id == id && !x.IsArchived, cancellationToken);
        if (item is null)
        {
            return null;
        }

        item.Name = request.Name.Trim();
        item.CategoryId = request.CategoryId;
        item.SubcategoryId = request.SubcategoryId;
        item.PrimaryColourId = request.PrimaryColourId;
        item.SecondaryColourIds = request.SecondaryColourIds;
        item.PatternId = request.PatternId;
        item.VisibleMaterialId = request.VisibleMaterialId;
        item.NecklineId = request.NecklineId;
        item.SleeveLengthId = request.SleeveLengthId;
        item.FitId = request.FitId;
        item.LengthId = request.LengthId;
        item.BottomShapeId = request.BottomShapeId;
        item.RiseId = request.RiseId;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return item.ToDto(signer);
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken)
    {
        var item = await db.WardrobeItems.FirstOrDefaultAsync(x => x.UserId == userId && x.Id == id && !x.IsArchived, cancellationToken);
        if (item is null)
        {
            return false;
        }

        item.IsArchived = true;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
