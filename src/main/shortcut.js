// Windows: put a "MirroX" shortcut on the desktop the first time MirroX is opened.
//
// - Points at the MirroX .exe the user actually runs (for the portable version that is the
//   downloaded file, not the temporary copy it unpacks itself into).
// - If the user deletes the shortcut, it is not recreated (they didn't want it).
// - If the user moves the MirroX file, the existing shortcut is updated to the new place.

const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

// The .exe the user launches.
function launcherPath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

// The icon must live somewhere stable that Windows can read (not inside the app archive).
function stableIcon() {
  const dest = path.join(app.getPath('userData'), 'MirroX.ico');
  try {
    fs.copyFileSync(path.join(__dirname, 'icon.ico'), dest);
  } catch {}
  return dest;
}

/**
 * @param {{ created?: boolean, target?: string }} state  remembered in settings
 * @returns the new state to remember
 */
function ensureDesktopShortcut(state = {}) {
  if (process.platform !== 'win32' || !app.isPackaged) return state;
  const target = launcherPath();
  const link = path.join(app.getPath('desktop'), 'MirroX.lnk');
  const exists = fs.existsSync(link);
  const options = {
    target,
    cwd: path.dirname(target),
    description: 'MirroX — mirror your phone screen',
    icon: stableIcon(),
    iconIndex: 0,
  };
  try {
    if (!state.created) {
      shell.writeShortcutLink(link, exists ? 'replace' : 'create', options);
      return { created: true, target };
    }
    if (exists && state.target !== target) {
      shell.writeShortcutLink(link, 'replace', options); // the MirroX file was moved
      return { created: true, target };
    }
  } catch (err) {
    console.error('[shortcut]', err.message);
  }
  return state;
}

module.exports = { ensureDesktopShortcut, launcherPath };
