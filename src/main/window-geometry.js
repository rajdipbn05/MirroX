// Window size/position maths for the mirror window. Pure functions, unit-tested.

const TITLE_BAR = 32; // height of the mirror window's title bar in normal mode

// Largest size with the video's aspect ratio that fits in `area` (scaled by `fill`), centred.
function fitBounds(area, videoW, videoH, extraH, fill = 0.9) {
  const maxW = Math.floor(area.width * fill);
  const maxH = Math.floor(area.height * fill) - extraH;
  const scale = Math.min(maxW / videoW, maxH / videoH);
  const width = Math.max(200, Math.round(videoW * scale));
  const height = Math.max(150, Math.round(videoH * scale) + extraH);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

// Keep the aspect ratio while the user drags an edge or corner (Windows "will-resize").
function keepAspect(newBounds, edge, ratio, extraH) {
  let { x, y, width, height } = newBounds;
  const byHeight = edge === 'top' || edge === 'bottom';
  if (byHeight) {
    const w = Math.round((height - extraH) * ratio);
    if (edge === 'top' || edge === 'bottom') x += Math.round((width - w) / 2);
    width = w;
  } else {
    const h = Math.round(width / ratio) + extraH;
    if (edge === 'top-left' || edge === 'top-right') y += height - h;
    height = h;
  }
  return { x, y, width, height };
}

// Are these bounds (mostly) visible on the given display work area?
function isOnArea(b, area) {
  const ix = Math.max(0, Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x));
  const iy = Math.max(0, Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y));
  return ix * iy >= 0.5 * b.width * b.height;
}

module.exports = { TITLE_BAR, fitBounds, keepAspect, isOnArea };
