// End-to-end check of the packaged app (run on a real Windows machine in CI).
// Opens MirroX with no phone attached and verifies the phone helper (ADB) starts.
// Usage: node scripts/smoke-test.js <path to MirroX executable>

const fs = require('fs');
const { _electron } = require('playwright-core');

(async () => {
  const exe = process.argv[2];
  const app = await _electron.launch({ executablePath: exe, args: process.argv.slice(3), timeout: 60000 });
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
