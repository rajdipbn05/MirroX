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
| 1 | Basic mirror | Plug in phone → app shows its name → click a button → phone screen appears in a window | ✅ Tested on Motorola g57 power: all 7 steps worked, sound works |
| 2 | Proper interface + clear statuses | New main screen. Statuses: Connected / USB Debugging off / Waiting for permission on phone / Driver missing / Another app is blocking. Names the blocking app (DouWan, ApowerMirror, Vysor, BlueStacks…) with a "Close it for me" button. "Show details" on every problem. Brand-specific "How to turn on USB Debugging" guide | ✅ Tested on both phones (v0.2.0) |
| 3 | Presets — smoothness first | "Gaming" (120 FPS max, 16 Mbps, 1920 px, phone turned to landscape, low-delay encoder) and "Normal" (60 FPS, 8 Mbps). Live FPS shown while mirroring. *Window options are no longer part of presets (see 3b).* | 🧪 waiting for your FPS/delay numbers |
| 3b | Mirror window | MirroX shows the phone screen in **its own window** (scrcpy still captures/encodes on the phone). **Normal mode = a standard Windows window** (real title bar: move, resize, snap, maximize like any app) with a slim MirroX toolbar: Borderless, Fullscreen, On top. Borderless: no frame; top edge shows a drag handle + buttons; resize from edges. Fullscreen: top-edge toolbar (Exit, Borderless, On top, Minimize, Close), Esc, Alt+F, double-click the toolbar, one-time hint. Alt+F toggles normal ↔ last used. Opens where you last left it; position, size, mode, always-on-top remembered. "Window" quick toggles on the main screen. Classic scrcpy window kept as a fallback. *(Monitor choice removed on request.)* | 🧪 v0.4.1 |
| 4 | Advanced panel | Sliders for resolution, quality (bitrate), max FPS; rotation; switches for fullscreen, borderless, always-on-top, phone sound, low-delay mode, phone screen off. Built together with Stage 3 | 🧪 |
| 5 | First-time setup walk-through | Opens on first launch; guides step by step through USB Debugging with progress, building on the Stage 2 guide | ⏳ |
| 6 | Window controls | Done in Stage 3b, and they now work *while* mirroring without a restart | 🧪 (with 3b) |
| 7 | Phone audio switch | "Phone sound" switch added in Advanced settings (Stage 3) | 🧪 |
| 8 | Keyboard & mouse control switch | Control already works; add an on/off switch | ⏳ |
| 9 | Game key mapping | Place keys (W, A, S, D, Space…) on spots of the phone screen to play games with the keyboard; save layouts per game | ⏳ |
| 10 | Record & screenshot | Record the mirror with sound to an MP4 video; one-click screenshot | ⏳ |
| 11 | Remember settings | Preset, Advanced settings, mirror window position/size/mode, always-on-top | 🧪 (with 3b) |
| 12 | Package as one file | Signed portable `.exe` + installer; tested on a clean PC | ⏳ |

**Always-on rules (every stage):**
- Every problem message has **Show details** / **Copy details** with the real technical error.
- If the phone connection is blocked, MirroX names the other app holding it instead of just timing out.
- Every build is tested automatically on a real Windows machine before it's published (no phone; blocked port 5037; fake DouWan running).

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
- **2026-11-07** — v0.1.0 on your laptop: "phone connection helper could not start". The same app worked on GitHub's clean Windows test machine, so the cause is something on your laptop (most likely antivirus, or another program using the phone connection).
- **2026-11-07** — v0.1.1: "Show details" / "Copy details" on errors, clearer messages for each likely cause, more time for the helper to start. Every build is now tested on a real Windows machine before it's published.
- **2026-11-07** — v0.1.1 details showed the helper started but never answered. Cause: another program on the laptop is holding ADB's standard channel (port 5037). v0.1.2: MirroX now uses its own private channel (port 15037), so other phone/emulator tools can't interfere. The details box now also lists which programs hold those ports. GitHub's Windows test now simulates a blocked port 5037.
- **2026-11-07** — Stage 1 confirmed working on Motorola g57 power. Cause of the earlier error: DouWan running in the background, holding the phone.
- **2026-11-07** — Stage 2 built (v0.2.0): new main screen, detection of "USB Debugging off" / missing driver / blocking apps (with "Close it for me"), brand-specific USB Debugging guide. Phone Link is deliberately *not* flagged: it connects over Wi-Fi and can't hold the cable connection.
- **2026-11-07** — v0.2.0 passed all three Windows tests (no phone, blocked port 5037, fake DouWan) and is published. Waiting for your Stage 2 test.
- **2026-11-07** — Stage 2 confirmed on both phones.
- **2026-11-07** — Stage 3 built (v0.3.0): Gaming / Normal / Custom presets, Advanced settings, live FPS counter, settings remembered. Waiting for your smoothness numbers.
- **2026-11-07** — v0.3.0 window problems reported (Gaming opened fullscreen/borderless; hard to leave; no monitor choice).
- **2026-11-07** — v0.4.0 (Stage 3b): new MirroX mirror window replacing scrcpy's window, with all 7 requested window fixes. Tested here and on GitHub's Windows machine with a pretend phone: video at ~60 FPS, clicks/keys reach the phone, Borderless/Fullscreen buttons, Alt+F, Esc, rotation reshapes the window. Not yet tested with a real phone — please test, then send FPS/delay numbers.
- **2026-11-07** — v0.4.0 published after passing all Windows tests (incl. rotation fix: decoder restarts when the phone changes picture size).
- **2026-11-07** — v0.4.0 on a real phone: stuck at "Connecting to your phone…" (MirroX waited for the phone's name before opening all connections — the phone only sends it after; my fake phone hid this). Window movement felt wrong (custom title bar + resize code). Monitor option not wanted.
- **2026-11-07** — v0.4.1: connection order fixed (and a 20-second limit with "Show details" instead of hanging); fake phone now behaves exactly like a real one; normal window uses the real Windows title bar; monitor option removed. Connection now lives in the main app, so switching normal ↔ borderless keeps mirroring.
