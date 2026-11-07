// Decides what MirroX tells the user, from everything it can see:
// ADB's device list, USB devices Windows sees, and other running programs.
// Pure function (no side effects) so it can be unit-tested.

const path = require('path');
const { VENDORS, APPLE_VID, OEM_DRIVERS, CONFLICTING_APPS } = require('./known-devices');

const PHONE_HINT = /android|adb|mtp|ptp|phone|mobile|galaxy|moto|pixel|redmi|xiaomi|poco|oneplus|oppo|vivo|realme|huawei|honor|nokia/i;
const DRIVER_MISSING = 28; // Windows "drivers for this device are not installed"

function vidOf(id) {
  const m = /VID_([0-9A-F]{4})/i.exec(id);
  return m ? m[1].toUpperCase() : null;
}

// Android phones and iPhones visible on USB (whether or not ADB can see them).
function phonesOnUsb(usb) {
  const phones = new Map(); // vid -> {brand, key, driverUrl, name, needsDriver}
  let iphone = false;
  for (const d of usb || []) {
    const vid = vidOf(d.id);
    if (!vid) continue;
    if (vid === APPLE_VID) {
      if (/iphone|ipad|apple mobile/i.test(d.name)) iphone = true;
      continue;
    }
    const vendor = VENDORS[vid];
    if (!vendor) continue;
    const looksLikePhone = d.cls === 'WPD' || d.cls === 'AndroidUsbDeviceClass' || PHONE_HINT.test(d.name);
    if (!looksLikePhone) continue;
    const p = phones.get(vid) || { ...vendor, name: '', needsDriver: false };
    if (d.cls === 'WPD' && d.name) p.name = d.name; // the friendly model name, e.g. "Galaxy S23"
    if (d.error === DRIVER_MISSING) p.needsDriver = true;
    phones.set(vid, p);
  }
  return { phones: [...phones.values()], iphone };
}

// Other programs that may be holding the phone connection.
function findConflicts(procs, engineDir) {
  const ours = engineDir ? path.win32.normalize(engineDir).toLowerCase() : null;
  const found = new Map(); // app name -> pids
  for (const p of procs || []) {
    const fullPath = (p.path || '').toLowerCase();
    if (ours && fullPath.startsWith(ours)) continue; // our own helper
    let app = CONFLICTING_APPS.find((a) => a.match.test(p.name) || (p.path && a.match.test(p.path)));
    let appName = app && app.name;
    // Any other ADB or scrcpy copy holds the phone too, even if we don't know the app.
    if (!appName && /^(adb|scrcpy)\.exe$/i.test(p.name)) {
      appName = p.path ? `another phone tool (${p.path})` : 'another phone tool';
    }
    if (!appName) continue;
    if (!found.has(appName)) found.set(appName, []);
    found.get(appName).push(p.pid);
  }
  return [...found.entries()].map(([name, pids]) => ({ name, pids }));
}

function listNames(names) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function usbDetails(usb) {
  if (!usb) return 'USB check: not available on this system';
  const lines = usb.map((d) => `  ${d.name || '(no name)'} [${d.cls || '-'}] ${d.id}${d.error ? `  problem code ${d.error}` : ''}`);
  return `USB devices seen by Windows:\n${lines.join('\n') || '  (none)'}`;
}

// Main entry point. Returns what the main screen should show.
function classify({ devices = [], adbError = null, adbErrorDetails = null, usb = null, procs = null, engineDir = null }) {
  const phone = devices[0];

  // 1. ADB sees a phone.
  if (phone) {
    const version = phone.androidVersion ? `Android ${phone.androidVersion} · ` : '';
    if (phone.state === 'device')
      return { status: 'ready', serial: phone.serial, name: phone.name, title: phone.name, subtitle: `${version}Connected`, ready: true };
    if (phone.state === 'unauthorized')
      return {
        status: 'needs-permission',
        title: phone.name || 'Phone found',
        subtitle: 'Waiting for permission on your phone',
        message:
          'Look at your phone and tap "Allow" on the "Allow USB debugging?" message. Tick "Always allow from this computer" so it won\'t ask again. No message? Unplug the cable and plug it back in.',
      };
    return {
      status: 'connecting',
      title: phone.name || 'Phone found',
      subtitle: 'Connecting…',
      message: 'Hold on a moment. If this stays for long, unplug the cable and plug it back in.',
    };
  }

  const conflicts = findConflicts(procs, engineDir);
  const conflictNames = conflicts.map((c) => c.name);
  const closeAction = conflicts.length
    ? [{ type: 'close-apps', label: conflicts.length === 1 ? `Close ${conflicts[0].name} for me` : 'Close them for me', pids: conflicts.flatMap((c) => c.pids) }]
    : [];
  const conflictDetails = conflicts.length
    ? `Programs that may hold the phone:\n${conflicts.map((c) => `  ${c.name} (pid ${c.pids.join(', ')})`).join('\n')}`
    : 'Programs that may hold the phone: none found';
  const blocked = () => ({
    status: 'blocked',
    title: `${listNames(conflictNames)} ${conflicts.length === 1 ? 'is' : 'are'} blocking the connection`,
    subtitle: 'Another app is using your phone',
    message: `${listNames(conflictNames)} ${conflicts.length === 1 ? 'is' : 'are'} running and holding the connection to your phone, so MirroX can't reach it. Close ${
      conflicts.length === 1 ? 'it' : 'them'
    } (also check the icons near the clock, bottom-right of the screen) — MirroX will connect automatically.`,
    actions: closeAction,
    details: [adbErrorDetails, conflictDetails, usbDetails(usb)].filter(Boolean).join('\n\n'),
  });

  // 2. The phone connection helper itself is failing.
  if (adbError) {
    if (conflicts.length) return blocked();
    return {
      status: 'helper-error',
      title: 'Connection problem',
      subtitle: 'The phone connection helper is not working',
      message: adbError,
      details: [adbErrorDetails, conflictDetails, usbDetails(usb)].filter(Boolean).join('\n\n'),
    };
  }

  // 3. Use what Windows sees on USB.
  if (usb === null) {
    // No USB check on this system: best-effort advice.
    return {
      status: 'no-phone',
      title: 'No phone found',
      subtitle: 'Plug your phone into this computer with a USB cable',
      message: 'Phone already plugged in? USB Debugging is probably off on the phone.',
      actions: [{ type: 'guide', label: 'Show me how to turn it on' }],
    };
  }

  const { phones, iphone } = phonesOnUsb(usb);
  if (!phones.length) {
    if (iphone)
      return {
        status: 'iphone',
        title: 'iPhone detected',
        subtitle: 'iPhone support is coming soon',
        message: 'This version of MirroX works with Android phones. iPhone mirroring is coming in a later version.',
      };
    return {
      status: 'no-phone',
      title: 'No phone found',
      subtitle: 'Plug your phone into this computer with a USB cable',
      message:
        'Plugged in but not showing? Try another cable or USB port — some cables only charge and can\'t carry data.',
    };
  }

  const p = phones[0];
  const label = p.name || `${p.brand} phone`;
  if (p.needsDriver)
    return {
      status: 'needs-driver',
      title: label,
      subtitle: 'Windows needs a driver for this phone',
      message: `Windows is missing the USB driver for your ${p.brand} phone. Download it, install it (click Next until it finishes), then unplug and replug the phone.`,
      actions: [{ type: 'link', label: `Get the ${p.brand} driver`, url: p.driverUrl || OEM_DRIVERS }],
      details: [conflictDetails, usbDetails(usb)].join('\n\n'),
    };

  if (conflicts.length) return blocked();

  return {
    status: 'debugging-off',
    title: label,
    subtitle: 'USB Debugging is off',
    message: 'Your phone is plugged in, but USB Debugging is turned off. It only needs to be turned on once.',
    actions: [{ type: 'guide', label: 'Show me how to turn it on', brand: p.key }],
    details: [conflictDetails, usbDetails(usb)].join('\n\n'),
    brandKey: p.key,
  };
}

// Whether MirroX should look at USB / running programs for this situation.
function needsUsbScan({ devices }) {
  return !devices.length;
}
function needsProcessScan({ devices, adbError, usb }) {
  if (devices.length) return false;
  if (adbError) return true;
  return phonesOnUsb(usb).phones.length > 0;
}

module.exports = { classify, phonesOnUsb, findConflicts, needsUsbScan, needsProcessScan };
