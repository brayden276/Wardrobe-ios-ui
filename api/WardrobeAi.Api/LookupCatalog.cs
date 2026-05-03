namespace WardrobeAi.Api;

public static class LookupCatalog
{
    public static readonly WardrobeCategoryLookupDto[] Categories =
    [
        Category("tops", "Tops", ("t_shirt", "T-Shirt"), ("long_sleeve_top", "Long Sleeve Top"), ("tank_top", "Tank Top"), ("cami", "Cami"), ("blouse", "Blouse"), ("shirt", "Shirt"), ("bodysuit", "Bodysuit"), ("crop_top", "Crop Top"), ("tunic", "Tunic"), ("polo", "Polo")),
        Category("bottoms", "Bottoms", ("jeans", "Jeans"), ("trousers", "Trousers"), ("leggings", "Leggings"), ("shorts", "Shorts"), ("skirt", "Skirt"), ("culottes", "Culottes"), ("joggers", "Joggers")),
        Category("dresses", "Dresses", ("mini_dress", "Mini Dress"), ("midi_dress", "Midi Dress"), ("maxi_dress", "Maxi Dress"), ("wrap_dress", "Wrap Dress"), ("shirt_dress", "Shirt Dress"), ("slip_dress", "Slip Dress"), ("bodycon_dress", "Bodycon Dress"), ("cocktail_dress", "Cocktail Dress"), ("formal_dress", "Formal Dress"), ("sundress", "Sundress")),
        Category("one_pieces", "One Pieces", ("jumpsuit", "Jumpsuit"), ("playsuit", "Playsuit"), ("romper", "Romper"), ("overalls", "Overalls")),
        Category("outerwear", "Outerwear", ("blazer", "Blazer"), ("coat", "Coat"), ("trench_coat", "Trench Coat"), ("jacket", "Jacket"), ("denim_jacket", "Denim Jacket"), ("leather_jacket", "Leather Jacket"), ("puffer_jacket", "Puffer Jacket"), ("vest", "Vest")),
        Category("knitwear", "Knitwear", ("jumper", "Jumper"), ("cardigan", "Cardigan"), ("knit_top", "Knit Top"), ("turtleneck", "Turtleneck"), ("sweater_vest", "Sweater Vest")),
        Category("activewear", "Activewear", ("sports_bra", "Sports Bra"), ("active_top", "Active Top"), ("active_leggings", "Active Leggings"), ("bike_shorts", "Bike Shorts"), ("track_pants", "Track Pants"), ("hoodie", "Hoodie"), ("sweatshirt", "Sweatshirt")),
        Category("footwear", "Shoes", ("sneakers", "Sneakers"), ("heels", "Heels"), ("flats", "Flats"), ("boots", "Boots"), ("ankle_boots", "Ankle Boots"), ("sandals", "Sandals"), ("loafers", "Loafers"), ("mules", "Mules"), ("slides", "Slides")),
        Category("bags", "Bags", ("tote_bag", "Tote Bag"), ("crossbody_bag", "Crossbody Bag"), ("shoulder_bag", "Shoulder Bag"), ("clutch", "Clutch"), ("backpack", "Backpack"), ("handbag", "Handbag")),
        Category("accessories", "Accessories", ("belt", "Belt"), ("scarf", "Scarf"), ("hat", "Hat"), ("sunglasses", "Sunglasses"), ("hair_accessory", "Hair Accessory"), ("watch", "Watch"), ("jewellery", "Jewellery"))
    ];

    public static readonly LookupOptionDto[] Colours = Options(("black", "Black"), ("white", "White"), ("grey", "Grey"), ("cream", "Cream"), ("beige", "Beige"), ("brown", "Brown"), ("navy", "Navy"), ("blue", "Blue"), ("green", "Green"), ("red", "Red"), ("pink", "Pink"), ("purple", "Purple"), ("yellow", "Yellow"), ("orange", "Orange"), ("metallic", "Metallic"), ("multi", "Multi"));
    public static readonly LookupOptionDto[] Patterns = Options(("solid", "Solid"), ("striped", "Striped"), ("floral", "Floral"), ("polka_dot", "Polka Dot"), ("check", "Check"), ("plaid", "Plaid"), ("animal_print", "Animal Print"), ("geometric", "Geometric"), ("graphic", "Graphic"), ("logo", "Logo"), ("colourblock", "Colourblock"), ("abstract", "Abstract"), ("lace_detail", "Lace Detail"), ("embroidered", "Embroidered"));
    public static readonly LookupOptionDto[] VisibleMaterials = Options(("denim", "Denim"), ("knit", "Knit"), ("leather", "Leather"), ("faux_leather", "Faux Leather"), ("satin", "Satin"), ("linen", "Linen"), ("lace", "Lace"), ("mesh", "Mesh"), ("crochet", "Crochet"), ("corduroy", "Corduroy"), ("puffer", "Puffer"), ("wool_coat", "Wool Coat"));
    public static readonly LookupOptionDto[] Necklines = Options(("crew", "Crew Neck"), ("v_neck", "V-Neck"), ("scoop", "Scoop Neck"), ("square", "Square Neck"), ("sweetheart", "Sweetheart"), ("boat", "Boat Neck"), ("halter", "Halter"), ("cowl", "Cowl Neck"), ("collared", "Collared"), ("turtleneck", "Turtleneck"), ("off_shoulder", "Off Shoulder"), ("one_shoulder", "One Shoulder"));
    public static readonly LookupOptionDto[] SleeveLengths = Options(("sleeveless", "Sleeveless"), ("short_sleeve", "Short Sleeve"), ("cap_sleeve", "Cap Sleeve"), ("three_quarter", "3/4 Sleeve"), ("long_sleeve", "Long Sleeve"), ("strapless", "Strapless"), ("spaghetti_strap", "Spaghetti Strap"));
    public static readonly LookupOptionDto[] Fits = Options(("fitted", "Fitted"), ("regular", "Regular"), ("oversized", "Oversized"));
    public static readonly LookupOptionDto[] GarmentLengths = Options(("cropped", "Cropped"), ("hip_length", "Hip Length"), ("tunic_length", "Tunic Length"), ("mini", "Mini"), ("knee_length", "Knee Length"), ("midi", "Midi"), ("maxi", "Maxi"), ("full_length", "Full Length"));
    public static readonly LookupOptionDto[] BottomShapes = Options(("skinny", "Skinny"), ("straight", "Straight"), ("wide_leg", "Wide Leg"), ("flare", "Flare"), ("bootcut", "Bootcut"), ("tapered", "Tapered"));
    public static readonly LookupOptionDto[] Rises = Options(("low", "Low Rise"), ("mid", "Mid Rise"), ("high", "High Rise"));
    public static readonly LookupOptionDto[] Occasions = Options(("casual", "Casual"), ("smart_casual", "Smart Casual"), ("work", "Work"), ("business", "Business"), ("evening", "Evening"), ("date_night", "Date Night"), ("formal", "Formal"), ("wedding_guest", "Wedding Guest"), ("travel", "Travel"), ("home", "Home"));
    public static readonly LookupOptionDto[] Formalities = Options(("1", "Home"), ("2", "Casual"), ("3", "Smart Casual"), ("4", "Business / Evening"), ("5", "Formal"));

    public static WardrobeLookupsDto Build() => new(Categories, Colours, Patterns, VisibleMaterials, Necklines, SleeveLengths, Fits, GarmentLengths, BottomShapes, Rises, Occasions, Formalities);

    public static bool IsCategory(string id) => Categories.Any(x => x.Id == id);
    public static bool IsSubcategory(string categoryId, string subcategoryId) => Categories.FirstOrDefault(x => x.Id == categoryId)?.Subcategories.Any(x => x.Id == subcategoryId) == true;
    public static bool IsColour(string id) => Colours.Any(x => x.Id == id);

    private static WardrobeCategoryLookupDto Category(string id, string label, params (string Id, string Label)[] subcategories) => new(id, label, Options(subcategories));
    private static LookupOptionDto[] Options(params (string Id, string Label)[] values) => values.Select(x => new LookupOptionDto(x.Id, x.Label)).ToArray();
}
