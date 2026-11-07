// Windows only: follows another program's window (scrcpy's mirror window) so MirroX can keep
// its own bar attached above it, and sends it the Alt+F key (scrcpy's fullscreen toggle).
//
// A small PowerShell helper (with a few Win32 calls) prints one line whenever something changes:
//   R <x> <y> <width> <height> <minimized 0|1> <foreground-process-id>    (physical pixels)
//   GONE                                                                  (window/process ended)

const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');

const WIN32 = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class MxW {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
`;

function trackerScript(pid) {
  return `$ErrorActionPreference = 'SilentlyContinue'
${WIN32}
$h = [IntPtr]::Zero
$last = ''
$n = 0
while ($true) {
  if ($h -eq [IntPtr]::Zero -or -not [MxW]::IsWindow($h)) {
    $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
    if (-not $p) { [Console]::Out.WriteLine('GONE'); [Console]::Out.Flush(); break }
    $p.Refresh()
    $h = $p.MainWindowHandle
  }
  if ($h -ne [IntPtr]::Zero) {
    $r = New-Object MxW+RECT
    # Visible frame (without the invisible resize border Windows 10/11 adds around windows)
    if ([MxW]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -ne 0) { [void][MxW]::GetWindowRect($h, [ref]$r) }
    $fpid = [uint32]0
    [void][MxW]::GetWindowThreadProcessId([MxW]::GetForegroundWindow(), [ref]$fpid)
    $line = "R $($r.L) $($r.T) $($r.R - $r.L) $($r.B - $r.T) $([int][MxW]::IsIconic($h)) $fpid"
    if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
  }
  $n++
  if ($n % 33 -eq 0 -and -not (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { [Console]::Out.WriteLine('GONE'); [Console]::Out.Flush(); break }
  Start-Sleep -Milliseconds 30
}`;
}

// Brings the window to the front and presses a key combination in it.
// keys: 'alt+f' (scrcpy fullscreen toggle)
function keysScript(pid, keys) {
  const VK = { alt: 0xa4, f: 0x46 };
  const [mod, key] = keys.split('+').map((k) => VK[k]);
  return `$ErrorActionPreference = 'SilentlyContinue'
${WIN32}
$p = Get-Process -Id ${pid}
$h = $p.MainWindowHandle
if ([MxW]::IsIconic($h)) { [void][MxW]::ShowWindow($h, 9) }
# Pressing Alt first lets Windows hand the keyboard focus to the mirror window.
[MxW]::keybd_event(${mod}, 0, 0, [UIntPtr]::Zero)
[void][MxW]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 60
[MxW]::keybd_event(${key}, 0, 0, [UIntPtr]::Zero)
[MxW]::keybd_event(${key}, 0, 2, [UIntPtr]::Zero)
[MxW]::keybd_event(${mod}, 0, 2, [UIntPtr]::Zero)
'OK'`;
}

function encoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'];

class WindowTracker extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.proc = spawn('powershell.exe', [...PS_ARGS, encoded(trackerScript(pid))], { windowsHide: true });
    let buf = '';
    this.proc.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) this.onLine(l.trim());
    });
    this.proc.on('exit', () => this.emit('gone'));
    this.proc.on('error', (e) => this.emit('error', e));
  }

  onLine(line) {
    if (line === 'GONE') return this.emit('gone');
    const m = /^R (-?\d+) (-?\d+) (\d+) (\d+) (\d) (\d+)$/.exec(line);
    if (!m) return;
    this.emit('rect', {
      x: +m[1],
      y: +m[2],
      width: +m[3],
      height: +m[4],
      minimized: m[5] === '1',
      foregroundPid: +m[6],
    });
  }

  stop() {
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
  }
}

function pressKeys(pid, keys) {
  return new Promise((resolve) => {
    execFile('powershell.exe', [...PS_ARGS, encoded(keysScript(pid, keys))], { windowsHide: true, timeout: 15000 }, (err, out) =>
      resolve(!err && /OK/.test(out || ''))
    );
  });
}

module.exports = { WindowTracker, pressKeys, trackerScript, keysScript };
