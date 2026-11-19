// Mirroring presets and how settings turn into scrcpy options.
// Pure functions (no side effects) so they can be unit-tested.

const { videoCodecOptions } = require('../../shared/scrcpy-protocol');

// Choices offered by the Advanced sliders.
const RESOLUTIONS = [720, 1080, 1280, 1600, 1920, 0]; // 0 = phone's full resolution
const FPS_CHOICES = [30, 60, 90, 120, 144];
const BITRATE_MIN = 2;
const BITRATE_MAX = 80; // Mbps (USB easily carries this)

const PRESETS = {
  gaming: {
    label: 'Gaming',
    description: "Full phone resolution, high quality, up to 120 FPS. Turns the phone to landscape.",
    settings: {
      maxSize: 0, // phone's full resolution (sharpest picture)
      bitrate: 32,
      maxFps: 120,
      orientation: 'landscape',
      audio: true,
      screenOff: false,
      lowLatency: true,
    },
  },
  normal: {
    label: 'Normal',
    description: "Full phone resolution, good quality, 60 FPS. Follows your phone's rotation.",
    settings: {
      maxSize: 0,
      bitrate: 20,
      maxFps: 60,
      orientation: 'auto',
      audio: true,
      screenOff: false,
      lowLatency: false,
    },
  },
};

const DEFAULT_SETTINGS = { preset: 'gaming', custom: { ...PRESETS.gaming.settings } };

// Returns the settings actually used: the preset's values, or the custom ones.
function effectiveSettings(saved) {
  const s = saved || DEFAULT_SETTINGS;
  const base = PRESETS[s.preset] ? PRESETS[s.preset].settings : { ...PRESETS.gaming.settings, ...(s.custom || {}) };
  return sanitize(base);
}

// Keeps values inside the allowed ranges (protects against a damaged settings file).
function sanitize(v) {
  const pick = (val, list, dflt) => (list.includes(val) ? val : dflt);
  const num = (val, min, max, dflt) => (Number.isFinite(val) ? Math.min(max, Math.max(min, Math.round(val))) : dflt);
  return {
    maxSize: pick(v.maxSize, RESOLUTIONS, 1920),
    bitrate: num(v.bitrate, BITRATE_MIN, BITRATE_MAX, 8),
    maxFps: pick(v.maxFps, FPS_CHOICES, 60),
    orientation: pick(v.orientation, ['auto', 'landscape', 'portrait'], 'auto'),
    fullscreen: !!v.fullscreen,
    borderless: !!v.borderless,
    alwaysOnTop: !!v.alwaysOnTop,
    audio: v.audio !== false,
    screenOff: !!v.screenOff,
    lowLatency: !!v.lowLatency,
  };
}

// Window options (fullscreen / borderless / always-on-top) are NOT part of presets: they are
// mirror-window settings, off by default, and only used here by the classic engine.

// scrcpy command-line options for the given settings (classic engine).
function buildArgs({ serial, name }, settings, { codecOptions = true } = {}) {
  const s = sanitize(settings);
  const args = [
    `--serial=${serial}`,
    `--window-title=MirroX — ${name}`,
    '--stay-awake',
    '--disable-screensaver',
    '--print-fps',
    `--video-bit-rate=${s.bitrate}M`,
    `--max-fps=${s.maxFps}`,
  ];
  if (s.maxSize) args.push(`--max-size=${s.maxSize}`);
  if (s.fullscreen) args.push('--fullscreen');
  if (s.borderless) args.push('--window-borderless');
  if (s.alwaysOnTop) args.push('--always-on-top');
  if (!s.audio) args.push('--no-audio');
  else if (settings.audioSource === 'playback') {
    args.push('--audio-source=playback'); // game sound + teammates' voice chat (Android 13+)
    if (settings.audioDup) args.push('--audio-dup'); // keep playing on the phone too
  }
  if (s.screenOff) args.push('--turn-screen-off');
  if (settings.control === false) args.push('--no-control'); // keyboard & mouse control off
  args.push('--video-codec=h264'); // fastest to encode and decode on almost every phone
  // Constant bitrate (+ real-time priority in low-delay mode). Dropped automatically if the phone rejects it.
  const opts = videoCodecOptions(s);
  if (codecOptions && opts) args.push(`--video-codec-options=${opts}`);
  return args;
}

module.exports = { PRESETS, DEFAULT_SETTINGS, RESOLUTIONS, FPS_CHOICES, BITRATE_MIN, BITRATE_MAX, effectiveSettings, sanitize, buildArgs };
