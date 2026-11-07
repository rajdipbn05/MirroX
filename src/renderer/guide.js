// Step-by-step instructions for turning on USB Debugging, per phone brand.
// (The full first-time setup walk-through builds on this in a later stage.)

const UNLOCK_NOTE = 'Enter your PIN if asked. You\'ll see "You are now a developer" or "Developer mode has been turned on".';
const ALLOW_STEP =
  'Plug the phone into this computer. On the phone, tap "Allow" on the "Allow USB debugging?" message, and tick "Always allow from this computer".';

window.USB_GUIDE = {
  samsung: {
    label: 'Samsung Galaxy',
    steps: [
      'Open Settings → About phone → Software information.',
      `Tap "Build number" 7 times quickly. ${UNLOCK_NOTE}`,
      'Go back to the main Settings page and scroll to the bottom. Tap "Developer options".',
      'Turn on "USB debugging" and tap OK.',
      ALLOW_STEP,
    ],
    tip: 'If Windows can\'t find your Galaxy, install the Samsung USB driver from developer.samsung.com/android-usb-driver.',
  },
  motorola: {
    label: 'Motorola',
    steps: [
      'Open Settings → About phone.',
      `Scroll down and tap "Build number" 7 times. ${UNLOCK_NOTE}`,
      'Go back and open Settings → System → Developer options.',
      'Turn on "USB debugging" and tap OK.',
      ALLOW_STEP,
    ],
  },
  pixel: {
    label: 'Google Pixel',
    steps: [
      'Open Settings → About phone.',
      `Scroll to the bottom and tap "Build number" 7 times. ${UNLOCK_NOTE}`,
      'Go back and open Settings → System → Developer options.',
      'Turn on "USB debugging" and tap OK.',
      ALLOW_STEP,
    ],
  },
  xiaomi: {
    label: 'Xiaomi / Redmi / POCO',
    steps: [
      'Open Settings → About phone.',
      `Tap "OS version" (or "MIUI version" on older phones) 7 times. ${UNLOCK_NOTE}`,
      'Go back and open Settings → Additional settings → Developer options.',
      'Turn on "USB debugging" and tap OK.',
      'Also turn on "USB debugging (Security settings)" — without it, the laptop\'s mouse and keyboard can\'t control the phone. (Xiaomi may ask you to sign in to a Mi account and insert a SIM card for this one.)',
      ALLOW_STEP,
    ],
  },
  oneplus: {
    label: 'OnePlus',
    steps: [
      'Open Settings → About device → Version.',
      `Tap "Build number" 7 times. ${UNLOCK_NOTE}`,
      'Go back and open Settings → System (or "Additional settings") → Developer options.',
      'Turn on "USB debugging" and tap OK.',
      ALLOW_STEP,
    ],
  },
  oppo: {
    label: 'OPPO / Realme',
    steps: [
      'Open Settings → About device (or "About phone") → Version.',
      `Tap "Build number" 7 times. ${UNLOCK_NOTE}`,
      'Go back and open Settings → Additional settings → Developer options.',
      'Turn on "USB debugging" and tap OK.',
      'If the mouse and keyboard can\'t control the phone later, also turn on "Disable permission monitoring" in Developer options.',
      ALLOW_STEP,
    ],
  },
  vivo: {
    label: 'vivo / iQOO',
    steps: [
      'Open Settings → About phone → Software version.',
      `Tap "Software version" 7 times. ${UNLOCK_NOTE}`,
      'Go back and open Settings → System management (or "More settings") → Developer options.',
      'Turn on "USB debugging" and tap OK.',
      ALLOW_STEP,
    ],
  },
  huawei: {
    label: 'Huawei / Honor',
    steps: [
      'Open Settings → About phone.',
      `Tap "Build number" 7 times. ${UNLOCK_NOTE}`,
      'Go back and open Settings → System & updates → Developer options.',
      'Turn on "USB debugging" and tap OK. Also turn on "Allow ADB debugging in charge only mode" if you see it.',
      ALLOW_STEP,
    ],
  },
  generic: {
    label: 'Other Android phones',
    steps: [
      'Open Settings → About phone (sometimes inside "System" or "Software information").',
      `Find "Build number" and tap it 7 times. ${UNLOCK_NOTE}`,
      'Go back to Settings and find "Developer options" (often under "System" or "Additional settings"). Use the Settings search box if you can\'t find it.',
      'Turn on "USB debugging" and tap OK.',
      ALLOW_STEP,
    ],
  },
};
