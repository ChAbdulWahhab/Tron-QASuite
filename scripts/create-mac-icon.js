const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '..', 'branding', 'tron-app.png');
const icnsPath = path.join(__dirname, '..', 'branding', 'tron-app.icns');

if (!fs.existsSync(pngPath)) {
  console.error('Error: branding/tron-app.png not found!');
  console.error('Please ensure you have a 1024x1024 PNG icon at branding/tron-app.png');
  process.exit(1);
}

const pngBuffer = fs.readFileSync(pngPath);

const icnsHeader = Buffer.from('icns');
const totalSize = Buffer.alloc(4);

const pngSize = pngBuffer.length;
totalSize.writeUInt32BE(8 + 8 + pngSize, 0);

const typeMagic = Buffer.from('ic07');
const size = Buffer.alloc(4);
size.writeUInt32BE(8 + pngSize, 0);

const icnsBuffer = Buffer.concat([
  icnsHeader,
  totalSize,
  typeMagic,
  size,
  pngBuffer
]);

fs.writeFileSync(icnsPath, icnsBuffer);
console.log('Created:', icnsPath);
console.log('Note: For production, consider using png2icns or iconutil on macOS for proper ICNS format');
