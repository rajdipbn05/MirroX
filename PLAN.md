# Phone Mirror App — Project Plan

This page shows what is done and what comes next. It is updated after every stage.

**⬇️ Download the latest app:** https://github.com/rajdipbn05/MirroX/releases/latest (click the `.exe` file under *Assets*)

**Status key:** ✅ Done · 🔨 In progress · ⏳ Not started · 🧪 Waiting for your test

---

## How we build it (decided)

- **App type:** A desktop app built with **Electron** (the same technology behind apps like Discord and VS Code). I build it here in the cloud, and you download a ready-to-run Windows file. You do not install any programming tools.
- **Mirroring engine (Android):** **scrcpy** and **ADB**, both bundled inside the app. Nothing is installed on the phone from an app store; the app sends a small helper to the phone over the cable automatically.
- **Mirroring engine (iPhone, Phase 2):** Apple's USB screen-capture protocol (the one QuickTime uses), through open-source libraries. Needs only Apple's USB driver on the laptop.
- **Final delivery:** One portable `.exe` (and later a normal installer). No account, no sign-up.
- **Mac later:** Electron runs on Mac too, so a Mac version reuses almost everything.

---

## Phase 1 — Android over USB

| # | Stage | What you'll be able to do | Status |
|---|-------|---------------------------|--------|
| 0 | Confirm your setup | Windows 11 24H2 · Samsung Galaxy S23 (Android 14) · Motorola g57 power (Android 17) · iPhones for Phase 2 | ✅ |
| 1 | Basic mirror | Plug in phone → app shows its name → click a button → phone screen appears in a window | 🧪 |
| 2 | Proper interface | Clean main window: phone name, status (connected / USB Debugging off / waiting for permission on phone), big "Start Mirroring" button | ⏳ |
| 3 | First-time setup guide | Step-by-step guide in the app for turning on USB Debugging, with tips for Samsung, Xiaomi, OnePlus, Pixel, Oppo, Vivo, Realme, Motorola, Huawei | ⏳ |
| 4 | Plain-language errors | Friendly messages with "show me how" links instead of technical errors | ⏳ |
| 5 | Presets | "Gaming" (max FPS, high quality, lowest delay, landscape, screen stays awake) and "Normal" (balanced) | ⏳ |
| 6 | Advanced panel | Sliders for resolution, quality (bitrate), and max FPS | ⏳ |
| 7 | Window controls | Fullscreen, borderless, always-on-top, portrait/landscape rotation | ⏳ |
| 8 | Phone audio | Hear the phone through the laptop (Android 11 and newer), on/off switch | ⏳ |
| 9 | Keyboard & mouse control | Control the phone from the laptop, on/off switch | ⏳ |
| 10 | Game key mapping | Place keys (W, A, S, D, Space…) on spots of the phone screen to play games with the keyboard; save layouts per game | ⏳ |
| 11 | Record & screenshot | Record the mirror with sound to an MP4 video; one-click screenshot | ⏳ |
| 12 | Remember settings | The app remembers your choices next time you open it | ⏳ |
| 13 | Package as one file | Single portable `.exe` + installer with everything bundled; tested on a clean PC | ⏳ |

## Phase 2 — iPhone over USB (later)

| Stage | Status |
|-------|--------|
| Detect iPhone, guide user to tap "Trust This Computer" | ⏳ |
| Check for Apple's USB driver and explain how to install it if missing | ⏳ |
| Show iPhone screen with audio using Apple's screen-capture protocol | ⏳ |

## Phase 3 — Wi-Fi (later)

| Stage | Status |
|-------|--------|
| Android over Wi-Fi with an easy pairing flow | ⏳ |
| iPhone over Wi-Fi (AirPlay receiver) | ⏳ |

## Later / nice-to-have (not planned yet)

Multiple phones at once · light/dark theme · custom branding · Mac version

---

## Log

- **2026-11-07** — Plan created. Setup confirmed (Stage 0).
- **2026-11-07** — Stage 1 built: `MirroX-0.1.0-portable.exe` (bundles scrcpy 5.0.1 + ADB). Waiting for your test on the Galaxy S23 and Motorola.

## Test phones

Target: popular brands (Samsung, Motorola, Xiaomi, OnePlus, Pixel, Oppo, Vivo, Realme…) on Android 14–17.
Phone audio needs Android 11+, so every target phone supports it.
