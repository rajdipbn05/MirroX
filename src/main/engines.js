// Finds the bundled engine programs (scrcpy, adb) for the current operating system.
// Keeping all OS-specific paths here makes a macOS build a matter of adding a folder.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const OS_FOLDER = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
const EXE = process.platform === 'win32' ? '.exe' : '';

function engineRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'engines')
    : path.join(__dirname, '..', '..', 'vendor', OS_FOLDER);
}

function scrcpyDir() {
  return path.join(engineRoot(), 'scrcpy');
}

function bundledOrSystem(name) {
  const bundled = path.join(scrcpyDir(), name + EXE);
  return fs.existsSync(bundled) ? bundled : name; // fall back to one on PATH (developer machines)
}

module.exports = {
  scrcpyDir,
  adbPath: () => bundledOrSystem('adb'),
  scrcpyPath: () => bundledOrSystem('scrcpy'),
};
