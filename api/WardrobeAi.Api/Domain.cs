using Microsoft.EntityFrameworkCore;

namespace WardrobeAi.Api;

public sealed class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class WardrobeItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
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
    public string OriginalImageKey { get; set; } = string.Empty;
    public string OriginalImageContentType { get; set; } = "image/jpeg";
    public string? CanonicalImageKey { get; set; }
    public string? CanonicalImageContentType { get; set; }
    public string? ThumbnailImageKey { get; set; }
    public string? ThumbnailImageContentType { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class Outfit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Prompt { get; set; }
    public string? Explanation { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<OutfitItem> Items { get; set; } = [];
}

public sealed class OutfitItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OutfitId { get; set; }
    public Guid WardrobeItemId { get; set; }
    public int SortOrder { get; set; }
    public WardrobeItem WardrobeItem { get; set; } = null!;
}

public sealed class WearLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public Guid? OutfitId { get; set; }
    public Guid? WardrobeItemId { get; set; }
    public DateTimeOffset WornAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class CanonicalImageJob
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WardrobeItemId { get; set; }
    public string Status { get; set; } = "pending";
    public int AttemptCount { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

public sealed class AiRequestLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    public string Feature { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string PromptVersion { get; set; } = string.Empty;
    public bool Succeeded { get; set; }
    public string? ErrorMessage { get; set; }
    public int? InputTokenCount { get; set; }
    public int? OutputTokenCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class WardrobeDbContext(DbContextOptions<WardrobeDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<WardrobeItem> WardrobeItems => Set<WardrobeItem>();
    public DbSet<Outfit> Outfits => Set<Outfit>();
    public DbSet<OutfitItem> OutfitItems => Set<OutfitItem>();
    public DbSet<WearLog> WearLogs => Set<WearLog>();
    public DbSet<CanonicalImageJob> CanonicalImageJobs => Set<CanonicalImageJob>();
    public DbSet<AiRequestLog> AiRequestLogs => Set<AiRequestLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>().HasIndex(x => x.Email).IsUnique();
        modelBuilder.Entity<WardrobeItem>().HasIndex(x => new { x.UserId, x.IsArchived });
        modelBuilder.Entity<Outfit>().HasMany(x => x.Items).WithOne().HasForeignKey(x => x.OutfitId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<OutfitItem>().HasOne(x => x.WardrobeItem).WithMany().HasForeignKey(x => x.WardrobeItemId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<WearLog>().HasIndex(x => new { x.UserId, x.WornAt });
    }
}
