using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace WardrobeAi.Api;

public sealed class OpenAiWardrobeAiService : IWardrobeAiService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient httpClient;
    private readonly WardrobeAiOptions options;

    public OpenAiWardrobeAiService(HttpClient httpClient, IOptions<WardrobeAiOptions> options)
    {
        this.httpClient = httpClient;
        this.options = options.Value;
        this.httpClient.BaseAddress = new Uri("https://api.openai.com/v1/");
        this.httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", this.options.OpenAiApiKey);
    }

    public async Task<ClassifiedWardrobeItem> ClassifyItemAsync(Stream imageStream, CancellationToken cancellationToken)
    {
        var imageData = await ToDataUrlAsync(imageStream, cancellationToken);
        var response = await PostResponsesAsync(new
        {
            model = options.OpenAiModel,
            input = new[]
            {
                new
                {
                    role = "user",
                    content = new object[]
                    {
                        new { type = "input_text", text = ClassificationPrompt },
                        new { type = "input_image", image_url = imageData }
                    }
                }
            },
            text = new { format = JsonSchemaFormat("wardrobe_item_classification", ClassificationSchema()) }
        }, cancellationToken);

        return JsonSerializer.Deserialize<ClassifiedWardrobeItem>(ExtractOutputText(response), JsonOptions)
            ?? throw new InvalidOperationException("Could not classify wardrobe item.");
    }

    public async Task<GeneratedImage?> GenerateCanonicalImageAsync(Stream imageStream, WardrobeItem item, CancellationToken cancellationToken)
    {
        imageStream.Position = 0;
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(options.OpenAiImageModel), "model");
        form.Add(new StringContent(CanonicalPrompt(item)), "prompt");
        form.Add(new StreamContent(imageStream), "image", "item.jpg");
        using var response = await httpClient.PostAsync("images/edits", form, cancellationToken);
        response.EnsureSuccessStatusCode();
        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var b64 = json?["data"]?[0]?["b64_json"]?.GetValue<string>();
        return string.IsNullOrWhiteSpace(b64) ? null : new GeneratedImage(new MemoryStream(Convert.FromBase64String(b64)), "image/png");
    }

    public async Task<OutfitSearchIntent> ParseOutfitSearchAsync(string query, Guid? requiredItemId, CancellationToken cancellationToken)
    {
        var response = await PostResponsesAsync(new
        {
            model = options.OpenAiModel,
            input = $"Parse the outfit request into structured search intent. Query: {query}. Required item: {requiredItemId?.ToString() ?? "none"}. Return only JSON matching the schema.",
            text = new { format = JsonSchemaFormat("outfit_search_intent", OutfitIntentSchema()) }
        }, cancellationToken);

        return JsonSerializer.Deserialize<OutfitSearchIntent>(ExtractOutputText(response), JsonOptions)
            ?? new OutfitSearchIntent(null, null, requiredItemId, [], [], [], [], [], new OutfitComfortIntent(false, false, false, false, false), 3);
    }

    public async Task<IReadOnlyList<GeneratedOutfitDto>> RankAndExplainOutfitsAsync(OutfitSearchIntent intent, IReadOnlyList<OutfitCandidate> candidates, IReadOnlyList<WardrobeItem> items, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(new { intent, candidates, wardrobeItems = items.Select(x => new { x.Id, x.Name, x.CategoryId, x.SubcategoryId, x.PrimaryColourId }) }, JsonOptions);
        var response = await PostResponsesAsync(new
        {
            model = options.OpenAiModel,
            input = $"Rank the supplied valid outfit candidates. Use only supplied item IDs and return three concise results. {payload}",
            text = new { format = JsonSchemaFormat("ranked_outfits", RankedOutfitsSchema()) }
        }, cancellationToken);

        var parsed = JsonSerializer.Deserialize<RankedOutfitsEnvelope>(ExtractOutputText(response), JsonOptions);
        return parsed?.Outfits ?? [];
    }

    private async Task<JsonNode> PostResponsesAsync(object request, CancellationToken cancellationToken)
    {
        using var response = await httpClient.PostAsJsonAsync("responses", request, JsonOptions, cancellationToken);
        response.EnsureSuccessStatusCode();
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken)) ?? throw new InvalidOperationException("OpenAI response was empty.");
    }

    private static async Task<string> ToDataUrlAsync(Stream stream, CancellationToken cancellationToken)
    {
        stream.Position = 0;
        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, cancellationToken);
        return $"data:image/jpeg;base64,{Convert.ToBase64String(memory.ToArray())}";
    }

    private static string ExtractOutputText(JsonNode json)
    {
        var direct = json["output_text"]?.GetValue<string>();
        if (!string.IsNullOrWhiteSpace(direct))
        {
            return direct;
        }

        foreach (var output in json["output"]?.AsArray() ?? [])
        {
            foreach (var content in output?["content"]?.AsArray() ?? [])
            {
                var text = content?["text"]?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(text))
                {
                    return text;
                }
            }
        }

        throw new InvalidOperationException("OpenAI response did not include output text.");
    }

    private static object JsonSchemaFormat(string name, object schema) => new { type = "json_schema", name, strict = true, schema };

    private static object ClassificationSchema() => new
    {
        type = "object",
        additionalProperties = false,
        required = new[] { "name", "categoryId", "subcategoryId", "primaryColourId", "secondaryColourIds", "patternId", "visibleMaterialId", "necklineId", "sleeveLengthId", "fitId", "lengthId", "bottomShapeId", "riseId", "inputIssue" },
        properties = new Dictionary<string, object>
        {
            ["name"] = new { type = "string" },
            ["categoryId"] = new { type = "string", @enum = LookupCatalog.Categories.Select(x => x.Id).ToArray() },
            ["subcategoryId"] = new { type = "string" },
            ["primaryColourId"] = new { type = "string", @enum = LookupCatalog.Colours.Select(x => x.Id).ToArray() },
            ["secondaryColourIds"] = new { type = "array", items = new { type = "string", @enum = LookupCatalog.Colours.Select(x => x.Id).ToArray() } },
            ["patternId"] = NullableEnum(LookupCatalog.Patterns.Select(x => x.Id)),
            ["visibleMaterialId"] = NullableEnum(LookupCatalog.VisibleMaterials.Select(x => x.Id)),
            ["necklineId"] = NullableEnum(LookupCatalog.Necklines.Select(x => x.Id)),
            ["sleeveLengthId"] = NullableEnum(LookupCatalog.SleeveLengths.Select(x => x.Id)),
            ["fitId"] = NullableEnum(LookupCatalog.Fits.Select(x => x.Id)),
            ["lengthId"] = NullableEnum(LookupCatalog.GarmentLengths.Select(x => x.Id)),
            ["bottomShapeId"] = NullableEnum(LookupCatalog.BottomShapes.Select(x => x.Id)),
            ["riseId"] = NullableEnum(LookupCatalog.Rises.Select(x => x.Id)),
            ["inputIssue"] = new { type = new[] { "string", "null" }, @enum = new string?[] { "multiple_items", "item_not_fully_visible", "too_dark", "too_blurry", "not_clothing_or_accessory", null } }
        }
    };

    private static object OutfitIntentSchema() => new
    {
        type = "object",
        additionalProperties = false,
        required = new[] { "occasionId", "formalityId", "requiredItemId", "includeCategoryIds", "excludeCategoryIds", "excludeSubcategoryIds", "preferredColourIds", "avoidedColourIds", "comfort", "outfitCount" },
        properties = new Dictionary<string, object>
        {
            ["occasionId"] = NullableEnum(LookupCatalog.Occasions.Select(x => x.Id)),
            ["formalityId"] = NullableEnum(LookupCatalog.Formalities.Select(x => x.Id)),
            ["requiredItemId"] = new { type = new[] { "string", "null" } },
            ["includeCategoryIds"] = StringArray(),
            ["excludeCategoryIds"] = StringArray(),
            ["excludeSubcategoryIds"] = StringArray(),
            ["preferredColourIds"] = StringArray(),
            ["avoidedColourIds"] = StringArray(),
            ["comfort"] = new
            {
                type = "object",
                additionalProperties = false,
                required = new[] { "noHeels", "walkable", "warmWeather", "coldWeather", "modest" },
                properties = new Dictionary<string, object>
                {
                    ["noHeels"] = new { type = "boolean" },
                    ["walkable"] = new { type = "boolean" },
                    ["warmWeather"] = new { type = "boolean" },
                    ["coldWeather"] = new { type = "boolean" },
                    ["modest"] = new { type = "boolean" }
                }
            },
            ["outfitCount"] = new { type = "integer" }
        }
    };

    private static object RankedOutfitsSchema() => new
    {
        type = "object",
        additionalProperties = false,
        required = new[] { "outfits" },
        properties = new Dictionary<string, object>
        {
            ["outfits"] = new
            {
                type = "array",
                items = new
                {
                    type = "object",
                    additionalProperties = false,
                    required = new[] { "title", "itemIds", "explanation" },
                    properties = new Dictionary<string, object>
                    {
                        ["title"] = new { type = "string" },
                        ["itemIds"] = new { type = "array", items = new { type = "string" } },
                        ["explanation"] = new { type = "string" }
                    }
                }
            }
        }
    };

    private static object StringArray() => new { type = "array", items = new { type = "string" } };
    private static object NullableEnum(IEnumerable<string> values) => new { type = new[] { "string", "null" }, @enum = values.Cast<string?>().Concat([null]).ToArray() };

    private static string CanonicalPrompt(WardrobeItem item)
    {
        var prompt = new StringBuilder("Create a clean ecommerce ghost-mannequin render of the wardrobe item in the supplied image. Preserve the exact item, shape, proportions, colour, pattern, texture, stitching, buttons, zips, logos and trims. Show one item only, front-facing and centred, on a pure white background with soft neutral studio lighting. Do not show a person, body, skin, face, hands, hanger, mannequin, room, furniture or extra objects. Do not redesign, restyle, recolour, simplify, crop, or add details.");
        if (item.CategoryId is "footwear" or "bags" or "accessories")
        {
            prompt.Append(" Render this as a clean centred ecommerce product photo rather than a ghost-mannequin garment render.");
        }

        return prompt.ToString();
    }

    private const string ClassificationPrompt = """
You classify one wardrobe item from an image. Return only structured data matching the supplied schema. Choose only allowed enum values. Classify only visually stable attributes. Do not guess exact fabric, brand, size, occasion, season, or style aesthetic. Use null when a field does not apply or is not clearly visible. Do not use confidence scores or explanations. If the image contains multiple items, is not fully visible, too dark, too blurry, or is not clothing/shoes/bag/accessory, return the matching inputIssue.
""";

    private sealed record RankedOutfitsEnvelope(IReadOnlyList<GeneratedOutfitDto> Outfits);
}
