import sharp from "sharp";
import { mkdir } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
const svg = (padding) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#141513"/><g transform="translate(${padding} ${padding}) scale(${(512 - padding * 2) / 32})" fill="#f4f3ed"><path d="M5 7h22L18 19h-4L5 7Z"/><circle cx="12" cy="24" r="1.6"/><circle cx="20" cy="24" r="1.6"/><circle cx="16" cy="29" r="1.6"/></g></svg>`);
for (const [name, size, padding] of [["icon-192", 192, 80], ["icon-512", 512, 80], ["maskable-512", 512, 120], ["apple-touch-icon", 180, 80]]) {
  await sharp(svg(padding)).resize(size, size).png().toFile(`public/icons/${name}.png`);
}
