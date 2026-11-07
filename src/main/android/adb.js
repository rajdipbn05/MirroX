// Small wrapper for running ADB commands.
//
// MirroX runs its own private ADB server on a non-standard port so it never talks to
// (or gets stuck on) another program's ADB server on the default port 5037 — e.g. an
// Android emulator, Android Studio, or a phone-manager app.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const engines = require('../engines');

const ADB_PORT = 15037;
const DEFAULT_ADB_PORT = 5037;

// Environment for adb and for scrcpy (which runs adb itself).
function adbEnv() {
  return { ...process.env, ANDROID_ADB_SERVER_PORT: String(ADB_PORT), ADB_MDNS: '0' };
}

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, env: adbEnv() }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

async function adb(args, { timeout = 8000 } = {}) {
  const exe = engines.adbPath();
  try {
    return await run(exe, args, timeout);
  } catch (err) {
    err.details = await describeError(err, exe, args);
    throw err;
  }
}

// Full technical description of a failed ADB command, for the "Show details" box.
async function describeError(err, exe, args) {
  const lines = [
    `Command: adb ${args.join(' ')}  (private port ${ADB_PORT})`,
    `Error: ${err.message.trim()}`,
    `Code: ${err.code ?? '-'}  Signal: ${err.signal ?? '-'}  Killed (timeout): ${err.killed ? 'yes' : 'no'}`,
    `stdout: ${(err.stdout || '').trim() || '(empty)'}`,
    `stderr: ${(err.stderr || '').trim() || '(empty)'}`,
    `ADB path: ${exe}`,
    `ADB file exists: ${fs.existsSync(exe) ? 'yes' : 'NO'}`,
    `Engine folder contents: ${listDir(engines.scrcpyDir())}`,
    `OS: ${process.platform} ${process.arch} ${os.release()}`,
  ];
  if (process.platform === 'win32') {
    lines.push(`Programs using ports ${ADB_PORT}/${DEFAULT_ADB_PORT}:\n${await portOwners([ADB_PORT, DEFAULT_ADB_PORT])}`);
  }
  lines.push(`ADB server log (last lines):\n${tail(path.join(os.tmpdir(), 'adb.log'), 25)}`);
  return lines.join('\n');
}

// Windows only: which processes are listening on / connected to the given ports.
async function portOwners(ports) {
  try {
    const netstat = await run('netstat', ['-ano', '-p', 'TCP'], 5000);
    const rows = netstat
      .split(/\r?\n/)
      .filter((l) => ports.some((p) => l.includes(`:${p} `)))
      .map((l) => l.trim().split(/\s+/));
    if (!rows.length) return '  (none)';
    const tasks = await run('tasklist', ['/FO', 'CSV', '/NH'], 5000);
    const names = new Map();
    for (const l of tasks.split(/\r?\n/)) {
      const m = l.match(/^"([^"]+)","(\d+)"/);
      if (m) names.set(m[2], m[1]);
    }
    return rows
      .map(([, local, remote, state, pid]) => `  ${local} -> ${remote} ${state} pid ${pid} (${names.get(pid) || '?'})`)
      .join('\n');
  } catch (e) {
    return `  (could not check: ${e.message.trim()})`;
  }
}

function tail(file, n) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-n).join('\n');
  } catch (e) {
    return `  (no log: ${e.code})`;
  }
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
  if (/cannot bind|address already in use|only one usage of each socket/.test(text))
    return 'Another program on this computer is blocking the phone connection. Close other phone or emulator apps, then reopen MirroX.';
  if (err.killed)
    return 'The phone connection helper is not responding. MirroX keeps trying. If this message stays, click "Show details" and send the text to support.';
  return 'The phone connection helper could not start. Try closing and reopening MirroX. If it keeps happening, click "Show details" and send the text to support.';
}

module.exports = { adb, adbEnv, friendlyAdbError, ADB_PORT };
