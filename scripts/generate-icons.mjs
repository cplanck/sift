import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const mark = `<path d="M2 16h28a14 14 0 0 1-28 0Z"/><circle cx="16" cy="4" r="2.2"/><circle cx="11" cy="10.5" r="2.2"/><circle cx="21" cy="10.5" r="2.2"/>`;
const svg = (padding, color) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${color}"/><g transform="translate(${padding} ${padding}) scale(${(512 - padding * 2) / 32})" fill="#f3f4f0">${mark}</g></svg>`);
for (const [directory, color] of [["public/icons", "#0b1010"], ["public/icons/dev", "#2563eb"]]) {
  await mkdir(directory, { recursive: true });
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><g transform="translate(4 4) scale(.75)" fill="#f3f4f0">${mark}</g></svg>`;
  await writeFile(`${directory}/favicon.svg`, favicon + "\n");
  await sharp(Buffer.from(favicon)).resize(32, 32).png().toFile(`${directory}/icon-32.png`);
  for (const [name, size, padding] of [["icon-192", 192, 80], ["icon-512", 512, 80], ["maskable-512", 512, 120], ["apple-touch-icon", 180, 80]]) {
    await sharp(svg(padding, color)).resize(size, size).png().toFile(`${directory}/${name}.png`);
  }
}
