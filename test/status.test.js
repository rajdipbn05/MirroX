const test = require('node:test');
const assert = require('node:assert');
const { classify, phonesOnUsb, findConflicts } = require('../src/main/android/status');

const ENGINE = 'C:\\Users\\me\\AppData\\Local\\Temp\\abc\\resources\\engines\\scrcpy';
const SAMSUNG_USB = [
  { id: 'USB\\VID_04E8&PID_6860\\R5CW12345', name: 'SAMSUNG Mobile USB Composite Device', cls: 'USB', error: 0 },
  { id: 'USB\\VID_04E8&PID_6860&MI_00\\6&1234', name: 'Galaxy S23', cls: 'WPD', error: 0 },
];
const MOTO_DRIVERLESS = [
  { id: 'USB\\VID_22B8&PID_2E81\\ZY22', name: 'moto g57 power', cls: 'WPD', error: 0 },
  { id: 'USB\\VID_22B8&PID_2E81&MI_01\\7&99', name: 'ADB Interface', cls: '', error: 28 },
];
const MOUSE = [{ id: 'USB\\VID_046D&PID_C077\\5&1', name: 'USB Input Device', cls: 'HIDClass', error: 0 }];
const SAMSUNG_SSD = [{ id: 'USB\\VID_04E8&PID_4001\\123', name: 'USB Mass Storage Device', cls: 'USB', error: 0 }];

test('ready phone', () => {
  const s = classify({ devices: [{ serial: 'R5', state: 'device', name: 'Galaxy S23', androidVersion: '14' }] });
  assert.strictEqual(s.status, 'ready');
  assert.strictEqual(s.subtitle, 'Android 14 · Connected');
  assert.ok(s.ready);
});

test('waiting for permission', () => {
  assert.strictEqual(classify({ devices: [{ serial: 'R5', state: 'unauthorized', name: '' }] }).status, 'needs-permission');
});

test('nothing plugged in', () => {
  assert.strictEqual(classify({ usb: MOUSE, procs: [] }).status, 'no-phone');
});

test('a Samsung SSD is not mistaken for a phone', () => {
  assert.strictEqual(classify({ usb: SAMSUNG_SSD }).status, 'no-phone');
});

test('phone on USB but debugging off, with brand-specific guide', () => {
  const s = classify({ usb: SAMSUNG_USB, procs: [] });
  assert.strictEqual(s.status, 'debugging-off');
  assert.strictEqual(s.title, 'Galaxy S23');
  assert.strictEqual(s.actions[0].brand, 'samsung');
  assert.match(s.details, /Galaxy S23/);
});

test('missing driver', () => {
  const s = classify({ usb: MOTO_DRIVERLESS, procs: [] });
  assert.strictEqual(s.status, 'needs-driver');
  assert.match(s.actions[0].url, /^https:/);
});

test('DouWan holding the phone', () => {
  const procs = [
    { name: 'DouWan.exe', pid: 100, path: 'C:\\Program Files (x86)\\DouWan\\DouWan.exe' },
    { name: 'adb.exe', pid: 101, path: 'C:\\Program Files (x86)\\DouWan\\tools\\adb.exe' },
    { name: 'adb.exe', pid: 102, path: ENGINE + '\\adb.exe' }, // ours: ignored
    { name: 'PhoneExperienceHost.exe', pid: 103, path: 'C:\\Program Files\\WindowsApps\\Phone\\PhoneExperienceHost.exe' },
  ];
  const s = classify({ usb: SAMSUNG_USB, procs, engineDir: ENGINE });
  assert.strictEqual(s.status, 'blocked');
  assert.match(s.title, /^DouWan is blocking/);
  assert.deepStrictEqual(s.actions[0].pids, [100, 101]);
  assert.strictEqual(s.actions[0].label, 'Close DouWan for me');
});

test('unknown adb copy is reported with its location', () => {
  const c = findConflicts([{ name: 'adb.exe', pid: 7, path: 'C:\\tools\\platform-tools\\adb.exe' }], ENGINE);
  assert.match(c[0].name, /platform-tools/);
});

test('helper error with a conflicting app names the app', () => {
  const s = classify({
    adbError: 'helper not responding',
    adbErrorDetails: 'Command: adb devices -l',
    procs: [{ name: 'Vysor.exe', pid: 5, path: '' }],
    usb: [],
  });
  assert.strictEqual(s.status, 'blocked');
  assert.match(s.details, /Command: adb devices/);
});

test('helper error without conflicts keeps details', () => {
  const s = classify({ adbError: 'oops', adbErrorDetails: 'X', procs: [], usb: [] });
  assert.strictEqual(s.status, 'helper-error');
  assert.match(s.details, /X/);
});

test('iPhone', () => {
  const usb = [{ id: 'USB\\VID_05AC&PID_12A8\\00008', name: 'Apple Mobile Device USB Composite Device', cls: 'USB', error: 0 }];
  assert.strictEqual(classify({ usb }).status, 'iphone');
  assert.strictEqual(phonesOnUsb(usb).phones.length, 0);
});

test('every problem state has Show details (except plain no-phone / iPhone / waiting)', () => {
  for (const s of [
    classify({ usb: SAMSUNG_USB, procs: [] }),
    classify({ usb: MOTO_DRIVERLESS, procs: [] }),
    classify({ adbError: 'x', adbErrorDetails: 'y', procs: [], usb: [] }),
  ])
    assert.ok(s.details, s.status);
});
