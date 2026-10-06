import sharp from "sharp";
import { expect, test } from "./fixtures";

const headers = { Origin: "http://localhost:3100" };

test("large camera photos upload even when the browser's fast decoder refuses them", async ({ page }) => {
  // Safari on iPhone can reject 24–48 MP photos in createImageBitmap.
  await page.addInitScript(() => { window.createImageBitmap = () => Promise.reject(new DOMException("too large", "InvalidStateError")); });
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Photo cook", email: `photo-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } })).ok()).toBe(true);
  const created = await page.request.post("/api/recipes", { headers, data: { content: { title: "Photo soup", ingredientSections: [{ name: "", items: [{ text: "1 leek" }] }], instructionSections: [{ name: "", steps: ["Simmer."] }] } } });
  const recipe = await created.json() as { id: string };
  const camera = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: "#b5763a" } }).jpeg({ quality: 90 }).toBuffer();
  let uploaded: Buffer | null = null, contentType = "";
  await page.route("**/api/photos/uploads", (route) => route.fulfill({ status: 201, json: { id: "00000000-0000-4000-8000-0000000000aa", url: "unused", expiresIn: 300 } }));
  await page.route("**/api/photos/*/content", (route) => { uploaded = route.request().postDataBuffer(); contentType = route.request().headers()["content-type"]; return route.fulfill({ json: { id: "ok" } }); });
  await page.goto(`/recipes/${recipe.id}`);
  await page.getByRole("button", { name: "Add your photo", exact: true }).click();
  await page.getByLabel("Add recipe photos").setInputFiles({ name: "IMG_4750.jpeg", mimeType: "image/jpeg", buffer: camera });
  await page.getByRole("button", { name: "Upload photos", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Photos added." })).toBeVisible();
  expect(contentType).toBe("image/jpeg");
  const metadata = await sharp(uploaded!).metadata();
  expect(metadata).toMatchObject({ format: "jpeg", width: 2048, height: 1365 });
  expect(uploaded!.byteLength).toBeLessThan(3.8 * 1024 * 1024);
});
