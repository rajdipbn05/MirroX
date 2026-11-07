// Downloads the third-party engines (scrcpy + adb) that get bundled inside MirroX.
// Usage: node scripts/fetch-engines.js [win|linux]
// Files land in vendor/<os>/scrcpy and are copied into the app by electron-builder.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');
const extractZip = require('extract-zip');

const SCRCPY_VERSION = '5.0.1';
const BASE = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}`;

// Checksums from the official SHA256SUMS.txt of the release.
const TARGETS = {
  win: {
    file: `scrcpy-win64-v${SCRCPY_VERSION}.zip`,
    sha256: 'b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5',
  },
  linux: {
    file: `scrcpy-linux-x86_64-v${SCRCPY_VERSION}.tar.gz`,
    sha256: '9f969d30cc574816077edecda65719c1c70b0aee1df1ba5fa00779ac07b8fd6e',
  },
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location, dest));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  const os = process.argv[2] || (process.platform === 'win32' ? 'win' : 'linux');
  const target = TARGETS[os];
  if (!target) throw new Error(`Unknown target "${os}"`);

  const vendorDir = path.join(__dirname, '..', 'vendor', os);
  const finalDir = path.join(vendorDir, 'scrcpy');
  const marker = path.join(finalDir, '.version');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === SCRCPY_VERSION) {
    console.log(`scrcpy ${SCRCPY_VERSION} for ${os} already present.`);
    return;
  }

  fs.rmSync(vendorDir, { recursive: true, force: true });
  fs.mkdirSync(vendorDir, { recursive: true });
  const archive = path.join(vendorDir, target.file);
  console.log(`Downloading ${target.file} ...`);
  await download(`${BASE}/${target.file}`, archive);
  const actual = sha256(archive);
  if (actual !== target.sha256) throw new Error(`Checksum mismatch for ${target.file}: ${actual}`);

  const tmp = path.join(vendorDir, 'tmp');
  fs.mkdirSync(tmp);
  if (archive.endsWith('.zip')) await extractZip(archive, { dir: path.resolve(tmp) });
  else execFileSync('tar', ['xzf', archive, '-C', tmp]);

  const [inner] = fs.readdirSync(tmp);
  fs.renameSync(path.join(tmp, inner), finalDir);
  fs.rmSync(tmp, { recursive: true });
  fs.rmSync(archive);
  fs.writeFileSync(marker, SCRCPY_VERSION);
  console.log(`scrcpy ${SCRCPY_VERSION} for ${os} ready in ${finalDir}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
