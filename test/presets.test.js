const test = require('node:test');
const assert = require('node:assert');
const { PRESETS, effectiveSettings, sanitize, buildArgs } = require('../src/main/android/presets');
const { parseStats } = require('../src/main/android/mirror');

const dev = { serial: 'ZY22', name: 'moto g57 power' };

test('Gaming preset: high fps, high bitrate, fullscreen, borderless, low-delay', () => {
  const args = buildArgs(dev, effectiveSettings({ preset: 'gaming' }));
  for (const a of ['--max-fps=120', '--video-bit-rate=16M', '--max-size=1920', '--fullscreen', '--window-borderless', '--video-codec=h264', '--video-codec-options=priority:int=0', '--print-fps', '--serial=ZY22'])
    assert.ok(args.includes(a), a);
  assert.ok(!args.includes('--no-audio'));
});

test('Normal preset: windowed, 60 fps, no codec tweaks', () => {
  const args = buildArgs(dev, effectiveSettings({ preset: 'normal' }));
  assert.ok(args.includes('--max-fps=60'));
  assert.ok(!args.includes('--fullscreen'));
  assert.ok(!args.some((a) => a.startsWith('--video-codec')));
});

test('retry without codec options', () => {
  const args = buildArgs(dev, PRESETS.gaming.settings, { codecOptions: false });
  assert.ok(!args.some((a) => a.startsWith('--video-codec-options')));
});

test('custom settings are used and kept in range', () => {
  const s = effectiveSettings({ preset: 'custom', custom: { maxSize: 0, bitrate: 999, maxFps: 77, audio: false } });
  assert.strictEqual(s.maxSize, 0);
  assert.strictEqual(s.bitrate, 40);
  assert.strictEqual(s.maxFps, 60);
  const args = buildArgs(dev, s);
  assert.ok(!args.some((a) => a.startsWith('--max-size')));
  assert.ok(args.includes('--no-audio'));
});

test('damaged settings fall back safely', () => {
  assert.deepStrictEqual(sanitize({}).maxFps, 60);
  assert.ok(effectiveSettings(null).fullscreen); // default = Gaming
});

test('reads FPS and picture size from scrcpy output', () => {
  assert.deepStrictEqual(parseStats('INFO: 118 fps'), { fps: 118, skipped: 0 });
  assert.deepStrictEqual(parseStats('INFO: 57 fps (+3 frames skipped)'), { fps: 57, skipped: 3 });
  assert.deepStrictEqual(parseStats('INFO: Texture: 1920x864'), { width: 1920, height: 864 });
  assert.strictEqual(parseStats('INFO: Renderer: direct3d'), null);
});
