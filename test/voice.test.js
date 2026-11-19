const test = require('node:test');
const assert = require('node:assert');
const { voiceArgs, VOICE_METHODS, DEFAULT_METHOD } = require('../src/main/android/voice');

test('voice capture: sound-only connection with the chosen microphone method', () => {
  const args = voiceArgs('ZY22', 'mic');
  for (const a of ['--serial=ZY22', '--no-video', '--no-control', '--no-window', '--require-audio', '--audio-source=mic'])
    assert.ok(args.includes(a), a);
});

test('voice capture: unknown method falls back to voice chat mode', () => {
  assert.strictEqual(DEFAULT_METHOD, 'mic-voice-communication');
  assert.ok(voiceArgs('ZY22', 'nonsense').includes('--audio-source=mic-voice-communication'));
  assert.ok(Object.keys(VOICE_METHODS).every((m) => m.startsWith('mic')));
});
