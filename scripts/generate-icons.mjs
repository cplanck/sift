import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
// Keep in sync with SiftMark in src/components/brand.tsx.
const mark = `<path d="M1.6 17.6Q16 25 30.4 17.6A14.4 13.6 0 0 1 1.6 17.6Z" stroke="#f3f4f0" stroke-width="1.6" stroke-linejoin="round"/><circle cx="16" cy="4.6" r="3"/><circle cx="9.8" cy="12" r="2.85"/><circle cx="22.2" cy="12" r="2.85"/>`;
const background = (from, to) => `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`;
// The mark's ink sits slightly above its box, so nudge it down to look centered.
const svg = (padding, colors) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${background(...colors)}<rect width="512" height="512" fill="url(#bg)"/><g transform="translate(${padding} ${padding - 4}) scale(${(512 - padding * 2) / 32})" fill="#f3f4f0">${mark}</g></svg>`);
for (const [directory, colors] of [["public/icons", ["#123a2b", "#050b09"]], ["public/icons/dev", ["#3b82f6", "#1d4ed8"]]]) {
  await mkdir(directory, { recursive: true });
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${background(...colors)}<rect width="32" height="32" rx="8" fill="url(#bg)"/><g transform="translate(5 4.8) scale(.6875)" fill="#f3f4f0">${mark}</g></svg>`;
  await writeFile(`${directory}/favicon.svg`, favicon + "\n");
  await sharp(Buffer.from(favicon)).resize(32, 32).png().toFile(`${directory}/icon-32.png`);
  for (const [name, size, padding] of [["icon-192", 192, 112], ["icon-512", 512, 112], ["maskable-512", 512, 144], ["apple-touch-icon", 180, 112]]) {
    await sharp(svg(padding, colors)).resize(size, size).png().toFile(`${directory}/${name}.png`);
  }
}
