const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const pngPath = path.join(__dirname, '..', 'branding', 'tron-app.png');
const icnsPath = path.join(__dirname, '..', 'branding', 'tron-app.icns');

async function createIcon() {
  if (!fs.existsSync(pngPath)) {
    console.error('Error: branding/tron-app.png not found!');
    console.error('Please ensure you have a 1024x1024 PNG icon at branding/tron-app.png');
    process.exit(1);
  }

  try {
    console.log('Adding padding to icon...');
    
    // Add 15% padding around the logo
    // 1024 * 0.15 = 153.6px padding total (76.8px per side)
    // We resize the original logo to 85% of 1024px = 870px
    const size = 1024;
    const paddingPercent = 0.15;
    const innerSize = Math.floor(size * (1 - paddingPercent));
    
    const paddedPngBuffer = await sharp(pngPath)
      .resize(innerSize, innerSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .extend({
        top: Math.floor((size - innerSize) / 2),
        bottom: Math.ceil((size - innerSize) / 2),
        left: Math.floor((size - innerSize) / 2),
        right: Math.ceil((size - innerSize) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();

    console.log('Wrapping in ICNS container...');
    const icnsHeader = Buffer.from('icns');
    const totalSize = Buffer.alloc(4);
    const pngSize = paddedPngBuffer.length;
    
    // Header (4) + TotalSize (4) + Type (4) + Size (4) + Data
    totalSize.writeUInt32BE(16 + pngSize, 0);

    const typeMagic = Buffer.from('ic09'); // 1024x1024 png format
    const sizeField = Buffer.alloc(4);
    sizeField.writeUInt32BE(8 + pngSize, 0);

    const icnsBuffer = Buffer.concat([
      icnsHeader,
      totalSize,
      typeMagic,
      sizeField,
      paddedPngBuffer
    ]);

    fs.writeFileSync(icnsPath, icnsBuffer);
    console.log('Successfully created padded icon:', icnsPath);
  } catch (err) {
    console.error('Error creating icon:', err);
    process.exit(1);
  }
}

createIcon();
