import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'assets');
const websitePublic = join(__dirname, '..', '..', '..', 'apps', 'website', 'public');

mkdirSync(assetsDir, { recursive: true });

// Read the SVG files
const faviconSvg = readFileSync(join(websitePublic, 'favicon.svg'));
const logoIconSvg = readFileSync(join(websitePublic, 'logo-icon.svg'));

async function generateAssets() {
  console.log('Generating app icon (1024x1024)...');
  await sharp(faviconSvg)
    .resize(1024, 1024)
    .png()
    .toFile(join(assetsDir, 'icon.png'));

  console.log('Generating adaptive icon (1024x1024)...');
  await sharp(logoIconSvg)
    .resize(1024, 1024)
    .png()
    .toFile(join(assetsDir, 'adaptive-icon.png'));

  console.log('Generating splash screen (1284x2778)...');
  // Create splash with centered logo on gradient background
  const splashWidth = 1284;
  const splashHeight = 2778;
  const logoSize = 400;

  // Create a gradient background SVG
  const backgroundSvg = `
    <svg width="${splashWidth}" height="${splashHeight}">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#06b6d4"/>
          <stop offset="50%" style="stop-color:#3b82f6"/>
          <stop offset="100%" style="stop-color:#a855f7"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grad)"/>
    </svg>
  `;

  const background = await sharp(Buffer.from(backgroundSvg)).png().toBuffer();

  // Resize logo for splash
  const logo = await sharp(logoIconSvg)
    .resize(logoSize, logoSize)
    .png()
    .toBuffer();

  // Composite logo on background
  await sharp(background)
    .composite([
      {
        input: logo,
        top: Math.floor((splashHeight - logoSize) / 2),
        left: Math.floor((splashWidth - logoSize) / 2),
      },
    ])
    .toFile(join(assetsDir, 'splash.png'));

  console.log('Assets generated successfully!');
}

generateAssets().catch(console.error);
