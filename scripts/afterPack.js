const path = require('path');
const fs = require('fs');

/** Embed tron-app.ico into the Windows app exe (signAndEditExecutable is false). */
module.exports = async function afterPack(context) {
  if (process.platform !== 'win32') return;

  const projectDir = context.packager.projectDir;
  const icoPath = path.join(projectDir, 'branding', 'tron-app.ico');
  const productFilename =
    (context.packager.appInfo && context.packager.appInfo.productFilename) || 'TRON QA Suite';
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);

  if (!fs.existsSync(icoPath)) {
    console.warn('[afterPack] tron-app.ico missing:', icoPath);
    return;
  }
  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] app exe missing:', exePath);
    return;
  }

  try {
    const { rcedit } = await import('rcedit');
    await rcedit(exePath, { icon: icoPath });
    console.log('[afterPack] Icon embedded:', exePath);
  } catch (e) {
    console.warn('[afterPack] rcedit failed:', e && e.message ? e.message : e);
  }
};
