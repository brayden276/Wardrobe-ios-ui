using Microsoft.EntityFrameworkCore;

namespace WardrobeAi.Api;

public interface IOutfitService
{
    Task<IReadOnlyList<GeneratedOutfitDto>> SearchAsync(Guid userId, SearchOutfitsRequest request, CancellationToken cancellationToken);
    Task<IReadOnlyList<OutfitDto>> FindAllAsync(Guid userId, CancellationToken cancellationToken);
    Task<OutfitDto?> FindByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken);
    Task<OutfitDto> CreateAsync(Guid userId, CreateOutfitRequest request, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken);
    Task<WearLogDto?> MarkWornAsync(Guid userId, Guid id, CancellationToken cancellationToken);
}

public sealed class OutfitService(WardrobeDbContext db, IWardrobeAiService ai, IImageUrlSigner signer) : IOutfitService
{
    public async Task<IReadOnlyList<GeneratedOutfitDto>> SearchAsync(Guid userId, SearchOutfitsRequest request, CancellationToken cancellationToken)
    {
        var intent = await ai.ParseOutfitSearchAsync(request.Query, request.RequiredItemId, cancellationToken);
        var items = await db.WardrobeItems.AsNoTracking().Where(x => x.UserId == userId && !x.IsArchived).ToListAsync(cancellationToken);
        var candidates = GenerateCandidates(intent, items);
        return await ai.RankAndExplainOutfitsAsync(intent, candidates, items, cancellationToken);
    }

    public async Task<IReadOnlyList<OutfitDto>> FindAllAsync(Guid userId, CancellationToken cancellationToken)
    {
        var outfits = await db.Outfits.AsNoTracking()
            .Include(x => x.Items.OrderBy(i => i.SortOrder))
            .ThenInclude(x => x.WardrobeItem)
            .Where(x => x.UserId == userId)
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync(cancellationToken);
        return outfits.Select(Map).ToList();
    }

    public async Task<OutfitDto?> FindByIdAsync(Guid userId, Guid id, CancellationToken cancellationToken)
    {
        var outfit = await db.Outfits.AsNoTracking()
            .Include(x => x.Items.OrderBy(i => i.SortOrder))
            .ThenInclude(x => x.WardrobeItem)
            .FirstOrDefaultAsync(x => x.UserId == userId && x.Id == id, cancellationToken);
        return outfit is null ? null : Map(outfit);
    }

    public async Task<OutfitDto> CreateAsync(Guid userId, CreateOutfitRequest request, CancellationToken cancellationToken)
    {
        var items = await db.WardrobeItems.Where(x => x.UserId == userId && !x.IsArchived && request.ItemIds.Contains(x.Id)).ToListAsync(cancellationToken);
        if (items.Count != request.ItemIds.Distinct().Count())
        {
            throw new InvalidOperationException("Outfit contains unavailable wardrobe items.");
        }

        var outfit = new Outfit
        {
            UserId = userId,
            Name = request.Name.Trim(),
            Prompt = request.Prompt,
            Explanation = request.Explanation,
            Items = request.ItemIds.Select((id, index) => new OutfitItem { WardrobeItemId = id, SortOrder = index }).ToList()
        };
        db.Outfits.Add(outfit);
        await db.SaveChangesAsync(cancellationToken);
        return (await FindByIdAsync(userId, outfit.Id, cancellationToken))!;
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken)
    {
        var outfit = await db.Outfits.FirstOrDefaultAsync(x => x.UserId == userId && x.Id == id, cancellationToken);
        if (outfit is null)
        {
            return false;
        }

        db.Outfits.Remove(outfit);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<WearLogDto?> MarkWornAsync(Guid userId, Guid id, CancellationToken cancellationToken)
    {
        var exists = await db.Outfits.AnyAsync(x => x.UserId == userId && x.Id == id, cancellationToken);
        if (!exists)
        {
            return null;
        }

        var log = new WearLog { UserId = userId, OutfitId = id };
        db.WearLogs.Add(log);
        await db.SaveChangesAsync(cancellationToken);
        return new WearLogDto(log.Id, log.OutfitId, log.WardrobeItemId, log.WornAt);
    }

    private IReadOnlyList<OutfitCandidate> GenerateCandidates(OutfitSearchIntent intent, IReadOnlyList<WardrobeItem> items)
    {
        var available = items
            .Where(x => intent.ExcludeCategoryIds.All(excluded => x.CategoryId != excluded))
            .Where(x => intent.ExcludeSubcategoryIds.All(excluded => x.SubcategoryId != excluded))
            .ToList();

        var groups = available.GroupBy(x => x.CategoryId).ToDictionary(x => x.Key, x => x.ToList());
        var candidates = new List<OutfitCandidate>();
        AddTemplate(candidates, intent, Pick(groups, "tops"), Pick(groups, "bottoms"), Pick(groups, "footwear"));
        AddTemplate(candidates, intent, Pick(groups, "tops"), Pick(groups, "bottoms"), Pick(groups, "outerwear"), Pick(groups, "footwear"));
        AddTemplate(candidates, intent, Pick(groups, "dresses"), Pick(groups, "footwear"));
        AddTemplate(candidates, intent, Pick(groups, "dresses"), Pick(groups, "outerwear"), Pick(groups, "footwear"));
        AddTemplate(candidates, intent, Pick(groups, "one_pieces"), Pick(groups, "footwear"));
        AddTemplate(candidates, intent, Pick(groups, "one_pieces"), Pick(groups, "outerwear"), Pick(groups, "footwear"));
        AddTemplate(candidates, intent, Pick(groups, "activewear"), Pick(groups, "footwear"));
        return candidates.OrderByDescending(x => x.Score).Take(20).ToList();
    }

    private static WardrobeItem? Pick(Dictionary<string, List<WardrobeItem>> groups, string category) => groups.TryGetValue(category, out var values) ? values.FirstOrDefault() : null;

    private static void AddTemplate(List<OutfitCandidate> candidates, OutfitSearchIntent intent, params WardrobeItem?[] items)
    {
        var selected = items.Where(x => x is not null).Cast<WardrobeItem>().DistinctBy(x => x.Id).ToList();
        if (selected.Count != items.Length)
        {
            return;
        }

        var score = 40;
        var reasons = new List<string> { "Uses real wardrobe items" };
        if (intent.RequiredItemId is Guid required)
        {
            if (selected.Any(x => x.Id == required))
            {
                score += 20;
                reasons.Add("Includes required item");
            }
            else
            {
                score -= 15;
            }
        }

        if (intent.Comfort.NoHeels && selected.All(x => x.SubcategoryId != "heels"))
        {
            score += 10;
            reasons.Add("No heels");
        }

        if (selected.Select(x => x.PrimaryColourId).Distinct().Count() <= 2)
        {
            score += 8;
            reasons.Add("Simple colour palette");
        }

        candidates.Add(new OutfitCandidate(selected.Select(x => x.Id).ToList(), score, reasons));
    }

    private OutfitDto Map(Outfit outfit) => new(
        outfit.Id,
        outfit.Name,
        outfit.Prompt,
        outfit.Explanation,
        outfit.Items.OrderBy(x => x.SortOrder).Select(x => x.WardrobeItem.ToDto(signer)).ToList(),
        outfit.CreatedAt,
        outfit.UpdatedAt);
}

public sealed class CanonicalImageWorker(IServiceScopeFactory scopeFactory, ILogger<CanonicalImageWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await ProcessOneAsync(stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
        }
    }

    private async Task ProcessOneAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<WardrobeDbContext>();
            var storage = scope.ServiceProvider.GetRequiredService<IImageStorageService>();
            var ai = scope.ServiceProvider.GetRequiredService<IWardrobeAiService>();
            var job = await db.CanonicalImageJobs.OrderBy(x => x.CreatedAt).FirstOrDefaultAsync(x => x.Status == "pending", cancellationToken);
            if (job is null)
            {
                return;
            }

            var item = await db.WardrobeItems.FirstAsync(x => x.Id == job.WardrobeItemId, cancellationToken);
            job.Status = "processing";
            job.StartedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);

            await using var original = await storage.OpenReadAsync(item.OriginalImageKey, cancellationToken);
            var canonical = await ai.GenerateCanonicalImageAsync(original, item, cancellationToken);
            await using var canonicalStream = canonical?.Stream;
            if (canonical is not null)
            {
                item.CanonicalImageKey = await storage.SaveCanonicalAsync(item.UserId, item.Id, canonical.Stream, canonical.ContentType, cancellationToken);
                item.CanonicalImageContentType = canonical.ContentType;
                item.UpdatedAt = DateTimeOffset.UtcNow;
            }

            job.Status = "completed";
            job.CompletedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<WardrobeDbContext>();
            var job = await db.CanonicalImageJobs.OrderBy(x => x.CreatedAt).FirstOrDefaultAsync(x => x.Status == "processing", cancellationToken);
            if (job is not null)
            {
                job.AttemptCount += 1;
                job.LastError = ex.Message;
                job.Status = job.AttemptCount >= 3 ? "failed" : "pending";
                await db.SaveChangesAsync(cancellationToken);
            }

            logger.LogWarning(ex, "Canonical image job failed.");
        }
    }
}
