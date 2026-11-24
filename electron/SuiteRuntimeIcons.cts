import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { SuiteApplication } from './SuiteApplications.cjs';

// CONFIG AND CONTRACT — Reader is a standalone book; other roles retain their suite-artwork badges.
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const glyphs = {
  book: '<path d="M40 48q30-15 56 0q26-15 56 0v83q-29-13-56 0q-27-13-56 0Z"/><path d="M96 48v83"/>',
  shelves:
    '<path d="M42 44h24v80H42zm39 0h24v80H81zm36 4 23-6 20 77-23 6Z"/><path d="M34 140h128"/>',
  download: '<path d="M96 35v79m-29-29 29 29 29-29M46 122v25h100v-25"/>',
};
const readerArtwork = (accent: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="cover" x2="0" y2="1"><stop stop-color="#193862"/><stop offset="1" stop-color="#101c35"/></linearGradient></defs><rect x="24" y="24" width="464" height="464" rx="100" fill="url(#cover)"/><rect x="38" y="38" width="436" height="436" rx="86" fill="none" stroke="${accent}" stroke-width="12"/><g transform="translate(-16 -16) scale(2.85)" fill="#edf4ff" stroke="${accent}" stroke-width="5" stroke-linejoin="round">${glyphs.book}</g><g fill="none" stroke="#668bb9" stroke-width="8" stroke-linecap="round"><path d="M135 185q38-12 75 0m-75 39q38-12 75 0m-75 39q38-12 75 0M283 224q38-12 75 0m-75 39q38-12 75 0"/></g><path d="M286 126v73l22-14 22 14v-75" fill="${accent}"/></svg>`,
  );

// LOGIC AND CALCULATIONS — a standard multi-resolution ICO with PNG image entries.
export function encodeSuiteIcon(images: readonly Buffer[]): Buffer {
  if (images.length !== sizes.length) throw new Error('Every native icon size is required');
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((image, index) => {
    const size = sizes[index];
    if (!size) throw new Error('Unknown native icon size');
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

// LIFECYCLE AND OUTPUT — source artwork is read-only; generated role icons are deliverables.
export async function createSuiteIcons(
  root: string,
  applications: readonly SuiteApplication[],
): Promise<void> {
  const assets = path.join(root, 'electron/assets');
  for (const application of applications) {
    const badge = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><g transform="translate(307 307)"><rect x="7" y="7" width="188" height="188" rx="45" fill="${application.iconAccent}" stroke="#ffffff" stroke-width="9"/><g fill="none" stroke="#fff" stroke-width="10" stroke-linejoin="round" stroke-linecap="round">${glyphs[application.iconGlyph]}</g></g></svg>`,
    );
    const image =
      application.iconGlyph === 'book'
        ? await sharp(readerArtwork(application.iconAccent)).png().toBuffer()
        : await sharp(path.join(assets, 'app-icon.png'))
            .resize(512, 512, { fit: 'contain', background: '#00000000' })
            .composite([{ input: badge }])
            .png()
            .toBuffer();
    const png = path.join(assets, `${application.processName}.png`);
    const ico = path.join(assets, `${application.processName}.ico`);
    const images: Buffer[] = [];
    for (const size of sizes) images.push(await sharp(image).resize(size, size).png().toBuffer());
    for (const [file, content] of [
      [png, image],
      [ico, encodeSuiteIcon(images)],
    ] as const)
      if (!fs.existsSync(file) || !fs.readFileSync(file).equals(content))
        fs.writeFileSync(file, content);
  }
}
