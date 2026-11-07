// Owns mirroring: starts the phone-side server, holds the connection (in this main process),
// and shows the picture in a mirror window. The window can be swapped without dropping the
// connection, which is how "normal" (real Windows title bar) and "borderless" (no frame) work:
//
//   normal      a standard window: Windows' own title bar, move/resize/snap/maximize as usual,
//               plus a slim MirroX toolbar (Borderless, Fullscreen, Always on top)
//   borderless  a frameless window; move the mouse to the top edge for a drag handle + buttons
//   fullscreen  either window made fullscreen; top-edge toolbar, Esc, Alt+F
//
// Position, size, mode and always-on-top are remembered for next time.

const path = require('path');
const { EventEmitter } = require('events');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { ServerSession } = require('./android/session');
const { StreamClient } = require('./android/stream');
const { applyOrientation } = require('./android/orientation');
const { adb } = require('./android/adb');
const P = require('../shared/scrcpy-protocol');
const { TOOLBAR, fitBounds, isOnScreen } = require('./window-geometry');

const MODES = ['normal', 'borderless', 'fullscreen'];

class MirrorController extends EventEmitter {
  // store: { get(): settings.window, set(partial) } — persisted by main.js
  // getAnchor(): bounds of the main MirroX window (a first mirror window opens on that screen)
  constructor(store, getAnchor) {
    super();
    this.store = store;
    this.getAnchor = getAnchor;
    this.win = null;
    this.framed = true;
    this.mode = 'normal';
    this.video = { width: 1080, height: 2400 };
    this.session = null;
    this.client = null;
    this.restoreOrientation = null;
    this.endInfo = null;

    const mine = (e) => this.win && !this.win.isDestroyed() && e.sender === this.win.webContents;
    ipcMain.on('mirror:ready', (e) => mine(e) && this.onWindowReady());
    ipcMain.on('mirror:stats', (e, s) => mine(e) && this.emit('stats', s));
    ipcMain.on('mirror:control', (e, buf) => mine(e) && this.client && this.client.sendControl(Buffer.from(buf)));
    ipcMain.on('mirror:action', (e, a) => mine(e) && this.onAction(a));
    ipcMain.on('mirror:first-frame', (e) => mine(e) && this.emit('state', { state: 'running' }));
    ipcMain.on('mirror:need-key-frame', (e) => mine(e) && this.replay());
  }

  get running() {
    return !!this.win || !!this.starting;
  }

  ws() {
    return this.store.get();
  }

  // ---------- Start / stop ----------

  // device: { serial, name } or { testPort, name } (automated tests); perf: effective preset settings
  async start(device, perf) {
    if (this.running) return;
    this.starting = true;
    this.cancelled = false;
    this.endInfo = null;
    this.emit('state', { state: 'starting' });
    this.perf = perf;
    this.title = `MirroX — ${device.name}`;

    // Open the window straight away ("Connecting to your phone…").
    const ws = this.ws();
    const mode = MODES.includes(ws.mode) ? ws.mode : 'normal';
    this.openWindow(mode === 'borderless', this.initialContentBounds(mode === 'borderless'));
    this.mode = mode === 'fullscreen' ? 'normal' : mode;
    this.pendingFullscreen = mode === 'fullscreen';

    let port;
    let audio = perf.audio;
    let command = '';
    try {
      if (device.testPort) {
        port = device.testPort;
      } else {
        this.restoreOrientation = await applyOrientation(device.serial, perf.orientation).catch(() => null);
        const sdk = parseInt(await adb(['-s', device.serial, 'shell', 'getprop', 'ro.build.version.sdk']).catch(() => '0'), 10);
        this.session = new ServerSession(device.serial);
        this.session.on('exit', () => setTimeout(() => this.client && this.client.end(new Error('the phone-side server stopped')), 300));
        const r = await this.session.start({ settings: perf, audio: perf.audio, sdk });
        port = r.port;
        audio = r.audio;
        command = r.command;
      }
      if (this.cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });

      this.client = new StreamClient();
      this.wireClient(this.client);
      await this.client.connect(port, { audio });
      if (this.cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });
      if (perf.screenOff) this.client.sendControl(P.setDisplayPower(false));
    } catch (err) {
      this.starting = false;
      if (!err.cancelled) {
        const step = this.client ? this.client.step : 'starting the phone-side server';
        this.endInfo = {
          state: 'error',
          message: 'MirroX could not connect to your phone. Unplug the phone, plug it back in, and try again. If it keeps happening, click "Show details" and send the text.',
          details: [`Failed while: ${step}`, `${err.details || err.stack || err}`, command, this.serverLog()].filter(Boolean).join('\n\n'),
        };
      }
      return this.finish();
    }
    this.starting = false;
  }

  wireClient(c) {
    c.on('session', (s) => this.onVideoSize(s));
    c.on('video', (h, data) => {
      const pkt = { config: h.config, key: h.keyFrame, pts: h.pts, data };
      this.keepForReplay(pkt);
      this.sendToWindow('video', pkt);
    });
    c.on('audio-start', () => this.sendToWindow('audio-start'));
    c.on('audio', (data) => this.sendToWindow('audio', data));
    c.on('ended', async (err) => {
      if (this.cancelled) return;
      await new Promise((r) => setTimeout(r, 800)); // let the phone's last log lines arrive
      this.endInfo = {
        state: 'error',
        message: err && err.encoder
          ? 'Your phone could not start sending its screen at these settings. Try a lower resolution or quality in Advanced settings.'
          : 'Mirroring stopped: the connection to your phone was lost. Check the cable, then try again.',
        details: [`${(err && (err.stack || err)) || 'connection closed'}`, this.serverLog()].filter(Boolean).join('\n\n'),
      };
      this.finish();
    });
  }

  serverLog() {
    const log = this.session && this.session.log;
    return log ? `Phone-side log:\n${log.slice(-3000)}` : '';
  }

  stop() {
    this.cancelled = true;
    this.finish();
  }

  // Ends mirroring (any reason): close window + connection, undo phone changes, report.
  async finish() {
    if (this.finishing) return;
    this.finishing = true;
    this.starting = false;
    this.rememberBounds();
    const win = this.win;
    this.win = null;
    if (win && !win.isDestroyed()) win.destroy();
    if (this.client) this.client.close();
    this.client = null;
    const s = this.session;
    this.session = null;
    if (s) await s.stop();
    const restore = this.restoreOrientation;
    this.restoreOrientation = null;
    if (restore) await restore().catch(() => {});
    const info = this.endInfo || { state: 'stopped' };
    this.endInfo = null;
    this.finishing = false;
    this.emit('state', info);
  }

  // ---------- Windows ----------

  // Content area (picture + toolbar) for a new mirror window.
  initialContentBounds(frameless) {
    const ws = this.ws();
    const extra = frameless ? 0 : TOOLBAR;
    if (ws.bounds && isOnScreen(ws.bounds, screen.getAllDisplays().map((d) => d.workArea))) {
      // Keep the remembered position and width; the height follows the phone's shape.
      return { ...ws.bounds, height: Math.round(ws.bounds.width / this.ratio()) + extra };
    }
    const anchor = this.getAnchor && this.getAnchor();
    const display = anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay();
    const fit = fitBounds(display.workArea, this.video.width, this.video.height, extra + 40);
    return { ...fit, height: fit.height + extra };
  }

  openWindow(frameless, contentBounds) {
    const ws = this.ws();
    const win = new BrowserWindow({
      ...contentBounds,
      useContentSize: true,
      frame: !frameless, // normal = real Windows title bar; borderless = no frame
      thickFrame: true, // keeps Windows' resize edges and snapping, also without a frame
      resizable: true,
      minWidth: 160,
      minHeight: 160,
      show: false,
      title: this.title,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      alwaysOnTop: !!ws.alwaysOnTop,
      webPreferences: {
        // Only ever loads our local mirror.html.
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    win.setMenu(null);
    if (ws.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
    win.loadFile(path.join(__dirname, '..', 'renderer', 'mirror', 'mirror.html'));
    win.on('page-title-updated', (e) => e.preventDefault()); // keep "MirroX — phone name"

    const remember = debounce(() => this.rememberBounds(), 400);
    win.on('move', remember);
    win.on('resize', remember);
    win.on('leave-full-screen', () => {
      if (this.win === win && this.mode === 'fullscreen' && !this.switching) {
        this.mode = this.framed ? 'normal' : 'borderless';
        this.afterModeChange();
      }
    });
    // The user closing the mirror window = stop mirroring (but not when MirroX swaps windows).
    win.on('close', () => {
      if (this.win === win) {
        this.rememberBounds();
        this.win = null;
        this.cancelled = true;
        this.finish();
      }
    });

    const old = this.win;
    this.win = win;
    this.framed = !frameless;
    this.ready = false;
    win.once('ready-to-show', () => {
      win.show();
      if (old && !old.isDestroyed()) old.destroy(); // swap without a flicker
      this.applyAspect();
    });
    return win;
  }

  onWindowReady() {
    this.ready = true;
    this.win.webContents.send('init', { title: this.title, framed: this.framed, ...this.modeInfo() });
    if (this.client && this.client.session) this.sendToWindow('session', this.client.session);
    this.replay(); // a new window needs the picture from the last key frame on
    if (this.pendingFullscreen) {
      this.pendingFullscreen = false;
      this.setMode('fullscreen');
    }
  }

  // Keep the video since the last key frame, so a new window can start decoding right away.
  // (Asking the phone to restart its video instead made some phones drop the connection.)
  keepForReplay(pkt) {
    if (pkt.config) {
      this.replayConfig = pkt;
      this.replayFrames = [];
    } else if (pkt.key) {
      this.replayFrames = [pkt];
    } else if (this.replayFrames && this.replayFrames.length < 900) {
      this.replayFrames.push(pkt);
    } else {
      this.replayFrames = null; // too long since the last key frame: wait for the next one
    }
  }

  replay() {
    if (!this.replayConfig || !this.replayFrames || !this.replayFrames.length) return;
    this.sendToWindow('video', this.replayConfig);
    for (const pkt of this.replayFrames) this.sendToWindow('video', pkt);
  }

  sendToWindow(channel, payload) {
    if (this.win && !this.win.isDestroyed() && this.ready) this.win.webContents.send(channel, payload);
  }

  ratio() {
    return this.video.width / this.video.height;
  }

  applyAspect() {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.mode === 'fullscreen') this.win.setAspectRatio(0);
    else this.win.setAspectRatio(this.ratio(), { width: 0, height: this.framed ? TOOLBAR : 0 });
  }

  // The phone rotated (or the first picture arrived): match the window to the new shape.
  onVideoSize({ width, height }) {
    const flipped = width > height !== this.video.width > this.video.height;
    this.video = { width, height };
    this.sendToWindow('session', { width, height });
    if (!this.win || this.win.isDestroyed()) return;
    this.applyAspect();
    if (this.mode === 'fullscreen' || this.win.isMaximized()) return;
    const b = this.win.getContentBounds();
    const extra = this.framed ? TOOLBAR : 0;
    if (flipped) {
      const area = screen.getDisplayMatching(b).workArea;
      const fit = fitBounds(area, width, height, extra + 40);
      const h = fit.height + extra;
      this.win.setContentBounds({ width: fit.width, height: h, x: Math.round(b.x + b.width / 2 - fit.width / 2), y: Math.round(b.y + b.height / 2 - h / 2) });
    } else {
      this.win.setContentBounds({ ...b, height: Math.round(b.width / this.ratio()) + extra });
    }
  }

  onAction(action) {
    switch (action) {
      case 'toggle': // Alt+F: normal <-> the last used special mode
        this.setMode(this.mode === 'normal' ? this.ws().lastSpecialMode || 'fullscreen' : 'normal');
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
      case 'close':
        this.stop();
        break;
    }
  }

  setMode(mode) {
    if (!MODES.includes(mode)) return;
    if (mode !== 'normal') this.store.set({ lastSpecialMode: mode });
    this.store.set({ mode });
    if (!this.win || this.win.isDestroyed()) return this.emit('window', this.modeInfo(mode));
    if (mode === this.mode) return;

    const win = this.win;
    const prev = this.mode;
    this.switching = true; // ignore our own leave-full-screen event
    if (prev === 'fullscreen') win.setFullScreen(false);
    const needFrameless = mode === 'borderless' || (mode === 'fullscreen' && !this.framed);
    if (needFrameless === this.framed) {
      // Swap window type, keeping the picture area where it is.
      const b = prev === 'fullscreen' && this.normalBounds ? this.normalBounds : win.getContentBounds();
      const delta = needFrameless ? -TOOLBAR : TOOLBAR;
      this.mode = mode;
      this.openWindow(needFrameless, { ...b, y: b.y - delta, height: b.height + delta });
    } else {
      this.mode = mode;
    }
    if (mode === 'fullscreen') {
      if (prev !== 'fullscreen') this.normalBounds = win.getContentBounds();
      this.win.setFullScreen(true);
    } else if (prev === 'fullscreen' && this.win === win && this.normalBounds) {
      this.win.setContentBounds(this.normalBounds);
    }
    this.switching = false;
    this.afterModeChange();
  }

  afterModeChange() {
    this.applyAspect();
    this.sendToWindow('mode', { ...this.modeInfo(), hint: this.hintFor(this.mode) });
    this.emit('window', this.modeInfo());
  }

  // One-time hints for borderless and fullscreen.
  hintFor(mode) {
    const hints = this.ws().hints || {};
    if (mode === 'fullscreen' && !hints.fullscreen) {
      this.store.set({ hints: { ...hints, fullscreen: true } });
      return 'Press Esc, Alt+F, or double-click the top toolbar to exit fullscreen. Move the mouse to the top edge for buttons.';
    }
    if (mode === 'borderless' && !hints.borderless) {
      this.store.set({ hints: { ...hints, borderless: true } });
      return 'Move the mouse to the top edge to drag the window or get buttons. Resize from any edge. Alt+F returns to a normal window.';
    }
    return null;
  }

  setAlwaysOnTop(on) {
    this.store.set({ alwaysOnTop: on });
    if (this.win && !this.win.isDestroyed()) this.win.setAlwaysOnTop(on, 'floating');
    this.sendToWindow('mode', this.modeInfo());
    this.emit('window', this.modeInfo());
  }

  rememberBounds() {
    const win = this.win;
    if (!win || win.isDestroyed() || this.mode === 'fullscreen' || win.isMinimized() || win.isMaximized()) return;
    this.store.set({ bounds: win.getContentBounds() });
  }

  // What the main screen's "Window" row and the mirror window's buttons show.
  modeInfo(mode) {
    const ws = this.ws();
    return { mode: mode || (this.win ? this.mode : MODES.includes(ws.mode) ? ws.mode : 'normal'), alwaysOnTop: !!ws.alwaysOnTop };
  }
}

function debounce(fn, ms) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

module.exports = { MirrorController };
