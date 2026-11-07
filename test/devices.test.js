const test = require('node:test');
const assert = require('node:assert');
const { parseDevices } = require('../src/main/android/devices');
const { friendlyError } = require('../src/main/android/mirror');

test('parses adb devices -l output', () => {
  const out = [
    '* daemon not running; starting now at tcp:5037',
    '* daemon started successfully',
    'List of devices attached',
    'R5CW12345AB            device usb:1-1 product:dm1qxxx model:SM_S911B device:dm1q transport_id:1',
    'ZY22ABCDEF             unauthorized usb:1-2 transport_id:2',
    '',
  ].join('\r\n');
  assert.deepStrictEqual(parseDevices(out), [
    { serial: 'R5CW12345AB', state: 'device', model: 'SM S911B' },
    { serial: 'ZY22ABCDEF', state: 'unauthorized', model: '' },
  ]);
});

test('empty list', () => {
  assert.deepStrictEqual(parseDevices('List of devices attached\n\n'), []);
});

test('friendly errors', () => {
  assert.match(friendlyError('ERROR: Device is unauthorized'), /Allow/);
  assert.match(friendlyError('ERROR: Could not find any ADB device'), /disconnected/);
});
