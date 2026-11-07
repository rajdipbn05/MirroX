// End-to-end check of the packaged app (run on a real Windows machine in CI).
//
// Usage: node scripts/smoke-test.js [scenario] <path to MirroX executable> [app args...]
// Scenarios:
//   (none)               no phone attached -> expect "No phone found", no error
//   --block-default-port another program holds ADB's default port 5037 without answering
//                        -> MirroX must still work ("No phone found")
//   --fake-conflict      a program named DouWan.exe is running and MirroX's own helper port
//                        is jammed -> MirroX must name DouWan as the blocker and offer to close it

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
const fail = (title, msg) => {
  out(`::error title=${title}::${String(msg).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
  process.exit(1);
};
setTimeout(() => fail('Smoke test timed out', 'Did not finish within 3 minutes.'), 180000).unref();

// A TCP server that accepts connections and never replies (like a stuck helper).
function jamPort(port) {
  const held = [];
  return new Promise((resolve, reject) =>
    net.createServer((s) => held.push(s)).on('error', reject).listen(port, '127.0.0.1', resolve)
  );
}

// Runs a copy of node renamed to DouWan.exe, so it looks like DouWan in the process list.
function fakeDouWan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'DouWan-'));
  const fake = path.join(dir, process.platform === 'win32' ? 'DouWan.exe' : 'DouWan');
  fs.copyFileSync(process.execPath, fake);
  fs.chmodSync(fake, 0o755);
  return spawn(fake, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' });
}

const EXPECT = {
  default: (r) => r.title === 'No phone found' && !r.details,
  '--block-default-port': (r) => r.title === 'No phone found' && !r.details,
  '--fake-conflict': (r) => /DouWan/.test(r.title) && /blocking/.test(r.title) && /Close/.test(r.actions),
};

(async () => {
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

  await app.close().catch(() => {});
  if (douwan) douwan.kill();
  if (!EXPECT[scenario](r)) fail(`Unexpected screen (${scenario})`, report);
  out(`Smoke test passed (${scenario}).`);
  process.exit(0);
})().catch((err) => fail('Smoke test crashed', err.stack || err));
