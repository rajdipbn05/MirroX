// Owns the mirror window: starts the phone-side server, opens the window on the chosen monitor,
// and handles the three window modes (normal / borderless / fullscreen), always-on-top,
// aspect-ratio-locked resizing, and remembering position, size and mode per monitor.

const path = require('path');
const { EventEmitter } = require('events');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { ServerSession } = require('./android/session');
const { applyOrientation } = require('./android/orientation');
const { adb } = require('./android/adb');
const { TITLE_BAR, fitBounds, keepAspect, isOnArea } = require('./window-geometry');

const MODES = ['normal', 'borderless', 'fullscreen'];

// Lists monitors for the "Open mirror on" setting.
function listDisplays() {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter((d) => d.id !== primary.id);
  const label = (d) => `${d.size.width}×${d.size.height}`;
  return [
    { id: 'primary', label: `Primary monitor (${label(primary)})` },
    ...others.map((d, i) => ({ id: String(d.id), label: `Monitor ${i + 2} (${label(d)})` })),
  ];
}

function targetDisplay(monitor) {
  if (monitor && monitor !== 'primary') {
    const d = screen.getAllDisplays().find((x) => String(x.id) === String(monitor));
    if (d) return d;
  }
  return screen.getPrimaryDisplay();
}

class MirrorController extends EventEmitter {
  // store: { get(): settings.window, set(windowSettings) } — persisted by main.js
  constructor(store) {
    super();
    this.store = store;
    this.win = null;
    this.session = null;
    this.restoreOrientation = null;
    this.video = { width: 1080, height: 2400 };
    this.mode = 'normal';
    this.normalBounds = null;
    this.ending = false;

    ipcMain.on('mirror:ready', (e) => this.isMine(e) && this.sendInit());
    ipcMain.on('mirror:connected', (e) => this.isMine(e) && this.emit('state', { state: 'running' }));
    ipcMain.on('mirror:stats', (e, s) => this.isMine(e) && this.emit('stats', s));
    ipcMain.on('mirror:size', (e, s) => this.isMine(e) && this.onVideoSize(s));
    ipcMain.on('mirror:action', (e, a) => this.isMine(e) && this.onAction(a));
    ipcMain.on('mirror:ended', (e, info) => this.isMine(e) && this.onEnded(info));
  }

  isMine(e) {
    return this.win && !this.win.isDestroyed() && e.sender === this.win.webContents;
  }

  get running() {
    return !!this.win || !!this.starting;
  }

  // ---------- Start / stop ----------

  // device: { serial, name } (or { testPort } for automated tests); perf: effective preset settings
  async start(device, perf) {
    if (this.running) return;
    this.starting = true;
    this.ending = false;
    this.emit('state', { state: 'starting' });
    let port;
    let audio = perf.audio;
    try {
      if (device.testPort) {
        port = device.testPort;
      } else {
        this.restoreOrientation = await applyOrientation(device.serial, perf.orientation).catch(() => null);
        const sdk = parseInt(await adb(['-s', device.serial, 'shell', 'getprop', 'ro.build.version.sdk']).catch(() => '0'), 10);
        this.session = new ServerSession(device.serial);
        this.session.on('exit', ({ log }) => this.onServerExit(log));
        const r = await this.session.start({ settings: perf, audio: perf.audio, sdk });
        port = r.port;
        audio = r.audio;
        this.command = r.command;
      }
      if (this.ending) throw Object.assign(new Error('cancelled'), { cancelled: true });
    } catch (err) {
      this.starting = false;
      await this.cleanup();
      if (err.cancelled) return this.emit('state', { state: 'stopped' });
      return this.emit('state', {
        state: 'error',
        message: 'MirroX could not start mirroring on your phone. Unplug the phone, plug it back in, and try again.',
        details: `${err.details || err.stack || err}`,
      });
    }
    this.initOptions = { port, audio, screenOff: perf.screenOff, title: `MirroX — ${device.name}` };
    this.openWindow();
    this.starting = false;
  }

  stop() {
    if (this.win && !this.win.isDestroyed()) this.win.close();
    else if (this.starting) this.ending = true;
  }

  async cleanup() {
    const s = this.session;
    this.session = null;
    if (s) await s.stop();
    const restore = this.restoreOrientation;
    this.restoreOrientation = null;
    if (restore) await restore().catch(() => {});
  }

  onServerExit(log) {
    // The phone-side server stopped on its own (e.g. phone unplugged, encoder failure).
    if (this.win && !this.win.isDestroyed()) {
      this.pendingError = log;
      setTimeout(() => this.win && !this.win.isDestroyed() && this.win.close(), 300);
    }
  }

  onEnded(info) {
    const serverLog = this.session ? this.session.log : '';
    this.endInfo = {
      state: 'error',
      message: info.message,
      details: [info.details, this.command, serverLog && `Phone-side log:\n${serverLog.slice(-3000)}`].filter(Boolean).join('\n\n'),
    };
    if (this.win && !this.win.isDestroyed()) this.win.close();
  }

  // ---------- Window ----------

  ws() {
    return this.store.get();
  }

  displayKey(display) {
    return String(display.id);
  }

  openWindow() {
    const ws = this.ws();
    const display = targetDisplay(ws.monitor);
    this.display = display;
    const saved = (ws.byDisplay || {})[this.displayKey(display)] || {};
    this.mode = MODES.includes(saved.mode) ? saved.mode : 'normal';
    const extra = this.mode === 'normal' ? TITLE_BAR : 0;
    let bounds = saved.bounds && isOnArea(saved.bounds, display.workArea) ? saved.bounds : null;
    if (!bounds) bounds = fitBounds(display.workArea, this.video.width, this.video.height, extra);

    this.win = new BrowserWindow({
      ...bounds,
      minWidth: 160,
      minHeight: 160,
      frame: false, // MirroX draws its own title bar with extra buttons
      resizable: true,
      show: false,
      backgroundColor: '#000000',
      title: this.initOptions.title,
      alwaysOnTop: !!ws.alwaysOnTop,
      webPreferences: {
        // Only ever loads our local mirror.html; needs Node to read the video socket directly.
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    const win = this.win;
    win.setMenu(null);
    if (ws.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
    win.loadFile(path.join(__dirname, '..', 'renderer', 'mirror', 'mirror.html'));
    win.once('ready-to-show', () => {
      win.show();
      if (this.mode === 'fullscreen') this.enterFullscreen();
      this.applyAspect();
    });

    win.on('will-resize', (e, newBounds, details) => {
      if (process.platform !== 'win32' || this.mode === 'fullscreen') return;
      e.preventDefault();
      win.setBounds(keepAspect(newBounds, details && details.edge, this.ratio(), this.extraH()));
    });
    const remember = debounce(() => this.rememberBounds(), 400);
    win.on('move', remember);
    win.on('resize', remember);
    // Native maximize (e.g. Windows' double-click on the title bar) = fullscreen, as requested.
    win.on('maximize', () => {
      win.unmaximize();
      this.setMode('fullscreen');
    });
    win.on('leave-full-screen', () => {
      if (this.mode === 'fullscreen') this.setMode('normal');
    });
    win.on('close', () => {
      if (this.win) this.win.webContents.send('closing');
      this.rememberBounds();
    });
    win.on('closed', async () => {
      this.win = null;
      await this.cleanup();
      const end = this.endInfo || (this.pendingError ? this.serverExitInfo(this.pendingError) : { state: 'stopped' });
      this.endInfo = null;
      this.pendingError = null;
      this.emit('state', end);
    });
  }

  serverExitInfo(log) {
    return {
      state: 'error',
      message: 'Mirroring stopped: the phone ended the connection. Check the cable, then try again.',
      details: [this.command, `Phone-side log:\n${log.slice(-3000)}`].filter(Boolean).join('\n\n'),
    };
  }

  sendInit() {
    const ws = this.ws();
    this.win.webContents.send('init', { ...this.initOptions, mode: this.mode, alwaysOnTop: !!ws.alwaysOnTop });
  }

  sendMode(hint) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('mode', { mode: this.mode, alwaysOnTop: !!this.ws().alwaysOnTop, hint });
  }

  ratio() {
    return this.video.width / this.video.height;
  }

  extraH() {
    return this.mode === 'normal' ? TITLE_BAR : 0;
  }

  applyAspect() {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.mode === 'fullscreen') this.win.setAspectRatio(0);
    else if (process.platform !== 'win32') this.win.setAspectRatio(this.ratio(), { width: 0, height: this.extraH() });
  }

  // The phone rotated (or the first picture arrived): match the window to the new shape.
  onVideoSize({ width, height }) {
    const flipped = width > height !== this.video.width > this.video.height;
    this.video = { width, height };
    if (!this.win || this.win.isDestroyed()) return;
    this.applyAspect();
    if (this.mode === 'fullscreen') return;
    const b = this.win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    if (flipped) {
      // Keep the window centred where it was, refit to the new shape.
      const fit = fitBounds(area, width, height, this.extraH());
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      this.win.setBounds({ ...fit, x: Math.round(cx - fit.width / 2), y: Math.round(cy - fit.height / 2) });
    } else {
      this.win.setBounds({ ...b, height: Math.round(b.width / this.ratio()) + this.extraH() });
    }
  }

  onAction(action) {
    switch (action) {
      case 'toggle': // Alt+F
        if (this.mode === 'normal') this.setMode(this.ws().lastSpecialMode || 'fullscreen');
        else this.setMode('normal');
        break;
      case 'normal':
      case 'borderless':
      case 'fullscreen':
        this.setMode(this.mode === action && action !== 'normal' ? 'normal' : action);
        break;
      case 'top':
        this.setAlwaysOnTop(!this.ws().alwaysOnTop);
        break;
      case 'minimize':
        this.win.minimize();
        break;
      case 'maximize': {
        if (this.mode === 'fullscreen') break;
        const area = screen.getDisplayMatching(this.win.getBounds()).workArea;
        this.win.setBounds(fitBounds(area, this.video.width, this.video.height, this.extraH(), 1));
        break;
      }
      case 'close':
        this.win.close();
        break;
    }
  }

  setMode(mode) {
    if (!MODES.includes(mode)) return;
    const prev = this.mode;
    if (mode !== 'normal') this.store.set({ lastSpecialMode: mode });
    if (!this.win || this.win.isDestroyed()) {
      this.saveMode(mode);
      return this.emit('window', this.windowInfo(mode));
    }
    if (prev === mode) return;
    const win = this.win;
    if (prev === 'fullscreen') {
      this.mode = mode;
      win.setFullScreen(false);
      if (this.normalBounds) win.setBounds(this.adjustForBar(this.normalBounds, this.normalMode, mode));
    } else if (mode === 'fullscreen') {
      this.normalBounds = win.getBounds();
      this.normalMode = prev;
      this.mode = mode;
      this.enterFullscreen();
    } else {
      // normal <-> borderless: keep the video the same size; add/remove the title bar height.
      this.mode = mode;
      win.setBounds(this.adjustForBar(win.getBounds(), prev, mode));
    }
    this.applyAspect();
    this.saveMode(mode);
    this.sendMode(this.hintFor(mode));
    this.emit('window', this.windowInfo(mode));
  }

  adjustForBar(b, from, to) {
    const delta = (to === 'normal' ? TITLE_BAR : 0) - (from === 'normal' ? TITLE_BAR : 0);
    return { ...b, y: b.y - delta, height: b.height + delta };
  }

  enterFullscreen() {
    const win = this.win;
    // Make sure fullscreen happens on the chosen monitor.
    const area = this.display ? this.display.workArea : screen.getDisplayMatching(win.getBounds()).workArea;
    if (!isOnArea(win.getBounds(), area)) win.setBounds(fitBounds(area, this.video.width, this.video.height, 0));
    win.setFullScreen(true);
    this.sendMode(this.hintFor('fullscreen'));
  }

  // One-time hints for borderless and fullscreen.
  hintFor(mode) {
    const hints = this.ws().hints || {};
    if (mode === 'fullscreen' && !hints.fullscreen) {
      this.store.set({ hints: { ...hints, fullscreen: true } });
      return 'Press Esc or Alt+F to exit fullscreen — or move the mouse to the top edge for buttons (double-click the toolbar to exit).';
    }
    if (mode === 'borderless' && !hints.borderless) {
      this.store.set({ hints: { ...hints, borderless: true } });
      return 'Move the mouse to the top edge to move the window or get buttons. Alt+F returns to a normal window.';
    }
    return null;
  }

  setAlwaysOnTop(on) {
    this.store.set({ alwaysOnTop: on });
    if (this.win && !this.win.isDestroyed()) this.win.setAlwaysOnTop(on, 'floating');
    this.sendMode(null);
    this.emit('window', this.windowInfo(this.mode));
  }

  // Mode/bounds are remembered per monitor.
  saveMode(mode) {
    const ws = this.ws();
    const key = this.win && !this.win.isDestroyed()
      ? this.displayKey(screen.getDisplayMatching(this.normalBounds && mode === 'fullscreen' ? this.normalBounds : this.win.getBounds()))
      : this.displayKey(targetDisplay(ws.monitor));
    const byDisplay = { ...(ws.byDisplay || {}) };
    byDisplay[key] = { ...(byDisplay[key] || {}), mode };
    this.store.set({ byDisplay });
  }

  rememberBounds() {
    if (!this.win || this.win.isDestroyed() || this.mode === 'fullscreen' || this.win.isMinimized()) return;
    const bounds = this.win.getBounds();
    const key = this.displayKey(screen.getDisplayMatching(bounds));
    const byDisplay = { ...(this.ws().byDisplay || {}) };
    byDisplay[key] = { ...(byDisplay[key] || {}), bounds, mode: this.mode };
    this.store.set({ byDisplay });
  }

  // What the main screen's "Window" row should show.
  windowInfo(mode) {
    const ws = this.ws();
    const m = mode || ((ws.byDisplay || {})[this.displayKey(targetDisplay(ws.monitor))] || {}).mode || 'normal';
    return { mode: m, alwaysOnTop: !!ws.alwaysOnTop, monitor: ws.monitor || 'primary' };
  }
}

function debounce(fn, ms) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

module.exports = { MirrorController, listDisplays };
