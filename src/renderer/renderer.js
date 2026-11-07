// Interface logic: shows the phone's status, help for each situation, and runs the Start/Stop button.

const $ = (id) => document.getElementById(id);
let phone = null; // latest phone state from the main process
let mirrorState = 'stopped';
let stats = {}; // live numbers while mirroring: fps, skipped, width, height
let cfg = null; // { settings, presets, choices } from the main process

// ---------- "Show details" / "Copy details" ----------
function detailsBox(prefix) {
  const toggle = $(prefix + 'details-toggle');
  const copy = $(prefix + 'details-copy');
  const pre = $(prefix + 'details');
  toggle.addEventListener('click', () => {
    pre.hidden = !pre.hidden;
    copy.hidden = pre.hidden;
    toggle.textContent = pre.hidden ? 'Show details' : 'Hide details';
  });
  copy.addEventListener('click', async () => {
    await window.mirrox.copyText(pre.textContent);
    copy.textContent = 'Copied ✓';
    setTimeout(() => (copy.textContent = 'Copy details'), 1500);
  });
  return (details) => {
    $(prefix + 'details-row').hidden = !details;
    if (pre.textContent !== (details || '')) pre.textContent = details || '';
    if (!details) {
      pre.hidden = true;
      copy.hidden = true;
      toggle.textContent = 'Show details';
    }
  };
}
const setHelpDetails = detailsBox('');
const setNoteDetails = detailsBox('m');

// ---------- Phone card + help panel ----------
function render() {
  const s = phone || { status: 'searching', title: 'Looking for your phone…', subtitle: 'Starting up' };
  const mirroring = mirrorState === 'running' || mirrorState === 'starting';
  $('phone-card').dataset.status = mirroring && s.ready ? 'mirroring' : s.status;
  $('phone-name').textContent = s.title;
  $('phone-subtitle').textContent =
    mirrorState === 'running' && s.ready
      ? `Mirroring${stats.fps != null ? ` · ${stats.fps} FPS` : ''}`
      : mirrorState === 'starting' && s.ready
        ? 'Starting…'
        : s.subtitle;

  $('help').hidden = !s.message;
  $('help-message').textContent = s.message || '';
  renderActions(s);
  setHelpDetails(s.details);
  updateButton();
}

function renderActions(s) {
  const box = $('help-actions');
  const key = JSON.stringify(s.actions || []);
  if (box.dataset.key === key) return; // keep buttons stable while polling
  box.dataset.key = key;
  box.textContent = '';
  for (const action of s.actions || []) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = action.label;
    btn.addEventListener('click', () => runAction(action, btn));
    box.appendChild(btn);
  }
}

async function runAction(action, btn) {
  if (action.type === 'guide') openGuide(action.brand);
  else if (action.type === 'link') window.mirrox.openLink(action.url);
  else if (action.type === 'close-apps') {
    btn.disabled = true;
    btn.textContent = 'Closing…';
    const result = await window.mirrox.closeApps();
    btn.disabled = false;
    btn.textContent = action.label;
    if (!result.ok)
      showNote(
        'MirroX couldn\'t close it automatically (it may need administrator rights). Please close it yourself — right-click its icon near the clock and choose Exit/Quit.',
        true,
        result.output
      );
  }
}

// ---------- Main button ----------
function updateButton() {
  const btn = $('mirror-btn');
  const active = mirrorState === 'starting' || mirrorState === 'running';
  btn.textContent = mirrorState === 'starting' ? 'Starting… (click to cancel)' : active ? 'Stop Mirroring' : 'Start Mirroring';
  btn.classList.toggle('stop', active);
  btn.disabled = !active && !(phone && phone.ready);
}

$('mirror-btn').addEventListener('click', () => {
  if (mirrorState === 'starting' || mirrorState === 'running') return window.mirrox.stopMirror();
  if (phone && phone.ready) {
    showNote('');
    window.mirrox.startMirror();
  }
});

function showNote(text, isError, details) {
  $('restart-btn').hidden = true;
  $('note').hidden = !text;
  $('note').classList.toggle('error', !!isError);
  $('note-message').textContent = text || '';
  setNoteDetails(details);
}

// ---------- USB Debugging guide ----------
function openGuide(brandKey) {
  const select = $('guide-brand');
  if (!select.options.length) {
    for (const [key, g] of Object.entries(window.USB_GUIDE)) select.add(new Option(g.label, key));
    select.addEventListener('change', () => showGuideBrand(select.value));
  }
  const key = window.USB_GUIDE[brandKey] ? brandKey : select.value || 'samsung';
  select.value = key;
  showGuideBrand(key);
  $('guide').hidden = false;
}

function showGuideBrand(key) {
  const g = window.USB_GUIDE[key];
  const list = $('guide-steps');
  list.textContent = '';
  for (const step of g.steps) {
    const li = document.createElement('li');
    li.textContent = step;
    list.appendChild(li);
  }
  $('guide-tip').hidden = !g.tip;
  $('guide-tip').textContent = g.tip || '';
}

const closeGuide = () => ($('guide').hidden = true);
$('open-guide').addEventListener('click', () => openGuide(phone && phone.brandKey));
$('guide-close').addEventListener('click', closeGuide);
$('guide-done').addEventListener('click', closeGuide);
$('guide').addEventListener('click', (e) => e.target === $('guide') && closeGuide());
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeGuide());

// ---------- Wiring ----------
window.mirrox.onPhoneState((s) => {
  // A new situation makes old messages (e.g. "couldn't close it") out of date.
  if (phone && s && phone.status !== s.status && mirrorState === 'stopped') showNote('');
  phone = s;
  render();
});

const RUNNING_NOTE = 'Your phone screen is showing in its own window. Close that window or press Stop to end. Alt+F switches fullscreen on and off; Esc also leaves fullscreen.';

function liveNote() {
  const parts = [];
  if (stats.fps != null) parts.push(`${stats.fps} FPS`);
  if (stats.width) parts.push(`picture ${stats.width}×${stats.height}`);
  if (stats.skipped) parts.push(`${stats.skipped} frames dropped by this computer`);
  if (stats.decodeMs != null) parts.push(`decoding ${stats.decodeMs} ms`);
  return parts.length ? `${RUNNING_NOTE}\nLive: ${parts.join(' · ')}` : RUNNING_NOTE;
}

window.mirrox.onMirrorStats((s) => {
  stats = s;
  if (mirrorState === 'running' && $('restart-btn').hidden) $('note-message').textContent = liveNote();
  render();
});

window.mirrox.onMirrorState(({ state, message, details }) => {
  mirrorState = state === 'error' ? 'stopped' : state;
  if (state === 'starting') stats = {};
  if (state === 'running') showNote(liveNote());
  else if (state === 'stopped') showNote('');
  else if (state === 'error') showNote(message, true, details);
  render();
});

// ---------- Presets + Advanced settings ----------
const FIELDS = ['audio', 'lowLatency', 'screenOff'];
let windowState = { mode: 'normal', alwaysOnTop: false };

function effective() {
  const { settings, presets } = cfg;
  return settings.preset !== 'custom' ? presets[settings.preset].settings : settings.custom;
}

function renderSettings() {
  const { settings, presets, choices } = cfg;
  const v = effective();
  for (const b of $('preset-seg').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.preset === settings.preset));
  $('preset-desc').textContent =
    settings.preset === 'custom' ? 'Your own settings from Advanced settings.' : presets[settings.preset].description;

  $('res').max = choices.resolutions.length - 1;
  $('res').value = Math.max(0, choices.resolutions.indexOf(v.maxSize));
  $('res-val').textContent = v.maxSize ? `${v.maxSize} px` : "Phone's full resolution";
  $('bitrate').min = choices.bitrateMin;
  $('bitrate').max = choices.bitrateMax;
  $('bitrate').value = v.bitrate;
  $('bitrate-val').textContent = `${v.bitrate} Mbps`;
  $('fps').max = choices.fps.length - 1;
  $('fps').value = Math.max(0, choices.fps.indexOf(v.maxFps));
  $('fps-val').textContent = `${v.maxFps} FPS`;
  $('orientation').value = v.orientation;
  for (const f of FIELDS) $(f).checked = !!v[f];
  $('newWindow').checked = !!settings.newWindow;
}

// ---------- Window quick toggles ----------
function renderWindow() {
  $('win-fullscreen').setAttribute('aria-pressed', String(windowState.mode === 'fullscreen'));
  $('win-borderless').setAttribute('aria-pressed', String(windowState.mode === 'borderless'));
  $('win-top').setAttribute('aria-pressed', String(!!windowState.alwaysOnTop));
}

async function setWindow(w) {
  windowState = await window.mirrox.setWindow(w);
  renderWindow();
  if (windowState.restart) {
    showNote('Borderless and Always on top apply when mirroring starts. Restart mirroring to use them.');
    $('restart-btn').hidden = false;
  }
}

// Fullscreen and Borderless are alternatives: clicking the active one returns to a normal window.
$('win-fullscreen').addEventListener('click', () => setWindow({ mode: windowState.mode === 'fullscreen' ? 'normal' : 'fullscreen' }));
$('win-borderless').addEventListener('click', () => setWindow({ mode: windowState.mode === 'borderless' ? 'normal' : 'borderless' }));
$('win-top').addEventListener('click', () => setWindow({ alwaysOnTop: !windowState.alwaysOnTop }));
$('newWindow').addEventListener('change', () => saveSettings({ preset: cfg.settings.preset, newWindow: $('newWindow').checked }));
window.mirrox.onWindowState((w) => {
  windowState = w;
  renderWindow();
});


async function saveSettings(next) {
  cfg.settings = await window.mirrox.setSettings(next);
  renderSettings();
  if (mirrorState === 'running' || mirrorState === 'starting') {
    showNote('Settings changed. Restart mirroring to use them.');
    $('restart-btn').hidden = false;
  }
}

// Changing any Advanced value switches to "Custom", starting from what was showing.
function changeCustom(field, value) {
  saveSettings({ preset: 'custom', custom: { ...effective(), [field]: value } });
}

$('preset-seg').addEventListener('click', (e) => {
  const preset = e.target.closest('button')?.dataset.preset;
  if (preset && preset !== cfg.settings.preset) saveSettings({ preset });
});
$('adv-toggle').addEventListener('click', () => {
  const open = $('advanced').hidden;
  $('advanced').hidden = !open;
  $('adv-toggle').textContent = open ? 'Advanced settings ▾' : 'Advanced settings ▸';
  $('adv-toggle').setAttribute('aria-expanded', String(open));
});
$('res').addEventListener('input', () => ($('res-val').textContent = cfg.choices.resolutions[$('res').value] ? `${cfg.choices.resolutions[$('res').value]} px` : "Phone's full resolution"));
$('res').addEventListener('change', () => changeCustom('maxSize', cfg.choices.resolutions[$('res').value]));
$('bitrate').addEventListener('input', () => ($('bitrate-val').textContent = `${$('bitrate').value} Mbps`));
$('bitrate').addEventListener('change', () => changeCustom('bitrate', Number($('bitrate').value)));
$('fps').addEventListener('input', () => ($('fps-val').textContent = `${cfg.choices.fps[$('fps').value]} FPS`));
$('fps').addEventListener('change', () => changeCustom('maxFps', cfg.choices.fps[$('fps').value]));
$('orientation').addEventListener('change', () => changeCustom('orientation', $('orientation').value));
for (const f of FIELDS) $(f).addEventListener('change', () => changeCustom(f, $(f).checked));
$('restart-btn').addEventListener('click', () => {
  showNote('');
  window.mirrox.restartMirror();
});

window.mirrox.getState().then((st) => {
  $('version').textContent = `v${st.version}`;
  cfg = { settings: st.settings, presets: st.presets, choices: st.choices };
  windowState = st.window;
  renderWindow();
  renderSettings();
  if (st.phone) phone = st.phone;
  render();
});
