// Computer keyboard (KeyboardEvent.code) -> Android key codes.

const KEYCODES = {
  Enter: 66, NumpadEnter: 66, Backspace: 67, Delete: 112, Tab: 61, Space: 62, Escape: 111,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
  Home: 122, End: 123, PageUp: 92, PageDown: 93, Insert: 124,
  ShiftLeft: 59, ShiftRight: 60, ControlLeft: 113, ControlRight: 114, AltLeft: 57, AltRight: 58,
  MetaLeft: 117, MetaRight: 118, CapsLock: 115,
  Comma: 55, Period: 56, Minus: 69, Equal: 70, BracketLeft: 71, BracketRight: 72,
  Backslash: 73, Semicolon: 74, Quote: 75, Slash: 76, Backquote: 68,
  NumpadAdd: 157, NumpadSubtract: 156, NumpadMultiply: 155, NumpadDivide: 154, NumpadDecimal: 158,
  AudioVolumeUp: 24, AudioVolumeDown: 25, AudioVolumeMute: 164,
  MediaPlayPause: 85, MediaTrackNext: 87, MediaTrackPrevious: 88,
};
for (let i = 0; i < 26; i++) KEYCODES['Key' + String.fromCharCode(65 + i)] = 29 + i; // A=29 … Z=54
for (let i = 0; i <= 9; i++) {
  KEYCODES['Digit' + i] = 7 + i; // 0=7 … 9=16
  KEYCODES['Numpad' + i] = 144 + i; // NUMPAD_0=144 …
}
for (let i = 1; i <= 12; i++) KEYCODES['F' + i] = 130 + i; // F1=131 … F12=142

const ANDROID_HOME = 3;
const ANDROID_APP_SWITCH = 187;

// Android META_* flags for held modifier keys.
function metaState(e) {
  let m = 0;
  if (e.shiftKey) m |= 0x1 | 0x40; // SHIFT_ON | SHIFT_LEFT_ON
  if (e.altKey) m |= 0x2 | 0x10; // ALT_ON | ALT_LEFT_ON
  if (e.ctrlKey) m |= 0x1000 | 0x2000; // CTRL_ON | CTRL_LEFT_ON
  if (e.metaKey) m |= 0x10000 | 0x20000; // META_ON | META_LEFT_ON
  return m;
}

module.exports = { KEYCODES, ANDROID_HOME, ANDROID_APP_SWITCH, metaState };
