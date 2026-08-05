/**
 * Ad-hoc sign the packed .app.
 *
 * We have no Developer ID yet (beta-launch ticket 2), so `mac.identity: null`
 * tells electron-builder to skip signing. But "skip" leaves the bundle carrying
 * Electron's own linker-signed signature: `Identifier=Electron`, Info.plist not
 * bound, and `codesign --verify` fails outright. On Apple Silicon that is worse
 * than unsigned — a signature that does not match the bundle gets the app killed
 * as "damaged", especially once a download has set the quarantine bit.
 *
 * An ad-hoc signature (`--sign -`) is not a substitute for notarization: the
 * first open is still right-click → Open. It only makes the bundle internally
 * consistent, which is the part macOS enforces at exec time.
 *
 * Delete this hook when the Apple Developer account lands, and let real signing
 * plus notarization take over.
 */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // --deep is discouraged for real distribution signing, but it is the honest
  // tool for ad-hoc: helpers and frameworks need their own signature too, and
  // there are no entitlements or provisioning profiles to get wrong here.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed  file=${appPath}`);
};
