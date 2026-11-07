// Interface logic: shows the phone's status, help for each situation, and runs the Start/Stop button.

const $ = (id) => document.getElementById(id);
let phone = null; // latest phone state from the main process
let mirrorState = 'stopped';

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
    mirrorState === 'running' && s.ready ? 'Mirroring' : mirrorState === 'starting' && s.ready ? 'Starting…' : s.subtitle;

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

window.mirrox.onMirrorState(({ state, message, details }) => {
  mirrorState = state === 'error' ? 'stopped' : state;
  if (state === 'running') showNote('Your phone screen is showing in its own window. Close that window or press Stop to end.');
  else if (state === 'stopped') showNote('');
  else if (state === 'error') showNote(message, true, details);
  render();
});

window.mirrox.getState().then(({ phone: s, version }) => {
  $('version').textContent = `v${version}`;
  if (s) phone = s;
  render();
});
