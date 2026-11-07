// The MirroX bar attached to the top of the (classic) scrcpy mirror window.
//
//   - follows the mirror window when it moves/resizes, hides when it is minimized or when
//     another app is in front
//   - Fullscreen button (sends scrcpy's own Alt+F shortcut)
//   - in fullscreen the bar hides; moving the mouse to the top edge of the screen shows an
//     "Exit fullscreen" button
//
// Windows only (uses the window tracker); on other systems it does nothing.

const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { EventEmitter } = require('events');

const BAR_H = 34;
const PILL = { width: 210, height: 44 };

class ClassicBar extends EventEmitter {
  constructor() {
    super();
    this.bar = null;
    this.pill = null;
    this.tracker = null;
    this.info = { name: '', fps: null };
    ipcMain.on('bar:action', (e, action) => {
      if (!this.isMine(e)) return;
      if (action === 'fullscreen') this.toggleFullscreen();
      else this.emit('action', action); // 'stop'
    });
    ipcMain.on('bar:ready', (e) => this.isMine(e) && this.sendInfo());
  }

  isMine(e) {
    return [this.bar, this.pill].some((w) => w && !w.isDestroyed() && e.sender === w.webContents);
  }

  available() {
    return process.platform === 'win32';
  }

  // pid of scrcpy; name of the phone
  attach(pid, name) {
    if (!this.available()) return;
    this.detach();
    const { WindowTracker, pressKeys } = require('./platform/window-tracker');
    this.pressKeys = pressKeys;
    this.pid = pid;
    this.info = { name, fps: null };
    this.bar = this.makeWindow(false);
    this.pill = this.makeWindow(true);
    this.tracker = new WindowTracker(pid);
    this.tracker.on('rect', (r) => this.onRect(r));
    this.tracker.on('gone', () => this.detach());
    this.tracker.on('error', () => this.detach());
  }

  detach() {
    if (this.tracker) this.tracker.stop();
    this.tracker = null;
    clearInterval(this.cursorTimer);
    this.cursorTimer = null;
    for (const w of [this.bar, this.pill]) if (w && !w.isDestroyed()) w.destroy();
    this.bar = null;
    this.pill = null;
    this.fullscreen = false;
  }

  setStats(stats) {
    this.info.fps = stats.fps;
    this.sendInfo();
  }

  sendInfo() {
    for (const w of [this.bar, this.pill]) {
      if (w && !w.isDestroyed()) w.webContents.send('bar:info', { ...this.info, fullscreen: !!this.fullscreen });
    }
  }

  makeWindow(pill) {
    const w = new BrowserWindow({
      width: pill ? PILL.width : 400,
      height: pill ? PILL.height : BAR_H,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      alwaysOnTop: true,
      backgroundColor: '#14161b',
      webPreferences: {
        preload: path.join(__dirname, 'bar-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    w.setAlwaysOnTop(true, pill ? 'screen-saver' : 'floating');
    w.loadFile(path.join(__dirname, '..', 'renderer', 'bar', 'bar.html'), { query: { pill: pill ? '1' : '0' } });
    return w;
  }

  onRect(r) {
    if (!this.bar || this.bar.isDestroyed()) return;
    // Windows reports physical pixels; Electron windows use scaled ("DIP") units.
    const d = screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.width, height: r.height });
    const display = screen.getDisplayMatching(d);
    const b = display.bounds;
    const fullscreen = !r.minimized && Math.abs(d.x - b.x) <= 2 && Math.abs(d.y - b.y) <= 2 && Math.abs(d.width - b.width) <= 3 && Math.abs(d.height - b.height) <= 3;
    if (fullscreen !== this.fullscreen) {
      this.fullscreen = fullscreen;
      this.sendInfo();
      this.watchCursor(fullscreen ? display : null);
    }
    const ours = r.foregroundPid === this.pid || r.foregroundPid === process.pid;
    const showBar = !r.minimized && !fullscreen && ours && d.width > 80;
    if (!showBar) {
      if (this.bar.isVisible()) this.bar.hide();
      return;
    }
    const area = display.workArea;
    const y = d.y - BAR_H >= area.y ? d.y - BAR_H : d.y; // no room above: sit on the window's top
    this.bar.setBounds({ x: Math.round(d.x), y: Math.round(y), width: Math.round(d.width), height: BAR_H });
    if (!this.bar.isVisible()) this.bar.showInactive();
  }

  // In fullscreen: show the "Exit fullscreen" button when the mouse touches the top edge.
  watchCursor(display) {
    clearInterval(this.cursorTimer);
    this.cursorTimer = null;
    if (!display) {
      if (this.pill && !this.pill.isDestroyed()) this.pill.hide();
      return;
    }
    let awaySince = 0;
    this.cursorTimer = setInterval(() => {
      if (!this.pill || this.pill.isDestroyed()) return;
      const c = screen.getCursorScreenPoint();
      const b = display.bounds;
      const inX = c.x >= b.x && c.x < b.x + b.width;
      const atTop = inX && c.y <= b.y + 3;
      const overPill = this.pill.isVisible() && inX && c.y <= b.y + PILL.height + 16;
      if (atTop || overPill) {
        awaySince = 0;
        if (!this.pill.isVisible()) {
          this.pill.setBounds({ x: Math.round(b.x + (b.width - PILL.width) / 2), y: b.y + 8, ...PILL });
          this.pill.showInactive();
        }
      } else if (this.pill.isVisible()) {
        if (!awaySince) awaySince = Date.now();
        else if (Date.now() - awaySince > 1500) this.pill.hide();
      }
    }, 100);
  }

  async toggleFullscreen() {
    if (!this.pid || !this.pressKeys) return;
    if (this.pill && !this.pill.isDestroyed()) this.pill.hide();
    await this.pressKeys(this.pid, 'alt+f');
  }
}

module.exports = { ClassicBar, BAR_H };
