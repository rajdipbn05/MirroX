// Interface logic: shows the phone's status and runs the Start/Stop button.

const $ = (id) => document.getElementById(id);
let current = null; // the phone being shown
let mirrorState = 'stopped';

function showDevices({ devices, error }) {
  // Stage 1 shows the first phone found (multiple phones come later).
  current = devices[0] || null;
  const dot = $('status-dot');
  dot.className = 'status-dot ' + (current ? current.status : '');

  if (!current) {
    $('device-name').textContent = 'No phone found';
    $('device-status').textContent = 'Plug your phone into this computer with a USB cable.';
    setHint(
      error ||
        'Phone already plugged in? USB Debugging is probably off on the phone. It needs to be turned on once — the step-by-step guide is coming in the next version.'
    );
  } else {
    $('device-name').textContent = current.name;
    const version = current.androidVersion ? ` · Android ${current.androidVersion}` : '';
    $('device-status').textContent = current.label + version;
    setHint(current.hint);
  }
  updateButton();
}

function setHint(text) {
  $('hint').hidden = !text;
  $('hint').textContent = text || '';
}

function setMessage(text, isError) {
  $('message').hidden = !text;
  $('message').textContent = text || '';
  $('message').className = 'message' + (isError ? ' error' : '');
}

function updateButton() {
  const btn = $('mirror-btn');
  const active = mirrorState === 'starting' || mirrorState === 'running';
  btn.textContent = mirrorState === 'starting' ? 'Starting… (click to cancel)' : active ? 'Stop Mirroring' : 'Start Mirroring';
  btn.classList.toggle('stop', active);
  btn.disabled = !active && !(current && current.status === 'ready');
}

$('mirror-btn').addEventListener('click', () => {
  if (mirrorState === 'starting' || mirrorState === 'running') return window.mirrox.stopMirror();
  if (current && current.status === 'ready') {
    setMessage('');
    window.mirrox.startMirror({ serial: current.serial, name: current.name });
  }
});

window.mirrox.onDevices(showDevices);
window.mirrox.onMirrorState(({ state, message }) => {
  mirrorState = state === 'error' ? 'stopped' : state;
  if (state === 'running') setMessage('Your phone screen is showing in a separate window. Close that window or press Stop to end.');
  else if (state === 'stopped') setMessage('');
  else if (state === 'error') setMessage(message, true);
  updateButton();
});

window.mirrox.getDevices().then((p) => p && showDevices(p));
