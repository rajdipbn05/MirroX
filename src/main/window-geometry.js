// Window size/position maths for the mirror window. Pure functions, unit-tested.

const TOOLBAR = 30; // height of the MirroX toolbar under the Windows title bar (normal mode)

// Largest size with the video's aspect ratio that fits in `area` (scaled by `fill`), centred.
// extraH = height not used by the picture (toolbar, and room for the Windows title bar).
function fitBounds(area, videoW, videoH, extraH, fill = 0.9) {
  const maxW = Math.floor(area.width * fill);
  const maxH = Math.floor(area.height * fill) - extraH;
  const scale = Math.min(maxW / videoW, maxH / videoH);
  const width = Math.max(200, Math.round(videoW * scale));
  const height = Math.max(150, Math.round(videoH * scale));
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

// Are these bounds (mostly) visible on the given display work area?
function isOnArea(b, area) {
  const ix = Math.max(0, Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x));
  const iy = Math.max(0, Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y));
  return ix * iy >= 0.5 * b.width * b.height;
}

function isOnScreen(b, areas) {
  return !!b && areas.some((a) => isOnArea(b, a));
}

module.exports = { TOOLBAR, fitBounds, isOnArea, isOnScreen };
