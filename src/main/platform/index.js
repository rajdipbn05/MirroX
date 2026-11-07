// Operating-system specific checks. Each function returns null when the
// check isn't available on this OS, so the rest of the app can work without it.
// A macOS version adds a mac.js with the same three functions.

const impl = process.platform === 'win32' ? require('./windows') : null;

module.exports = {
  scanUsb: () => (impl ? impl.scanUsb() : Promise.resolve(null)),
  listProcesses: () => (impl ? impl.listProcesses() : Promise.resolve(null)),
  killProcesses: (pids) => (impl ? impl.killProcesses(pids) : Promise.resolve({ ok: false, output: 'Not supported on this system' })),
};
