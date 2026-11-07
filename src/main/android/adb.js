// Small wrapper for running ADB commands.

const { execFile } = require('child_process');
const engines = require('../engines');

function adb(args, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      engines.adbPath(),
      args,
      { timeout, windowsHide: true, env: { ...process.env, ADB_MDNS: '0' } },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          return reject(err);
        }
        resolve(stdout);
      }
    );
  });
}

module.exports = { adb };
