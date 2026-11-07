// Small wrapper for running ADB commands.

const fs = require('fs');
const { execFile } = require('child_process');
const engines = require('../engines');

function adb(args, { timeout = 8000 } = {}) {
  const exe = engines.adbPath();
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      { timeout, windowsHide: true, env: { ...process.env, ADB_MDNS: '0' } },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          err.details = describeError(err, exe, args);
          return reject(err);
        }
        resolve(stdout);
      }
    );
  });
}

// Full technical description of a failed ADB command, for the "Show details" box.
function describeError(err, exe, args) {
  return [
    `Command: adb ${args.join(' ')}`,
    `Error: ${err.message.trim()}`,
    `Code: ${err.code ?? '-'}  Signal: ${err.signal ?? '-'}  Killed (timeout): ${err.killed ? 'yes' : 'no'}`,
    `stdout: ${(err.stdout || '').trim() || '(empty)'}`,
    `stderr: ${(err.stderr || '').trim() || '(empty)'}`,
    `ADB path: ${exe}`,
    `ADB file exists: ${fs.existsSync(exe) ? 'yes' : 'NO'}`,
    `Engine folder: ${engines.scrcpyDir()}`,
    `Engine folder contents: ${listDir(engines.scrcpyDir())}`,
    `OS: ${process.platform} ${process.arch} ${require('os').release()}`,
  ].join('\n');
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir).join(', ');
  } catch (e) {
    return `(cannot read: ${e.code})`;
  }
}

// Plain-language explanation for the most common ADB startup problems.
function friendlyAdbError(err) {
  const text = `${err.message}\n${err.stderr || ''}\n${err.stdout || ''}`.toLowerCase();
  if (err.code === 'ENOENT' || /enoent|cannot find/.test(text))
    return 'Part of MirroX is missing (the phone connection helper). Windows security may have removed it. Download MirroX again; if this keeps happening, see "Show details".';
  if (err.code === 'EPERM' || err.code === 'EACCES' || /access is denied|operation not permitted/.test(text))
    return 'Windows blocked the phone connection helper. Your antivirus (for example Windows Security) may be blocking MirroX. See "Show details".';
  if (/5037|smartsocket|cannot bind|address already in use|only one usage of each socket/.test(text))
    return 'Another program on this computer is already using the phone connection (for example Android Studio, an Android emulator, or a phone manager app). Close it, then reopen MirroX.';
  if (err.killed)
    return 'The phone connection helper is taking too long to start. Please wait a moment — MirroX keeps trying.';
  return 'The phone connection helper could not start. Try closing and reopening MirroX. If it keeps happening, click "Show details" and send the text to support.';
}

module.exports = { adb, friendlyAdbError };
