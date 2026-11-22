const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { SoundTap } = require('../src/main/android/sound-tap');
const { ObsAudioServer } = require('../src/main/obs-audio');
const P = require('../src/shared/scrcpy-protocol');

test('sound-only server options: no video, no control, playback + keep playing on the phone', () => {
  const a = P.serverArgs({ scid: '1', settings: { soundOnly: true, audioSource: 'playback', audioDup: true }, audio: true });
  for (const x of ['video=false', 'control=false', 'audio_codec=raw', 'audio_source=playback', 'audio_dup=true']) assert.ok(a.includes(x), x);
  assert.ok(!a.some((x) => x.startsWith('video_codec')));
});

function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p }, resolve);
    req.on('error', reject);
  });
}

test('game sound from a phone reaches the OBS link', async () => {
  const phonePort = 27800 + Math.floor(Math.random() * 50);
  const obsPort = 47200 + Math.floor(Math.random() * 50);
  const phone = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'fake-phone-server.js'), String(phonePort), 'sound-only'], { stdio: 'ignore' });
  const obs = new ObsAudioServer(obsPort);
  const tap = new SoundTap();
  try {
    await new Promise((r) => setTimeout(r, 700));
    obs.start();
    tap.on('pcm', (pcm) => obs.push(pcm));
    const states = [];
    tap.on('state', (s) => states.push(s.state));
    await tap.start({ testPort: phonePort });
    assert.strictEqual(tap.state, 'on', JSON.stringify(states));

    // The page OBS loads
    const page = await get(obsPort, '/');
    let html = '';
    for await (const c of page) html += c;
    assert.match(html, /MirroX game sound/);
    const worklet = await get(obsPort, '/pcm-worklet.js');
    assert.strictEqual(worklet.statusCode, 200);
    worklet.resume();

    // The sound stream: 16-bit stereo PCM, a 440 Hz tone from the fake phone
    const res = await get(obsPort, '/pcm');
    const chunks = [];
    let size = 0;
    await new Promise((resolve) => {
      res.on('data', (d) => {
        chunks.push(d);
        size += d.length;
        if (size >= 48000) resolve();
      });
      setTimeout(resolve, 3000);
    });
    res.destroy();
    assert.ok(size >= 48000, `received ${size} bytes`);
    const pcm = Buffer.concat(chunks);
    let peak = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    assert.ok(peak > 1000, `sound level ${peak}`);
  } finally {
    await tap.stop();
    obs.stop();
    phone.kill();
  }
});
