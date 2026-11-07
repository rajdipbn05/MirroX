// Reference data: phone makers' USB IDs, and other programs that can grab the phone connection.

const OEM_DRIVERS = 'https://developer.android.com/studio/run/oem-usb';

// USB vendor ID -> phone brand. (Only well-known phone makers.)
const VENDORS = {
  '04E8': { brand: 'Samsung', key: 'samsung', driverUrl: 'https://developer.samsung.com/android-usb-driver' },
  '22B8': { brand: 'Motorola', key: 'motorola' },
  '18D1': { brand: 'Google', key: 'pixel', driverUrl: 'https://developer.android.com/studio/run/win-usb' },
  '2717': { brand: 'Xiaomi', key: 'xiaomi' },
  '2A70': { brand: 'OnePlus', key: 'oneplus' },
  '22D9': { brand: 'OPPO / Realme', key: 'oppo' },
  '2D95': { brand: 'vivo', key: 'vivo' },
  '12D1': { brand: 'Huawei', key: 'huawei' },
  '339B': { brand: 'Honor', key: 'huawei' },
  '0FCE': { brand: 'Sony', key: 'generic' },
  '1004': { brand: 'LG', key: 'generic' },
  '0BB4': { brand: 'HTC', key: 'generic' },
  '0B05': { brand: 'ASUS', key: 'generic' },
  '17EF': { brand: 'Lenovo', key: 'generic' },
  '19D2': { brand: 'ZTE', key: 'generic' },
  '2E04': { brand: 'Nokia', key: 'generic' },
  '2A45': { brand: 'Meizu', key: 'generic' },
  '1BBB': { brand: 'TCL / Alcatel', key: 'generic' },
  '2AE5': { brand: 'Fairphone', key: 'generic' },
  '1949': { brand: 'Amazon', key: 'generic' },
  '0E8D': { brand: 'Android', key: 'generic' }, // MediaTek-based phones
  '05C6': { brand: 'Android', key: 'generic' }, // Qualcomm-based phones
  '1782': { brand: 'Android', key: 'generic' }, // Unisoc-based phones
};
const APPLE_VID = '05AC';

// Programs known to start their own phone connection and hold the phone.
// `match` is tested against the program name and its file location.
const CONFLICTING_APPS = [
  { name: 'DouWan', match: /douwan|doucast/i },
  { name: 'ApowerMirror', match: /apowermirror/i },
  { name: 'LetsView', match: /letsview/i },
  { name: 'Vysor', match: /vysor/i },
  { name: 'AirDroid', match: /airdroid/i },
  { name: 'Wondershare MirrorGo', match: /mirrorgo/i },
  { name: 'Wondershare Dr.Fone', match: /dr\.?fone/i },
  { name: 'Mobizen', match: /mobizen/i },
  { name: 'Mirroid', match: /mirroid/i },
  { name: 'QtScrcpy', match: /qtscrcpy/i },
  { name: 'Escrcpy', match: /escrcpy/i },
  { name: 'Samsung Smart Switch', match: /smartswitch/i },
  { name: 'Huawei HiSuite', match: /hisuite/i },
  { name: 'Xiaomi Mi PC Suite', match: /mi ?pc ?suite|xiaomi.?pc.?suite/i },
  { name: 'BlueStacks', match: /bluestacks|^hd-(player|adb|agent)/i },
  { name: 'LDPlayer', match: /ldplayer|^dnplayer/i },
  { name: 'Nox Player', match: /noxplayer|^nox(vmhandle|_adb)?\.exe$|\\nox\\/i },
  { name: 'MuMu Player', match: /mumu/i },
  { name: 'MEmu', match: /memu/i },
  { name: 'Android Studio', match: /^studio64\.exe$|android studio/i },
  { name: 'Genymotion', match: /genymotion/i },
];

module.exports = { VENDORS, APPLE_VID, OEM_DRIVERS, CONFLICTING_APPS };
