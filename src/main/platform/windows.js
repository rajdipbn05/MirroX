// Windows-only system checks: USB devices, running programs, closing programs.

const { execFile } = require('child_process');

function powershell(script, timeout = 15000) {
  const full = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', full],
      { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
  });
}

function parseJsonList(text) {
  const t = text.trim();
  if (!t) return [];
  const v = JSON.parse(t);
  return Array.isArray(v) ? v : [v];
}

// All USB devices Windows knows about right now: [{id, name, cls, error}]
async function scanUsb() {
  const out = await powershell(
    "Get-CimInstance Win32_PnPEntity -Filter \"DeviceID LIKE 'USB%'\" | " +
      'Select-Object DeviceID,Name,PNPClass,ConfigManagerErrorCode | ConvertTo-Json -Compress'
  );
  return parseJsonList(out).map((d) => ({
    id: d.DeviceID || '',
    name: d.Name || '',
    cls: d.PNPClass || '',
    error: d.ConfigManagerErrorCode || 0,
  }));
}

// Running programs: [{name, pid, path}]
async function listProcesses() {
  const out = await powershell(
    'Get-CimInstance Win32_Process | Select-Object Name,ProcessId,ExecutablePath | ConvertTo-Json -Compress'
  );
  return parseJsonList(out).map((p) => ({ name: p.Name || '', pid: p.ProcessId, path: p.ExecutablePath || '' }));
}

function killProcesses(pids) {
  const args = pids.flatMap((pid) => ['/PID', String(pid)]).concat(['/T', '/F']);
  return new Promise((resolve) => {
    execFile('taskkill', args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, output: `${stdout || ''}${stderr || ''}`.trim() })
    );
  });
}

module.exports = { scanUsb, listProcesses, killProcesses };
