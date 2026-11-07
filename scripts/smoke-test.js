// End-to-end check of the packaged app (run on a real Windows machine in CI).
//
// Usage: node scripts/smoke-test.js [scenario] <path to MirroX executable> [app args...]
// Scenarios:
//   (none)               no phone attached -> expect "No phone found", no error
//   --block-default-port another program holds ADB's default port 5037 without answering
//                        -> MirroX must still work ("No phone found")
//   --fake-conflict      a program named DouWan.exe is running and MirroX's own helper port
//                        is jammed -> MirroX must name DouWan as the blocker and offer to close it
//   --bar                (Windows) a stand-in for scrcpy's window that goes fullscreen on Alt+F:
//                        the MirroX bar must sit on top of it, its Fullscreen button must work,
//                        the bar must hide in fullscreen and the Exit button must bring it back
//   --fake-phone         a pretend phone (scripts/fake-phone-server.js) streams video + sound:
//                        the mirror window must show frames, send clicks/keys to the "phone",
//                        and switch window modes with its buttons and Alt+F

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { _electron } = require('playwright-core');

const argv = process.argv.slice(2);
const scenario = argv[0].startsWith('--') ? argv.shift() : 'default';
const [exe, ...appArgs] = argv;

// Write synchronously: on Windows, console.log output can be lost if the process exits right after.
const out = (line) => fs.writeSync(1, line + '\n');
const cleanups = []; // child processes to stop however the test ends
const fail = (title, msg) => {
  for (const c of cleanups) {
    try {
      c();
    } catch {}
  }
  out(`::error title=${title}::${String(msg).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
  process.exit(1);
};
process.on('uncaughtException', (err) => fail('Smoke test crashed (uncaught)', err.stack || err));
setTimeout(() => fail('Smoke test timed out', 'Did not finish within 3 minutes.'), 180000).unref();

// A TCP server that accepts connections and never replies (like a stuck helper).
function jamPort(port) {
  const held = [];
  return new Promise((resolve, reject) =>
    net
      .createServer((s) => {
        s.on('error', () => {}); // the app may reset the connection when it gives up — that's expected
        held.push(s);
      })
      .on('error', reject)
      .listen(port, '127.0.0.1', resolve)
  );
}

// Runs a copy of node renamed to DouWan.exe, so it looks like DouWan in the process list.
function fakeDouWan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'DouWan-'));
  const fake = path.join(dir, process.platform === 'win32' ? 'DouWan.exe' : 'DouWan');
  fs.copyFileSync(process.execPath, fake);
  fs.chmodSync(fake, 0o755);
  const child = spawn(fake, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' });
  child.on('error', (err) => fail('Could not start fake DouWan', err.stack || err));
  return child;
}

// ---------- --fake-phone scenario ----------
async function fakePhoneTest() {
  const port = 27950 + Math.floor(Math.random() * 40);
  const server = spawn(process.execPath, [path.join(__dirname, 'fake-phone-server.js'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  cleanups.push(() => server.kill());
  const messages = [];
  let buf = '';
  server.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) if (l.trim()) messages.push(JSON.parse(l));
  });
  await new Promise((r) => setTimeout(r, 1000));

  const app = await _electron.launch({ executablePath: exe, args: appArgs, timeout: 60000, env: { ...process.env, MIRROX_TEST_MIRROR_PORT: String(port) } });
  const main = await app.firstWindow();
  const results = {};
  const check = (name, ok, info = '') => {
    results[name] = ok ? 'ok' : `FAILED ${info}`;
  };

  // 1. Frames arrive and are counted.
  let note = '';
  for (let i = 0; i < 40 && !/Live: [1-9]\d* FPS/.test(note); i++) {
    await main.waitForTimeout(500);
    note = (await main.textContent('#note-message').catch(() => '')) || '';
  }
  check('video frames shown', /Live: [1-9]\d* FPS/.test(note), note);

  // The mirror window is replaced when switching normal <-> borderless: always use the newest one.
  const M = () => app.windows().filter((w) => !w.isClosed() && w.url().includes('mirror.html')).pop();
  const framesIn = async (page) => page.evaluate(() => window.__frames || 0).catch(() => 0);
  const pictureFlows = async () => {
    // Wait for a (new) window, then check that frames keep arriving in it.
    for (let i = 0; i < 40; i++) {
      const page = M();
      if (page) {
        const a = await framesIn(page);
        await page.waitForTimeout(700).catch(() => {});
        if ((await framesIn(page)) > a && a >= 0 && page === M()) return true;
      } else await main.waitForTimeout(250);
    }
    return false;
  };
  const mode = async () => ((await M().getAttribute('body', 'class')) || '').replace(/ .*/, '');
  const frameKind = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().filter((x) => x.webContents.getURL().includes('mirror.html')).pop();
    return w ? { fullscreen: w.isFullScreen(), title: w.getTitle() } : null;
  });

  check('picture shows in the mirror window', await pictureFlows());
  await M().screenshot({ path: 'smoke-mirror-normal.png' });

  // 2. Window starts normal, with the toolbar and its buttons.
  check('starts as a normal window', (await mode()) === 'mode-normal');
  check('toolbar visible', await M().isVisible('#toolbar'));
  check('window title kept', /MirroX — Test phone/.test(((await frameKind()) || {}).title || ''));

  // 3. Click + key reach the phone.
  const box = await M().locator('#screen').boundingBox();
  await M().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await M().keyboard.press('a');
  await M().waitForTimeout(800);
  const touches = messages.filter((m) => m.msg === 'touch');
  check('click sent as touch down+up', touches.some((m) => m.action === 0) && touches.some((m) => m.action === 1), JSON.stringify(touches.slice(0, 2)));
  check('key sent', messages.some((m) => m.msg === 'key' && m.keycode === 29 && m.action === 0));
  const t = touches[0] || {};
  check('touch inside the phone screen', t.x > 0 && t.y > 0 && t.x < t.w && t.y < t.h, JSON.stringify(t));

  // 4. Window modes. Borderless swaps the window: the picture must continue.
  await M().click('#toolbar [data-action="borderless"]');
  await main.waitForTimeout(1500);
  check('Borderless button', (await mode()) === 'mode-borderless');
  check('picture continues in borderless', await pictureFlows());
  await M().screenshot({ path: 'smoke-mirror-borderless.png' });
  await M().keyboard.press('Alt+f');
  await main.waitForTimeout(1500);
  check('Alt+F returns to normal', (await mode()) === 'mode-normal');
  check('picture continues back in normal', await pictureFlows());
  await M().keyboard.press('Alt+f');
  await main.waitForTimeout(1500);
  check('Alt+F goes back to borderless', (await mode()) === 'mode-borderless');
  await M().keyboard.press('Alt+f');
  await main.waitForTimeout(1500);
  await M().click('#toolbar [data-action="fullscreen"]');
  await main.waitForTimeout(1500);
  check('Fullscreen button', (await mode()) === 'mode-fullscreen');
  await M().screenshot({ path: 'smoke-mirror-fullscreen.png' });
  await M().keyboard.press('Escape');
  await main.waitForTimeout(1500);
  check('Esc leaves fullscreen', (await mode()) === 'mode-normal' && !((await frameKind()) || {}).fullscreen);
  check('picture continues after fullscreen', await pictureFlows());
  check('only one mirror window open', app.windows().filter((w) => !w.isClosed() && w.url().includes('mirror.html')).length === 1);

  // 5. The window reshapes when the "phone" rotates (the clip switches every 2 s).
  const shape = async () => {
    const c = await M().evaluate(() => ({ w: document.getElementById('screen').width, h: document.getElementById('screen').height, decoderErrors: window.__decoderErrors }));
    const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('mirror.html')).pop().getContentBounds());
    return { c, b };
  };
  // Sample for ~7 s (the fake phone rotates every 2 s): picture AND window must be seen landscape
  // together, and portrait together.
  const seen = { landscape: false, portrait: false };
  let sh;
  for (let i = 0; i < 28 && !(seen.landscape && seen.portrait); i++) {
    sh = await shape();
    if (sh.c.w > sh.c.h && sh.b.width > sh.b.height) seen.landscape = true;
    if (sh.c.w < sh.c.h && sh.b.width < sh.b.height) seen.portrait = true;
    if (seen.landscape && !seen.portrait) await M().screenshot({ path: 'smoke-mirror-landscape.png' }).catch(() => {});
    await main.waitForTimeout(250);
  }
  check('window turns landscape and back with the phone', seen.landscape && seen.portrait, JSON.stringify({ seen, last: sh }));

  // 6. Picture keeps coming after the "phone" rotates.
  await main.waitForTimeout(4500);
  note = (await main.textContent('#note-message').catch(() => '')) || '';
  check('still streaming after rotation', /Live: [1-9]\d* FPS/.test(note), note);
  await M().screenshot({ path: 'smoke-mirror-rotated.png' }).catch(() => {});

  const report = `scenario: --fake-phone\nlast status: ${note.replace(/\n/g, ' | ')}\n` + Object.entries(results).map(([k, v]) => `${k}: ${v}`).join('\n');
  out(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + report + '\n```\n');
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
  try {
    app.process().kill();
  } catch {}
  server.kill();
  if (Object.values(results).some((v) => v !== 'ok')) fail('Fake phone test failed', report);
  out('Smoke test passed (--fake-phone).');
  process.exit(0);
}

// ---------- --bar scenario ----------
const FAKE_SCRCPY_WINDOW = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object Windows.Forms.Form
$f.Text = 'Fake scrcpy window'
$f.StartPosition = 'Manual'; $f.Left = 300; $f.Top = 250; $f.Width = 420; $f.Height = 640
$f.BackColor = 'Black'
$f.KeyPreview = $true
$f.Add_KeyDown({ param($s, $e)
  if ($e.Alt -and $e.KeyCode -eq 'F') {
    if ($s.FormBorderStyle -eq 'None') { $s.WindowState = 'Normal'; $s.FormBorderStyle = 'Sizable' }
    else { $s.FormBorderStyle = 'None'; $s.WindowState = 'Maximized' }
    $e.Handled = $true; $e.SuppressKeyPress = $true
  }
})
[Windows.Forms.Application]::Run($f)
`;

async function barTest() {
  const fake = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(FAKE_SCRCPY_WINDOW, 'utf16le').toString('base64')], { stdio: 'ignore' });
  cleanups.push(() => fake.kill());
  await new Promise((r) => setTimeout(r, 4000));
  const app = await _electron.launch({ executablePath: exe, args: appArgs, timeout: 60000, env: { ...process.env, MIRROX_TEST_BAR_PID: String(fake.pid) } });
  cleanups.push(() => app.process().kill());
  const main = await app.firstWindow();
  const results = {};
  const check = (name, ok, info = '') => (results[name] = ok ? 'ok' : `FAILED ${info}`);
  const barState = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => /bar\.html\?pill=0/.test(x.webContents.getURL()));
    return w ? { visible: w.isVisible(), bounds: w.getBounds() } : null;
  });
  const waitFor = async (fn, ms = 10000) => {
    const until = Date.now() + ms;
    let v;
    while (Date.now() < until) {
      v = await fn();
      if (v && v.ok) return v;
      await main.waitForTimeout(250);
    }
    return v || {};
  };

  // 1. Bar appears on top of the window (form at x=300, y=250; allow for frame/border differences).
  const placed = await waitFor(async () => {
    const b = await barState();
    return { ok: !!b && b.visible && Math.abs(b.bounds.x - 300) <= 16 && Math.abs(b.bounds.y + b.bounds.height - 250) <= 16, b };
  });
  check('bar sits on top of the mirror window', placed.ok, JSON.stringify(placed.b));
  const barPage = app.windows().find((w) => /bar\.html\?pill=0/.test(w.url()));
  if (barPage) await barPage.screenshot({ path: 'smoke-bar.png' }).catch(() => {});
  check('bar shows the phone name', barPage && (await barPage.textContent('#name')) === 'Test phone');

  // 2. Fullscreen button -> Alt+F to the window -> it goes fullscreen -> bar hides.
  if (barPage) await barPage.click('#fullscreen');
  const hidden = await waitFor(async () => {
    const b = await barState();
    return { ok: !!b && !b.visible, b };
  });
  check('Fullscreen button works and bar hides in fullscreen', hidden.ok, JSON.stringify(hidden.b));

  // 3. "Exit fullscreen" (the top-edge button) -> back to a normal window -> bar returns.
  const pillPage = app.windows().find((w) => /bar\.html\?pill=1/.test(w.url()));
  if (pillPage) await pillPage.evaluate(() => document.getElementById('exit').click());
  const back = await waitFor(async () => {
    const b = await barState();
    return { ok: !!b && b.visible && Math.abs(b.bounds.y + b.bounds.height - 250) <= 16, b };
  });
  check('Exit fullscreen brings the bar back', back.ok, JSON.stringify(back.b));

  const report = 'scenario: --bar\n' + Object.entries(results).map(([k, v]) => `${k}: ${v}`).join('\n');
  out(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + report + '\n```\n');
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  if (Object.values(results).some((v) => v !== 'ok')) fail('Bar test failed', report);
  for (const c of cleanups) {
    try {
      c();
    } catch {}
  }
  out('Smoke test passed (--bar).');
  process.exit(0);
}

const EXPECT = {
  default: (r) => r.title === 'No phone found' && !r.details,
  '--block-default-port': (r) => r.title === 'No phone found' && !r.details,
  '--fake-conflict': (r) => /DouWan/.test(r.title) && /blocking/.test(r.title) && /Close/.test(r.actions),
};

(async () => {
  if (scenario === '--fake-phone') return fakePhoneTest();
  if (scenario === '--bar') return barTest();
  if (!EXPECT[scenario]) fail('Bad scenario', scenario);
  let douwan;
  if (scenario === '--block-default-port') await jamPort(5037);
  if (scenario === '--fake-conflict') {
    await jamPort(15037);
    douwan = fakeDouWan();
  }

  const app = await _electron.launch({ executablePath: exe, args: appArgs, timeout: 60000 });
  const page = await app.firstWindow();

  const read = async () => ({
    title: await page.textContent('#phone-name'),
    subtitle: await page.textContent('#phone-subtitle'),
    message: await page.textContent('#help-message'),
    actions: await page.textContent('#help-actions'),
    details: await page.textContent('#details'),
    button: await page.textContent('#mirror-btn'),
  });

  // Wait until the expected screen appears (up to 100 s), then report.
  let r;
  const until = Date.now() + 100000;
  do {
    await page.waitForTimeout(2000);
    r = await read();
  } while (!EXPECT[scenario](r) && Date.now() < until);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `smoke-${scenario.replace(/^--/, '')}.png` });

  const report = `scenario: ${scenario}\n` + Object.entries(r).map(([k, v]) => `${k}: ${v}`).join('\n');
  out(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + report + '\n```\n');

  // Close the app, but don't let a slow shutdown hang the test.
  await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
  try {
    app.process().kill();
  } catch {}
  if (douwan) douwan.kill();
  if (!EXPECT[scenario](r)) fail(`Unexpected screen (${scenario})`, report);
  out(`Smoke test passed (${scenario}).`);
  process.exit(0);
})().catch((err) => fail('Smoke test crashed', err.stack || err));
