// Windows only: keyboard helpers for scrcpy's mirror window.
//
//   EscExit(pid)       While running, pressing Esc when scrcpy's window is in front AND fullscreen
//                      switches it back to a normal window (by sending scrcpy's own Alt+F).
//                      That Esc is not passed on to the phone. Outside fullscreen, Esc is untouched.
//   pressKeys(pid, k)  Brings scrcpy's window to the front and presses 'alt+f' in it.
//
// Both use a small PowerShell process with a few Win32 calls (no install needed).

const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');

const ESC_HOOK = `
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public static class MxEsc {
  delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [StructLayout(LayoutKind.Sequential)] struct KBD { public uint vk; public uint scan; public uint flags; public uint time; public IntPtr extra; }
  static HookProc proc;
  static IntPtr hook;
  static uint target;
  static bool swallowUp;

  // Is the window in front scrcpy's, and does it cover its whole monitor (fullscreen)?
  static bool TargetFullscreen() {
    IntPtr fg = GetForegroundWindow();
    uint pid;
    GetWindowThreadProcessId(fg, out pid);
    if (pid != target) return false;
    RECT r;
    if (!GetWindowRect(fg, out r)) return false;
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(fg, 2), ref mi)) return false;
    return r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
  }

  static IntPtr Hook(int n, IntPtr w, IntPtr l) {
    if (n >= 0) {
      KBD k = (KBD)Marshal.PtrToStructure(l, typeof(KBD));
      if (k.vk == 0x1B) {
        int msg = w.ToInt32();
        bool down = msg == 0x100 || msg == 0x104;
        if (down && TargetFullscreen()) {
          swallowUp = true;
          ThreadPool.QueueUserWorkItem(delegate {
            Thread.Sleep(15);
            keybd_event(0xA4, 0, 0, UIntPtr.Zero);  // Alt down
            keybd_event(0x46, 0, 0, UIntPtr.Zero);  // F down
            keybd_event(0x46, 0, 2, UIntPtr.Zero);  // F up
            keybd_event(0xA4, 0, 2, UIntPtr.Zero);  // Alt up
          });
          Console.Out.WriteLine("ESC-EXIT");
          Console.Out.Flush();
          return (IntPtr)1; // don't pass this Esc on
        }
        if (!down && swallowUp) { swallowUp = false; return (IntPtr)1; }
      }
    }
    return CallNextHookEx(hook, n, w, l);
  }

  public static void Run(uint pid) {
    target = pid;
    proc = Hook;
    hook = SetWindowsHookEx(13, proc, GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName), 0);
    Console.Out.WriteLine(hook == IntPtr.Zero ? "HOOK-FAILED" : "READY");
    Console.Out.Flush();
    System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
    t.Interval = 1000;
    t.Tick += delegate {
      try { Process.GetProcessById((int)pid); } catch { Application.ExitThread(); }
    };
    t.Start();
    Application.Run();
  }
}
"@
`;

function escScript(pid) {
  return `$ErrorActionPreference = 'Stop'
${ESC_HOOK}
[MxEsc]::Run(${pid})`;
}

const WIN32_KEYS = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class MxKeys {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
`;

function keysScript(pid, keys) {
  const VK = { alt: 0xa4, f: 0x46 };
  const [mod, key] = keys.split('+').map((k) => VK[k]);
  return `$ErrorActionPreference = 'SilentlyContinue'
${WIN32_KEYS}
$p = Get-Process -Id ${pid}
$h = $p.MainWindowHandle
if ([MxKeys]::IsIconic($h)) { [void][MxKeys]::ShowWindow($h, 9) }
# Pressing Alt first lets Windows hand the keyboard focus to the mirror window.
[MxKeys]::keybd_event(${mod}, 0, 0, [UIntPtr]::Zero)
[void][MxKeys]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 60
[MxKeys]::keybd_event(${key}, 0, 0, [UIntPtr]::Zero)
[MxKeys]::keybd_event(${key}, 0, 2, [UIntPtr]::Zero)
[MxKeys]::keybd_event(${mod}, 0, 2, [UIntPtr]::Zero)
'OK'`;
}

const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64');
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'];

class EscExit extends EventEmitter {
  constructor(pid) {
    super();
    this.proc = spawn('powershell.exe', [...PS_ARGS, encoded(escScript(pid))], { windowsHide: true });
    this.log = '';
    const onOut = (d) => {
      const text = d.toString();
      this.log = (this.log + text).slice(-4000);
      for (const line of text.split(/\r?\n/)) if (line.trim()) this.emit('line', line.trim());
    };
    this.proc.stdout.on('data', onOut);
    this.proc.stderr.on('data', onOut);
    this.proc.on('error', (e) => this.emit('line', `ERROR ${e.message}`));
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

module.exports = { EscExit, pressKeys, escScript, keysScript };
