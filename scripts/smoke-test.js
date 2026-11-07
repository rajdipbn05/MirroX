// End-to-end check of the packaged app (run on a real Windows machine in CI).
// Opens MirroX with no phone attached and verifies the phone helper (ADB) starts.
// Usage: node scripts/smoke-test.js [--block-default-port] <path to MirroX executable> [app args...]
//   --block-default-port  simulates another program holding ADB's default port 5037
//                         that accepts connections but never answers.

const fs = require('fs');
const net = require('net');
const { _electron } = require('playwright-core');

const argv = process.argv.slice(2);
const block = argv[0] === '--block-default-port' && argv.shift();

// Never let the test hang: fail after 2 minutes.
setTimeout(() => {
  console.log('::error title=Smoke test timed out::The app did not finish starting within 2 minutes.');
  process.exit(1);
}, 120000).unref();

(async () => {
  if (block) {
    const held = [];
    await new Promise((resolve, reject) =>
      net.createServer((sock) => held.push(sock)).on('error', reject).listen(5037, '127.0.0.1', resolve)
    );
    console.log('Blocking port 5037 with a server that never answers.');
  }
  const [exe, ...appArgs] = argv;
  const app = await _electron.launch({ executablePath: exe, args: appArgs, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForTimeout(20000); // give ADB time to start (antivirus scans on first run)

  const result = {
    name: await page.textContent('#device-name'),
    status: await page.textContent('#device-status'),
    hint: await page.textContent('#hint'),
    details: await page.textContent('#details'),
  };
  await page.screenshot({ path: 'smoke-screenshot.png' });
  await app.close();
  if (block) setTimeout(() => process.exit(process.exitCode || 0), 3000).unref();

  const report = Object.entries(result).map(([k, v]) => `${k}: ${v}`).join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + report + '\n```\n');

  if (result.details) {
    // Show the technical error as a GitHub annotation, then fail.
    console.log(`::error title=ADB failed to start::${report.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
    process.exit(1);
  }
  if (result.name !== 'No phone found') {
    console.log(`::error title=Unexpected state::${report.replace(/\r?\n/g, '%0A')}`);
    process.exit(1);
  }
  console.log('Smoke test passed: phone helper started and no phone was reported.');
})().catch((err) => {
  console.log(`::error title=Smoke test crashed::${String(err.stack || err).replace(/\r?\n/g, '%0A')}`);
  process.exit(1);
});
