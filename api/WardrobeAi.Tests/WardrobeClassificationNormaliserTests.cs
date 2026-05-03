using WardrobeAi.Api;
using Xunit;

namespace WardrobeAi.Tests;

public sealed class WardrobeClassificationNormaliserTests
{
    [Fact]
    public void PasswordService_VerifiesGeneratedHash()
    {
        var service = new PasswordService();
        var hash = service.Hash("Password123!");

        Assert.True(service.Verify(hash, "Password123!"));
        Assert.False(service.Verify(hash, "wrong-password"));
    }

    [Fact]
    public void PasswordService_ReturnsFalseForInvalidHash()
    {
        var service = new PasswordService();

        Assert.False(service.Verify("not-a-valid-hash", "Password123!"));
        Assert.False(service.Verify("bad.base64", "Password123!"));
    }

    [Fact]
    public void Normalise_StripsGarmentFieldsFromFootwear()
    {
        var item = new ClassifiedWardrobeItem
        {
            Name = "Sneakers",
            CategoryId = "footwear",
            SubcategoryId = "sneakers",
            PrimaryColourId = "white",
            NecklineId = "crew",
            SleeveLengthId = "short_sleeve",
            BottomShapeId = "straight",
            RiseId = "mid"
        };

        var result = new WardrobeClassificationNormaliser().Normalise(item);

        Assert.Null(result.NecklineId);
        Assert.Null(result.SleeveLengthId);
        Assert.Null(result.BottomShapeId);
        Assert.Null(result.RiseId);
    }

    [Fact]
    public void Normalise_JeansForcesBottomsAndDenim()
    {
        var item = new ClassifiedWardrobeItem
        {
            Name = "Jeans",
            CategoryId = "tops",
            SubcategoryId = "jeans",
            PrimaryColourId = "black"
        };

        var result = new WardrobeClassificationNormaliser().Normalise(item);

        Assert.Equal("bottoms", result.CategoryId);
        Assert.Equal("denim", result.VisibleMaterialId);
    }
}
