using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using WardrobeAi.Api;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<WardrobeAiOptions>(builder.Configuration.GetSection(WardrobeAiOptions.SectionName));
var aiOptions = builder.Configuration.GetSection(WardrobeAiOptions.SectionName).Get<WardrobeAiOptions>() ?? new WardrobeAiOptions();
builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();
builder.Services.AddDbContext<WardrobeDbContext>(options => options.UseNpgsql(builder.Configuration.GetConnectionString("WardrobeDb")));
builder.Services.AddCors(options =>
{
    options.AddPolicy("WardrobeApp", policy =>
    {
        policy.WithOrigins(aiOptions.CorsOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = aiOptions.JwtIssuer,
        ValidAudience = aiOptions.JwtAudience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(aiOptions.JwtSigningKey)),
        ClockSkew = TimeSpan.FromMinutes(1)
    };
});
builder.Services.AddAuthorization();
builder.Services.AddOpenApi();
builder.Services.AddScoped<ICurrentUserAccessor, CurrentUserAccessor>();
builder.Services.AddScoped<IPasswordService, PasswordService>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IImageStorageService, LocalImageStorageService>();
builder.Services.AddScoped<IImageUrlSigner, ImageUrlSigner>();
builder.Services.AddScoped<IWardrobeAiService>(sp =>
{
    var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<WardrobeAiOptions>>().Value;
    return string.IsNullOrWhiteSpace(options.OpenAiApiKey)
        ? new FakeWardrobeAiService()
        : new OpenAiWardrobeAiService(sp.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(OpenAiWardrobeAiService)), sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<WardrobeAiOptions>>());
});
builder.Services.AddScoped<WardrobeClassificationNormaliser>();
builder.Services.AddScoped<IWardrobeService, WardrobeService>();
builder.Services.AddScoped<IOutfitService, OutfitService>();
builder.Services.AddHostedService<CanonicalImageWorker>();

var app = builder.Build();

if (aiOptions.EnsureDatabaseCreatedOnStartup || aiOptions.SeedDevelopmentUser)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<WardrobeDbContext>();
    if (aiOptions.EnsureDatabaseCreatedOnStartup)
    {
        db.Database.EnsureCreated();
    }

    if (aiOptions.SeedDevelopmentUser)
    {
        await SeedDevelopmentUserAsync(db, scope.ServiceProvider.GetRequiredService<IPasswordService>(), aiOptions);
    }
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("WardrobeApp");
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => Results.Ok(new { service = "WardrobeAi.Api" })).AllowAnonymous();

var auth = app.MapGroup("/api/auth");
auth.MapPost("/register", async (RegisterRequest request, WardrobeDbContext db, IPasswordService passwordService, IJwtTokenService tokens, CancellationToken ct) =>
{
    var email = request.Email.Trim().ToLowerInvariant();
    if (await db.Users.AnyAsync(x => x.Email == email, ct))
    {
        return Results.BadRequest(new { message = "Email is already registered." });
    }

    var user = new AppUser { Email = email, DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? email : request.DisplayName.Trim(), PasswordHash = passwordService.Hash(request.Password) };
    db.Users.Add(user);
    await db.SaveChangesAsync(ct);
    return Results.Ok(new AuthResponse(tokens.Create(user), new AuthUserDto(user.Id, user.Email, user.DisplayName)));
}).AllowAnonymous();
auth.MapPost("/login", async (LoginRequest request, WardrobeDbContext db, IPasswordService passwordService, IJwtTokenService tokens, CancellationToken ct) =>
{
    var email = request.Email.Trim().ToLowerInvariant();
    var user = await db.Users.FirstOrDefaultAsync(x => x.Email == email, ct);
    if (user is null || !passwordService.Verify(user.PasswordHash, request.Password))
    {
        return Results.Unauthorized();
    }

    return Results.Ok(new AuthResponse(tokens.Create(user), new AuthUserDto(user.Id, user.Email, user.DisplayName)));
}).AllowAnonymous();
auth.MapGet("/me", async (ICurrentUserAccessor currentUser, WardrobeDbContext db, CancellationToken ct) =>
{
    var user = await db.Users.FindAsync([currentUser.UserId], ct);
    return user is null ? Results.Unauthorized() : Results.Ok(new AuthUserDto(user.Id, user.Email, user.DisplayName));
}).RequireAuthorization();

app.MapGet("/api/lookups/wardrobe", () => Results.Ok(LookupCatalog.Build())).RequireAuthorization();

var wardrobe = app.MapGroup("/api/wardrobe/items").RequireAuthorization();
wardrobe.MapPost("/", async (HttpRequest request, ICurrentUserAccessor currentUser, IWardrobeService service, CancellationToken ct) =>
{
    var form = await request.ReadFormAsync(ct);
    var image = form.Files["image"];
    if (image is null)
    {
        return Results.BadRequest(new { message = "Could not upload item. Try again." });
    }

    try
    {
        return Results.Ok(new CreateWardrobeItemResponse(await service.CreateAsync(currentUser.UserId, image, ct)));
    }
    catch (InvalidOperationException ex)
    {
        return Results.BadRequest(new { message = ex.Message });
    }
});
wardrobe.MapGet("/", async (string? categoryId, string? subcategoryId, string? colourId, string? patternId, string? search, bool? includeArchived, ICurrentUserAccessor currentUser, IWardrobeService service, CancellationToken ct) =>
    Results.Ok(new GetWardrobeItemsResponse(await service.FindAllAsync(currentUser.UserId, categoryId, subcategoryId, colourId, patternId, search, includeArchived == true, ct))));
wardrobe.MapGet("/{id:guid}", async (Guid id, ICurrentUserAccessor currentUser, IWardrobeService service, CancellationToken ct) =>
    await service.FindByIdAsync(currentUser.UserId, id, ct) is { } item ? Results.Ok(item) : Results.NotFound());
wardrobe.MapPut("/{id:guid}", async (Guid id, UpdateWardrobeItemRequest request, ICurrentUserAccessor currentUser, IWardrobeService service, CancellationToken ct) =>
    await service.UpdateAsync(currentUser.UserId, id, request, ct) is { } item ? Results.Ok(new UpdateWardrobeItemResponse(item)) : Results.NotFound());
wardrobe.MapDelete("/{id:guid}", async (Guid id, ICurrentUserAccessor currentUser, IWardrobeService service, CancellationToken ct) =>
    await service.DeleteAsync(currentUser.UserId, id, ct) ? Results.NoContent() : Results.NotFound());

app.MapGet("/api/images", async (string key, long expires, string signature, IImageUrlSigner signer, IImageStorageService storage, CancellationToken ct) =>
{
    if (!signer.Validate(key, expires, signature))
    {
        return Results.Unauthorized();
    }

    var image = await storage.OpenReadAsync(key, ct);
    var contentType = key.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg";
    return Results.File(image, contentType);
}).AllowAnonymous();

var outfits = app.MapGroup("/api/outfits").RequireAuthorization();
outfits.MapPost("/search", async (SearchOutfitsRequest request, ICurrentUserAccessor currentUser, IOutfitService service, CancellationToken ct) =>
    Results.Ok(new SearchOutfitsResponse(await service.SearchAsync(currentUser.UserId, request, ct))));
outfits.MapGet("/", async (ICurrentUserAccessor currentUser, IOutfitService service, CancellationToken ct) =>
    Results.Ok(new GetOutfitsResponse(await service.FindAllAsync(currentUser.UserId, ct))));
outfits.MapGet("/{id:guid}", async (Guid id, ICurrentUserAccessor currentUser, IOutfitService service, CancellationToken ct) =>
    await service.FindByIdAsync(currentUser.UserId, id, ct) is { } outfit ? Results.Ok(outfit) : Results.NotFound());
outfits.MapPost("/", async (CreateOutfitRequest request, ICurrentUserAccessor currentUser, IOutfitService service, CancellationToken ct) =>
    Results.Ok(new CreateOutfitResponse(await service.CreateAsync(currentUser.UserId, request, ct))));
outfits.MapDelete("/{id:guid}", async (Guid id, ICurrentUserAccessor currentUser, IOutfitService service, CancellationToken ct) =>
    await service.DeleteAsync(currentUser.UserId, id, ct) ? Results.NoContent() : Results.NotFound());
outfits.MapPost("/{id:guid}/wear-logs", async (Guid id, ICurrentUserAccessor currentUser, IOutfitService service, CancellationToken ct) =>
    await service.MarkWornAsync(currentUser.UserId, id, ct) is { } log ? Results.Ok(log) : Results.NotFound());

app.Run();

static async Task SeedDevelopmentUserAsync(WardrobeDbContext db, IPasswordService passwordService, WardrobeAiOptions options)
{
    var email = options.SeedUserEmail.Trim().ToLowerInvariant();
    if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(options.SeedUserPassword))
    {
        return;
    }

    var user = await db.Users.FirstOrDefaultAsync(x => x.Email == email);
    if (user is null)
    {
        db.Users.Add(new AppUser
        {
            Email = email,
            DisplayName = string.IsNullOrWhiteSpace(options.SeedUserDisplayName) ? email : options.SeedUserDisplayName.Trim(),
            PasswordHash = passwordService.Hash(options.SeedUserPassword)
        });
        await db.SaveChangesAsync();
        return;
    }

    if (!passwordService.Verify(user.PasswordHash, options.SeedUserPassword))
    {
        user.PasswordHash = passwordService.Hash(options.SeedUserPassword);
        await db.SaveChangesAsync();
    }
}

public partial class Program;
