// Mirroring presets and how settings turn into scrcpy options.
// Pure functions (no side effects) so they can be unit-tested.

// Choices offered by the Advanced sliders.
const RESOLUTIONS = [720, 1080, 1280, 1600, 1920, 0]; // 0 = phone's full resolution
const FPS_CHOICES = [30, 60, 90, 120, 144];
const BITRATE_MIN = 2;
const BITRATE_MAX = 40; // Mbps

const PRESETS = {
  gaming: {
    label: 'Gaming',
    description: 'Lowest delay and highest frame rate. Landscape, fullscreen.',
    settings: {
      maxSize: 1920,
      bitrate: 16,
      maxFps: 120,
      orientation: 'landscape',
      fullscreen: true,
      borderless: true,
      alwaysOnTop: false,
      audio: true,
      screenOff: false,
      lowLatency: true,
    },
  },
  normal: {
    label: 'Normal',
    description: 'Balanced quality and smoothness. Follows your phone\'s rotation.',
    settings: {
      maxSize: 1920,
      bitrate: 8,
      maxFps: 60,
      orientation: 'auto',
      fullscreen: false,
      borderless: false,
      alwaysOnTop: false,
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

// scrcpy command-line options for the given settings.
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
  if (s.screenOff) args.push('--turn-screen-off');
  if (s.lowLatency) {
    args.push('--video-codec=h264'); // fastest to encode and decode on almost every phone
    // Ask the phone's encoder for real-time priority. Dropped automatically if the phone rejects it.
    if (codecOptions) args.push('--video-codec-options=priority:int=0');
  }
  return args;
}

module.exports = { PRESETS, DEFAULT_SETTINGS, RESOLUTIONS, FPS_CHOICES, BITRATE_MIN, BITRATE_MAX, effectiveSettings, sanitize, buildArgs };
