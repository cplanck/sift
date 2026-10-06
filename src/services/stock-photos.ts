import "server-only";
import { z } from "zod";
import { fallbackStockPhoto, stockPhotoQuery, stockPhotoSchema, type StockPhoto } from "@/domain/stock-photo";

const pexelsResultsSchema = z.object({ photos: z.array(z.object({
  url: z.string(), photographer: z.string(), alt: z.string().nullish(),
  src: z.object({ large: z.string(), landscape: z.string().optional() }),
})).max(80) });

const unsplashResultsSchema = z.object({ results: z.array(z.object({
  alt_description: z.string().nullish(), description: z.string().nullish(),
  urls: z.object({ regular: z.string() }),
  links: z.object({ html: z.string() }),
  user: z.object({ name: z.string(), links: z.object({ html: z.string() }) }),
})).max(30) });

export function stockPhotosConfigured() { return !!(process.env.UNSPLASH_ACCESS_KEY?.trim() || process.env.PEXELS_API_KEY?.trim()); }

function selectPhoto(choices: StockPhoto[], title: string, fallback: StockPhoto) {
  // Prefer a finished dish to packaging or raw ingredients. Provider order breaks
  // ties so the most relevant search result stays stable between visits.
  const words = stockPhotoQuery(title).split(/\s+/).filter((word) => word.length > 2 && word !== "food");
  const ranked = choices.filter((photo) => !/\b(cans?|canned|packaging|packaged|labels?|supermarket|grocery store|tin cans?|bottles?)\b/i.test(photo.alt)).map((photo) => {
    const alt = photo.alt.toLowerCase();
    const matches = words.reduce((score, word) => score + (alt.includes(word) ? 3 : 0), 0);
    const plated = /\b(plate|bowl|served|cooked|dish|roasted|grilled|baked|meal)\b/.test(alt) ? 4 : 0;
    const raw = /\b(raw|uncooked|ingredients)\b/.test(alt) ? 5 : 0;
    return { photo, score: matches + plated - raw };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.photo ?? fallback;
}

function unsplashCreditUrl(value: string) {
  const url = new URL(value);
  url.searchParams.set("utm_source", "sift");
  url.searchParams.set("utm_medium", "referral");
  return url.toString();
}

async function findUnsplashPhoto(title: string, key: string, fallback: StockPhoto): Promise<StockPhoto> {
  const url = new URL("https://api.unsplash.com/search/photos");
  url.search = new URLSearchParams({ query: stockPhotoQuery(title), orientation: "landscape", per_page: "6", content_filter: "high" }).toString();
  try {
    const response = await fetch(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" }, cache: "force-cache", next: { revalidate: 604800 }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return fallback;
    const results = unsplashResultsSchema.safeParse(await response.json());
    if (!results.success) return fallback;
    const choices = results.data.results.flatMap((photo) => {
      const parsed = stockPhotoSchema.safeParse({ src: photo.urls.regular, alt: photo.alt_description || photo.description || fallback.alt, photographer: photo.user.name, url: photo.links.html, photographerUrl: photo.user.links.html, provider: "Unsplash" });
      if (!parsed.success || parsed.data.provider !== "Unsplash") return [];
      return [{ ...parsed.data, url: unsplashCreditUrl(parsed.data.url), photographerUrl: unsplashCreditUrl(parsed.data.photographerUrl) }];
    });
    // Retain the original CDN URL and tracking parameters when saving a selection.
    return selectPhoto(choices, title, fallback);
  } catch { return fallback; }
}

export async function findStockPhoto(title: string, tags: readonly string[] = []): Promise<StockPhoto> {
  const fallback = fallbackStockPhoto(title, tags), unsplashKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (unsplashKey) return findUnsplashPhoto(title, unsplashKey, fallback);
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) return fallback;
  const url = new URL("https://api.pexels.com/v1/search");
  url.search = new URLSearchParams({ query: stockPhotoQuery(title), orientation: "landscape", per_page: "6", locale: "en-US" }).toString();
  try {
    // Cache provider metadata, not authenticated recipe responses. The API key
    // stays on the server; a timeout or quota failure leaves bundled photos intact.
    const response = await fetch(url, { headers: { Authorization: key }, cache: "force-cache", next: { revalidate: 604800 }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return fallback;
    const results = pexelsResultsSchema.safeParse(await response.json());
    if (!results.success || !results.data.photos.length) return fallback;
    const choices = results.data.photos.flatMap((photo) => {
      const parsed = stockPhotoSchema.safeParse({ src: photo.src.large, alt: photo.alt || fallback.alt, photographer: photo.photographer, url: photo.url, provider: "Pexels" });
      return parsed.success ? [parsed.data] : [];
    });
    return selectPhoto(choices, title, fallback);
  } catch { return fallback; }
}
