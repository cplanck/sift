import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackStockPhoto, stockPhotoSchema } from "@/domain/stock-photo";
import { findStockPhoto, stockPhotosConfigured } from "@/services/stock-photos";

beforeEach(() => { vi.stubEnv("UNSPLASH_ACCESS_KEY", ""); vi.stubEnv("PEXELS_API_KEY", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const sample = { url: "https://www.pexels.com/photo/123/", photographer: "A photographer", alt: "Lemon chicken with herbs", src: { large: "https://images.pexels.com/photos/123/pexels-photo-123.jpeg" } };
const unsplashSample = { alt_description: "A plate of lemon chicken", urls: { regular: "https://images.unsplash.com/photo-123?ixid=test-photo-view&fit=max&w=1080" }, links: { html: "https://unsplash.com/photos/lemon-chicken" }, user: { name: "Food Photographer", links: { html: "https://unsplash.com/@food_photographer" } } };

describe("automatic stock photography", () => {
  it("uses real bundled images without configuration or external requests", async () => {
    vi.stubEnv("PEXELS_API_KEY", "");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(stockPhotosConfigured()).toBe(false);
    for (const title of ["Pasta", "Chicken Piccata", "Turkey Chili", "Sourdough Bread", "Salad", "Roasted Vegetables", "Salmon", "Chocolate Cake", "Pancakes", "Something new"]) {
      const photo = await findStockPhoto(title);
      expect(stockPhotoSchema.safeParse(photo).success).toBe(true);
      const metadata = await sharp(await readFile(`public${photo.src}`)).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBeGreaterThanOrEqual(900);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(fallbackStockPhoto("Roasted vegetables").src).toBe("/stock/vegetables.webp");
    expect(fallbackStockPhoto("Turkey chili bowl").src).toBe("/stock/soup.webp");
    expect(fallbackStockPhoto("Chicken Piccata", ["Vegan"]).src).toBe("/stock/chicken.webp");
  });

  it("searches with a server credential, caches metadata, and returns credit alongside imagery", async () => {
    vi.stubEnv("PEXELS_API_KEY", "test-only-server-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ photos: [sample] })); vi.stubGlobal("fetch", fetcher);
    const photo = await findStockPhoto("Easy homemade Lemon Chicken");
    expect(photo).toMatchObject({ src: sample.src.large, photographer: sample.photographer, url: sample.url, provider: "Pexels" });
    const [url, options] = fetcher.mock.calls[0];
    expect(url.origin).toBe("https://api.pexels.com");
    expect(url.searchParams.get("query")).toBe("lemon chicken food");
    expect(options.headers.Authorization).toBe("test-only-server-key");
    expect(options.next.revalidate).toBe(604800);
    expect(options.cache).toBe("force-cache");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(photo)).not.toContain("test-only-server-key");
  });

  it("prefers finished dishes to packaged products and raw ingredients", async () => {
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "test-only-unsplash-key");
    const make = (alt: string, id: number) => ({ ...unsplashSample, alt_description: alt, urls: { regular: `https://images.unsplash.com/photo-${id}` } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [make("Cans of turkey chili", 1), make("Raw turkey ingredients", 2), make("A bowl of cooked turkey chili", 3)] })));
    expect((await findStockPhoto("Turkey Chili")).src).toBe("https://images.unsplash.com/photo-3");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [make("Canned turkey chili", 1)] })));
    expect(await findStockPhoto("Turkey Chili")).toEqual(fallbackStockPhoto("Turkey Chili"));
  });

  it("retains a local image on quota limits, outages, timeouts, malformed metadata, or empty search", async () => {
    vi.stubEnv("PEXELS_API_KEY", "test-only-server-key");
    for (const result of [new Response(null, { status: 429 }), new Response(null, { status: 503 }), Response.json({ photos: [] }), Response.json({ photos: [{ broken: true }] })]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(result));
      expect(await findStockPhoto("Turkey chili")).toEqual(fallbackStockPhoto("Turkey chili"));
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")));
    expect(await findStockPhoto("Turkey chili")).toEqual(fallbackStockPhoto("Turkey chili"));
  });

  it("rejects unexpected image and attribution hosts before exposing provider metadata", async () => {
    vi.stubEnv("PEXELS_API_KEY", "test-only-server-key");
    for (const photo of [
      { ...sample, src: { large: "https://images.pexels.com.attacker.example/pixel" } },
      { ...sample, src: { large: "javascript:alert(1)" } },
      { ...sample, src: { large: "http://images.pexels.com/photos/123/test.jpeg" } },
      { ...sample, url: "https://attacker.example" },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ photos: [photo] })));
      expect(await findStockPhoto("Chicken Piccata")).toEqual(fallbackStockPhoto("Chicken Piccata"));
    }
  });

  it("prefers Unsplash, preserves hotlinked view tracking and provides photographer/referral credit without leaking credentials", async () => {
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "test-only-unsplash-key");
    vi.stubEnv("PEXELS_API_KEY", "test-only-legacy-key");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [unsplashSample] })); vi.stubGlobal("fetch", fetcher);
    expect(stockPhotosConfigured()).toBe(true);
    const photo = await findStockPhoto("Quick Lemon Chicken Recipe");
    expect(photo).toMatchObject({ provider: "Unsplash", src: unsplashSample.urls.regular, photographer: unsplashSample.user.name, alt: unsplashSample.alt_description });
    expect(photo.url).toBe("https://unsplash.com/photos/lemon-chicken?utm_source=sift&utm_medium=referral");
    expect(photo.provider === "Unsplash" && photo.photographerUrl).toBe("https://unsplash.com/@food_photographer?utm_source=sift&utm_medium=referral");
    expect(stockPhotoSchema.safeParse(photo).success).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url.origin).toBe("https://api.unsplash.com");
    expect(url.pathname).toBe("/search/photos");
    expect(url.searchParams.get("query")).toBe("lemon chicken food");
    expect(url.searchParams.get("content_filter")).toBe("high");
    expect(options.headers).toEqual({ Authorization: "Client-ID test-only-unsplash-key", "Accept-Version": "v1" });
    expect(options.cache).toBe("force-cache");
    expect(options.next.revalidate).toBe(604800);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(photo)).not.toContain("test-only-");
    expect(url.searchParams.has("client_id")).toBe(false);
  });

  it("keeps bundled images when Unsplash is rate limited, unavailable, empty, malformed or times out", async () => {
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "test-only-unsplash-key");
    for (const response of [new Response(null, { status: 429 }), new Response(null, { status: 503 }), Response.json({ results: [] }), Response.json({ results: [{ broken: true }] })]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      expect(await findStockPhoto("Salmon")).toEqual(fallbackStockPhoto("Salmon"));
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")));
    expect(await findStockPhoto("Salmon")).toEqual(fallbackStockPhoto("Salmon"));
  });

  it("rejects unsafe Unsplash sources and credit links, including a mismatched provider", async () => {
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "test-only-unsplash-key");
    for (const photo of [
      { ...unsplashSample, urls: { regular: "https://images.unsplash.com.attacker.example/pixel" } },
      { ...unsplashSample, urls: { regular: "https://attacker@images.unsplash.com/photo-123" } },
      { ...unsplashSample, links: { html: "javascript:alert(1)" } },
      { ...unsplashSample, user: { ...unsplashSample.user, links: { html: "https://attacker.example/@food" } } },
      { ...unsplashSample, user: { ...unsplashSample.user, links: { html: "https://unsplash.com/photos/not-a-profile" } } },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [photo] })));
      expect(await findStockPhoto("Salmon")).toEqual(fallbackStockPhoto("Salmon"));
    }
    expect(stockPhotoSchema.safeParse({ ...fallbackStockPhoto("Salmon"), provider: "Unsplash", photographerUrl: unsplashSample.user.links.html }).success).toBe(false);
  });
});
