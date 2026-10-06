import { z } from "zod";
import { normalizeSearch } from "./recipe";

const providerUrl = (value: string, hostname: string) => {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === hostname && !url.username && !url.password && !url.port; }
  catch { return false; }
};

const creditSchema = {
  alt: z.string().max(1000),
  photographer: z.string().min(1).max(300),
};
export const unsplashReferralUrl = "https://unsplash.com/?utm_source=sift&utm_medium=referral";
export const stockPhotoSchema = z.discriminatedUnion("provider", [
  z.object({
    ...creditSchema,
    src: z.string().refine((value) => /^\/stock\/[a-z]+\.webp$/.test(value) || providerUrl(value, "images.pexels.com")),
    url: z.string().refine((value) => providerUrl(value, "www.pexels.com")),
    provider: z.literal("Pexels"),
  }),
  z.object({
    ...creditSchema,
    src: z.string().refine((value) => providerUrl(value, "images.unsplash.com")),
    url: z.string().refine((value) => providerUrl(value, "unsplash.com")),
    photographerUrl: z.string().refine((value) => providerUrl(value, "unsplash.com") && /^\/@[a-z\d_-]+$/i.test(new URL(value).pathname)),
    provider: z.literal("Unsplash"),
  }),
]);
export type StockPhoto = z.infer<typeof stockPhotoSchema>;

// Bundled, licensed photography keeps the library useful without an API key
// or a provider connection. These are representative images, never recipe uploads.
const collection = [
  { name: "pasta", match: /\b(pasta|spaghetti|carbonara|linguine|fettuccine|penne|noodles|lasagna|macaroni|ravioli|orzo)\b/, id: 4518946, photographer: "Polina Tankilevitch", alt: "Spaghetti with tomato sauce on a white plate" },
  { name: "salad", match: /\b(salad|slaw|greens)\b/, id: 2821743, photographer: "Madison Inouye", alt: "A bowl of fresh mixed vegetable salad" },
  { name: "soup", match: /\b(soup|chili|chilli|stew|broth|chowder|ramen|dal|lentils)\b/, id: 16336074, photographer: "Marcelo Verfe", alt: "A bowl of soup with peppers and spices" },
  { name: "bread", match: /\b(bread|sourdough|focaccia|loaf|bagel|brioche|toast|sandwich)\b/, id: 4881596, photographer: "Jytte Elfferich", alt: "A rustic sourdough loaf on a dark surface" },
  { name: "breakfast", match: /\b(pancakes?|waffles?|breakfast|brunch|crepes?|oatmeal|porridge)\b/, id: 5377577, photographer: "Nataliya Vaitkevich", alt: "A stack of chocolate pancakes with coffee" },
  { name: "dessert", match: /\b(cake|brownies?|cookies?|chocolate|dessert|pie|tart|pudding|sweet)\b/, id: 1028711, photographer: "Acharaporn Kamornboonyarush", alt: "A slice of chocolate layer cake" },
  { name: "fish", match: /\b(fish|salmon|trout|cod|tuna|seafood|shrimp|prawns?|sardines)\b/, id: 16845479, photographer: "Huzaifa Bukhari", alt: "Salmon with vegetables and sauce" },
  { name: "chicken", match: /\b(chicken|piccata|poultry|turkey|kebab|tikka)\b/, id: 32947063, photographer: "J KREATOR", alt: "Grilled chicken with lemon and herbs" },
  { name: "vegetables", match: /\b(vegetables?|vegan|vegetarian|broccoli|cauliflower|potatoes?|carrots?|squash|mushrooms?)\b/, id: 9219088, photographer: "Loren Castillo", alt: "A colorful roasted vegetable medley" },
  { name: "ingredients", match: /\b(ingredients|cooking|kitchen)\b/, id: 6213751, photographer: "Vladimir Gladkov", alt: "Olive oil and fresh basil on a wooden cutting board" },
];

export function fallbackStockPhoto(title: string, tags: readonly string[] = []): StockPhoto {
  const normalizedTitle = normalizeSearch(title), normalizedTags = normalizeSearch(tags.join(" "));
  const photo = collection.find((item) => item.match.test(normalizedTitle)) ?? collection.find((item) => item.match.test(normalizedTags)) ?? collection[9];
  return { src: `/stock/${photo.name}.webp`, alt: photo.alt, photographer: photo.photographer, url: `https://www.pexels.com/photo/${photo.id}/`, provider: "Pexels" };
}

export function stockPhotoQuery(title: string) {
  const words = normalizeSearch(title).replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((word) => word && !["my", "the", "best", "easy", "homemade", "simple", "quick", "recipe"].includes(word));
  return `${words.join(" ").slice(0, 100) || "cooking ingredients"} food`;
}
