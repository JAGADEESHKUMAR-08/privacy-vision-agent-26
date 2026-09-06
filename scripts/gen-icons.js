/**
 * Generates the extension PNG icons from the source SVG at all required sizes.
 * Pure local offline generation - no external services.
 *
 * Usage: node scripts/gen-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'extension', 'icons', 'icon.svg');
const OUT_DIR = path.join(ROOT, 'extension', 'icons');
const SIZES = [16, 48, 128];

async function main() {
  const svg = fs.readFileSync(SVG_PATH);
  for (const size of SIZES) {
    const outPath = path.join(OUT_DIR, `icon${size}.png`);
    await sharp(svg, { density: 512 })
      .resize(size, size)
      .png()
      .toFile(outPath);
    const stat = fs.statSync(outPath);
    console.log(`Generated ${outPath} (${stat.size} bytes, ${size}x${size})`);
  }
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
