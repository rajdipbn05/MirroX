const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/shared/scrcpy-protocol');
const { KEYCODES } = require('../src/shared/keycodes');
const { fitBounds, isOnArea, isOnScreen, TOOLBAR } = require('../src/main/window-geometry');

test('touch message layout matches scrcpy 5.0.1 (32 bytes)', () => {
  const b = P.injectTouch(P.ACTION.DOWN, P.POINTER_ID_MOUSE, { x: 100, y: 200, width: 1080, height: 2400 }, 1, P.BUTTON.PRIMARY, P.BUTTON.PRIMARY);
  assert.strictEqual(b.length, 32);
  assert.strictEqual(b[0], 2);
  assert.strictEqual(b[1], 0);
  assert.strictEqual(b.readBigInt64BE(2), -1n);
  assert.strictEqual(b.readInt32BE(10), 100);
  assert.strictEqual(b.readInt32BE(14), 200);
  assert.strictEqual(b.readUInt16BE(18), 1080);
  assert.strictEqual(b.readUInt16BE(20), 2400);
  assert.strictEqual(b.readUInt16BE(22), 0xffff);
  assert.strictEqual(b.readUInt32BE(24), 1);
  assert.strictEqual(b.readUInt32BE(28), 1);
});

test('key, scroll, back, display power messages', () => {
  const k = P.injectKeycode(P.ACTION.UP, 29, 0, 1);
  assert.deepStrictEqual([k.length, k[0], k[1], k.readUInt32BE(2), k.readUInt32BE(10)], [14, 0, 1, 29, 1]);
  const s = P.injectScroll({ x: 1, y: 2, width: 3, height: 4 }, 0, -1);
  assert.strictEqual(s.length, 21);
  assert.strictEqual(s.readInt16BE(15), Math.round((-1 / 16) * 0x8000));
  assert.deepStrictEqual([...P.backOrScreenOn(0)], [4, 0]);
  assert.deepStrictEqual([...P.setDisplayPower(false)], [10, 0]);
});

test('stream headers: session, config, key frame', () => {
  const sess = Buffer.alloc(12);
  sess.writeUInt32BE(0x80000000, 0);
  sess.writeUInt32BE(1080, 4);
  sess.writeUInt32BE(2400, 8);
  assert.deepStrictEqual(P.parseHeader(sess), { session: true, width: 1080, height: 2400, clientResized: false });
  const cfg = Buffer.alloc(12);
  cfg.writeUInt32BE(0x40000000, 0);
  cfg.writeUInt32BE(30, 8);
  assert.strictEqual(P.parseHeader(cfg).config, true);
  const key = Buffer.alloc(12);
  key.writeUInt32BE(0x20000000, 0);
  key.writeUInt32BE(16667, 4);
  key.writeUInt32BE(5000, 8);
  assert.deepStrictEqual(P.parseHeader(key), { session: false, config: false, keyFrame: true, pts: 16667, size: 5000 });
});

test('codec string from SPS', () => {
  const cfg = Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x2a, 0xac, 0, 0, 0, 1, 0x68, 0xee]);
  assert.strictEqual(P.h264CodecString(cfg), 'avc1.64002A');
});

test('server arguments', () => {
  const args = P.serverArgs({ scid: '0000abcd', settings: { bitrate: 16, maxFps: 120, maxSize: 1920, lowLatency: true }, audio: true });
  for (const a of ['scid=0000abcd', 'tunnel_forward=true', 'video_codec=h264', 'video_bit_rate=16000000', 'max_fps=120', 'max_size=1920', 'audio_codec=raw', 'video_codec_options=priority:int=0'])
    assert.ok(args.includes(a), a);
  assert.ok(P.serverArgs({ scid: '1', settings: { bitrate: 8, maxFps: 60, maxSize: 0 }, audio: false }).includes('audio=false'));
});

test('keyboard map', () => {
  assert.strictEqual(KEYCODES.KeyW, 51);
  assert.strictEqual(KEYCODES.KeyA, 29);
  assert.strictEqual(KEYCODES.Space, 62);
  assert.strictEqual(KEYCODES.Digit0, 7);
  assert.strictEqual(KEYCODES.F1, 131);
});

test('window fits the screen at the phone shape (picture area)', () => {
  const area = { x: 0, y: 0, width: 1536, height: 816 };
  const b = fitBounds(area, 1080, 2400, TOOLBAR + 40);
  assert.ok(b.height + TOOLBAR + 40 <= 816 && b.width < b.height);
  assert.ok(Math.abs(b.height / b.width - 2400 / 1080) < 0.02);
  const l = fitBounds(area, 2400, 1080, TOOLBAR + 40);
  assert.ok(l.width > l.height && l.width <= 1536);
});

test('saved position is only reused if it is on that monitor', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.ok(isOnArea({ x: 100, y: 100, width: 400, height: 800 }, area));
  assert.ok(!isOnArea({ x: 2000, y: 100, width: 400, height: 800 }, area));
  assert.ok(!isOnScreen(null, [area]));
  assert.ok(isOnScreen({ x: 2000, y: 100, width: 400, height: 800 }, [area, { x: 1920, y: 0, width: 1920, height: 1080 }]));
});
