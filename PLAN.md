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
| 3 | Presets | **Gaming:** phone's full resolution, 32 Mbps, up to 120 FPS, phone turned to landscape, low-delay encoder. **Normal:** full resolution, 20 Mbps, 60 FPS. (Raised in v0.6.2 — the picture was too soft at 1920 px / 16 Mbps.) Live FPS shown while mirroring. | 🧪 waiting for your quality / FPS / delay check |
| 3b | Mirror window | scrcpy's own mirror window (as in v0.3.0), never fullscreen/borderless by default. **Fullscreen: Alt+F toggles it; Esc leaves it** (that Esc is not sent to the phone; outside fullscreen Esc goes to the phone as usual). No bar, no extra buttons on the mirror window. Window row on the main screen: Fullscreen works live; Borderless / Always on top apply on the next start. The experimental MirroX-drawn window stays an opt-in in Advanced (off). | 🧪 v0.4.3 |
| 4 | Advanced panel | Sliders for resolution, quality (bitrate, up to 80 Mbps), max FPS; rotation; switches for fullscreen, borderless, always-on-top, phone sound, low-delay mode, phone screen off. Built together with Stage 3 | 🧪 |
| 5 | First-time setup walk-through | Opens on first launch; guides step by step through USB Debugging with progress, building on the Stage 2 guide | ⏳ |
| 6 | Window controls | Done in Stage 3b, and they now work *while* mirroring without a restart | 🧪 (with 3b) |
| 7 | Phone audio switch | "Phone sound" switch added in Advanced settings (Stage 3) | 🧪 |
| 7b | **Teammates' voice chat on the laptop (for streaming)** | Phone sound now includes **teammates' in-game voice chat** (Android 13+; "playback" capture). Sound plays on the laptop (wear earphones there); "📱 Also play on phone" keeps it on the phone too. If a phone refuses, MirroX switches to game sound only and says so. **Your own voice:** talk to teammates through the phone as usual; for the stream add the laptop mic / earphone mic in OBS. *(v0.5.0 "My voice (phone mic)" removed — with the in-game mic on, the phone dropped the teammates' voices.)* | 🧪 v0.6.0 |
| 8 | Keyboard & mouse control switch | **"Control: Keyboard & mouse On/Off"** on the main screen. Instant in the MirroX window; scrcpy's window picks it up on the next start | 🧪 v0.4.4 |
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
- **2026-11-07** — v0.4.1 on a real phone: picture connected but the connection dropped ("connection lost"). Per your request: back to the v0.3.0 window (scrcpy) as the default, plus a bar on top with Fullscreen.
- **2026-11-07** — v0.4.2: scrcpy window is the default again; MirroX bar on top (Fullscreen, Stop, FPS; Exit-fullscreen button at the top edge in fullscreen). New MirroX window kept as an experimental option, off.
- **2026-11-07** — v0.4.2 feedback: bar not wanted; the top-edge Exit-fullscreen button didn't work and isn't wanted; Esc should exit fullscreen. Experimental window: phone log "Video capture reset" then the connection dropped.
- **2026-11-07** — v0.4.3: bar and exit button removed; Esc exits fullscreen (Windows keyboard helper, only while the mirror is fullscreen). Experimental window no longer asks the phone to restart its video (that is what made the Motorola drop the connection) — it replays the latest video to a new window instead.
- **2026-11-07** — v0.4.3 confirmed: Esc exits fullscreen; the experimental MirroX window now works on the Motorola. Found a thin yellow line around the picture in it; asked for a keyboard & mouse on/off switch.
- **2026-11-07** — v0.4.4: MirroX window draws the picture at its exact size with the standard drawing path (fixes the edge line); Keyboard & mouse On/Off switch.
- **2026-11-19** — New goal: stream the player's own voice without an extra mic (in-game voice chat goes through the phone mic, which mirroring didn't capture).
- **2026-11-19** — v0.5.0 (test build): "My voice (phone mic)" — a second, sound-only phone connection that captures the phone mic and plays it on the laptop. Needs a real-phone test: does the game AND MirroX both get the mic at the same time?
- **2026-11-19** — v0.5.0 result: with the in-game mic on, the teammates' voices were not captured, and the sound only came out of the laptop speaker. Cause: MirroX used the "output" capture, which Android routes around voice chat. New plan from you: capture game + teammates; your own voice via laptop/earphone mic in OBS.
- **2026-11-19** — v0.6.0: "playback" capture (includes voice chat, Android 13+), Sound row (Teammates' voice chat, Also play on phone), automatic fallback; phone-mic feature removed. Also fixed: the Keyboard & mouse Off switch was not reaching the standard window.
- **2026-11-19** — v0.6.1: MirroX window — Borderless / Fullscreen / On top and the FPS now sit **in the title bar** (Windows' own min/max/close, dragging and snapping kept); the separate strip under it is gone. OBS tip: use Borderless for streaming and set the OBS source's Bounding Box to "Scale to inner bounds" so resizing/fullscreen doesn't break the layout.
- **2026-11-19** — Picture quality reported as too low. v0.6.2: presets use the phone's full resolution; Gaming 32 Mbps, Normal 20 Mbps; Quality slider up to 80 Mbps.
- **2026-11-19** — Quality still not right after v0.6.2. v0.6.3 adds a live quality readout in the MirroX window (title bar: FPS · picture size · Mbps actually arriving; main screen: requested vs received Mbps, the phone's video encoder, and a warning if the phone shrank the picture to fit its encoder) to find the real cause.
- **2026-11-19** — Measured on the Moto g57 power (v0.6.3): the phone's encoder (c2.qti.avc.encoder) sent only **1.5–1.9 Mbps of the 32 asked for**, and its maximum size is 1920 px (picture 1920×864). Cause of the blocky picture: the encoder's default 'variable' mode. v0.6.4 forces **constant bitrate** (bitrate-mode=2) in both windows, with an automatic retry without it if a phone refuses.
- **2026-11-19** — v0.6.4 result: the phone now sends 16–28 Mbps (was ~2) — much cleaner, but you wanted sharper still. v0.7.0: **Sharper picture (H.265)** option in Advanced (both windows); falls back to H.264 automatically if the phone has no H.265 encoder or the computer can't decode it in the MirroX window. Readout shows the format in use. Also noticed: BGMI was on the 'Smooth' graphics setting, which itself draws a lower-detail picture.
- **2026-11-19** — v0.7.1: clicking **Custom** opens Advanced settings; **desktop shortcut** created on first launch (follows the MirroX file if moved; not recreated if deleted); MirroX's own **icon** for the shortcut, windows and taskbar. Lag investigation waiting for the in-game Live: numbers (H.265 on vs H.264 at 50 Mbps).
