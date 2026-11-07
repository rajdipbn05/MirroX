// Turns the phone to landscape or portrait while mirroring, and gives back a function that undoes it.

const { adb } = require('./adb');

const ROTATION = { landscape: '1', portrait: '0' };

async function applyOrientation(serial, orientation) {
  if (!ROTATION[orientation]) return null;
  const get = async (key) => (await adb(['-s', serial, 'shell', 'settings', 'get', 'system', key])).trim();
  const put = (key, val) => adb(['-s', serial, 'shell', 'settings', 'put', 'system', key, val]);
  const before = { accelerometer_rotation: await get('accelerometer_rotation'), user_rotation: await get('user_rotation') };
  await put('accelerometer_rotation', '0');
  await put('user_rotation', ROTATION[orientation]);
  return async () => {
    for (const [k, v] of Object.entries(before)) if (/^\d+$/.test(v)) await put(k, v);
  };
}

module.exports = { applyOrientation };
