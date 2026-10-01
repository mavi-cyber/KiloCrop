// Renders public/og-image.png (1200×630) for link previews. Run with `npm run icons`.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const mark = (await readFile(new URL('../public/logo-mark.svg', import.meta.url), 'utf8'))
  .replace(/<\?xml[^>]*>/, '')
  .replace('<svg ', '<svg x="96" y="179" width="272" height="272" ');

const font = "font-family=\"'Segoe UI', 'Helvetica Neue', Arial, sans-serif\"";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="0.15" cy="0.2" r="0.9">
      <stop offset="0" stop-color="#134e4a"/>
      <stop offset="1" stop-color="#0b0f14"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#glow)"/>
  ${mark}
  <text x="420" y="300" ${font} font-size="104" font-weight="800" fill="#e6edf5">Kilo<tspan fill="#2dd4bf">Crop</tspan></text>
  <text x="424" y="368" ${font} font-size="36" fill="#94a3b8">Crop to any ratio. Shrink to any KB limit.</text>
  <text x="424" y="418" ${font} font-size="30" fill="#fdba74">Passport &amp; visa presets · 100% in your browser</text>
</svg>`;

await writeFile(new URL('../public/og-image.png', import.meta.url), await sharp(Buffer.from(svg)).png().toBuffer());
console.log('Wrote public/og-image.png');
