// End-to-end check of the packaged app (run on a real Windows machine in CI).
//
// Usage: node scripts/smoke-test.js [scenario] <path to MirroX executable> [app args...]
// Scenarios:
//   (none)               no phone attached -> expect "No phone found", no error
//   --block-default-port another program holds ADB's default port 5037 without answering
//                        -> MirroX must still work ("No phone found")
//   --fake-conflict      a program named DouWan.exe is running and MirroX's own helper port
//                        is jammed -> MirroX must name DouWan as the blocker and offer to close it
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

  const mirror = app.windows().find((w) => w !== main) || (await app.waitForEvent('window', { timeout: 10000 }));
  await mirror.waitForTimeout(500);
  await mirror.screenshot({ path: 'smoke-mirror-normal.png' });

  // 2. Window starts normal, with a title bar and its buttons.
  check('starts as a normal window', (await mirror.getAttribute('body', 'class')) === 'mode-normal');
  check('title bar visible', await mirror.isVisible('#titlebar'));

  // 3. Click + key reach the phone.
  const box = await mirror.locator('#screen').boundingBox();
  await mirror.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await mirror.keyboard.press('a');
  await mirror.waitForTimeout(800);
  const touches = messages.filter((m) => m.msg === 'touch');
  check('click sent as touch down+up', touches.some((m) => m.action === 0) && touches.some((m) => m.action === 1), JSON.stringify(touches.slice(0, 2)));
  check('key sent', messages.some((m) => m.msg === 'key' && m.keycode === 29 && m.action === 0));
  const t = touches[0] || {};
  check('touch inside the phone screen', t.x > 0 && t.y > 0 && t.x < t.w && t.y < t.h, JSON.stringify(t));

  // 4. Window modes: Borderless button, Alt+F back to normal, Alt+F again to borderless.
  const mode = async () => (await mirror.getAttribute('body', 'class')).replace(/ .*/, '');
  await mirror.click('#titlebar [data-action="borderless"]');
  await mirror.waitForTimeout(600);
  check('Borderless button', (await mode()) === 'mode-borderless');
  await mirror.screenshot({ path: 'smoke-mirror-borderless.png' });
  await mirror.keyboard.press('Alt+f');
  await mirror.waitForTimeout(600);
  check('Alt+F returns to normal', (await mode()) === 'mode-normal');
  await mirror.keyboard.press('Alt+f');
  await mirror.waitForTimeout(600);
  check('Alt+F goes back to borderless', (await mode()) === 'mode-borderless');
  await mirror.keyboard.press('Alt+f');
  await mirror.waitForTimeout(600);
  await mirror.click('#titlebar [data-action="fullscreen"]');
  await mirror.waitForTimeout(1200);
  check('Fullscreen button', (await mode()) === 'mode-fullscreen');
  await mirror.screenshot({ path: 'smoke-mirror-fullscreen.png' });
  await mirror.keyboard.press('Escape');
  await mirror.waitForTimeout(1200);
  check('Esc leaves fullscreen', (await mode()) === 'mode-normal');

  // 5. The window reshapes when the "phone" rotates (the clip switches every 2 s).
  const shape = async () => {
    const c = await mirror.evaluate(() => ({ w: document.getElementById('screen').width, h: document.getElementById('screen').height }));
    const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('mirror.html')).getBounds());
    return { c, b };
  };
  let sh;
  for (let i = 0; i < 30; i++) {
    sh = await shape();
    if (sh.c.w > sh.c.h) break;
    await mirror.waitForTimeout(200);
  }
  await mirror.waitForTimeout(700);
  sh = await shape();
  check('window turns landscape with the phone', sh.c.w > sh.c.h && sh.b.width > sh.b.height, JSON.stringify(sh));
  await mirror.screenshot({ path: 'smoke-mirror-landscape.png' }).catch(() => {});

  // 6. Picture keeps coming after the "phone" rotates.
  await main.waitForTimeout(4500);
  note = (await main.textContent('#note-message').catch(() => '')) || '';
  check('still streaming after rotation', /Live: [1-9]\d* FPS/.test(note), note);
  await mirror.screenshot({ path: 'smoke-mirror-rotated.png' }).catch(() => {});

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

const EXPECT = {
  default: (r) => r.title === 'No phone found' && !r.details,
  '--block-default-port': (r) => r.title === 'No phone found' && !r.details,
  '--fake-conflict': (r) => /DouWan/.test(r.title) && /blocking/.test(r.title) && /Close/.test(r.actions),
};

(async () => {
  if (scenario === '--fake-phone') return fakePhoneTest();
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
