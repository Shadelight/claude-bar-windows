# Claude Bar for Windows

> Keep your **Claude Code** usage in your Windows tray — session limit, weekly limit, and cost, always one click away.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform: Windows 10/11](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6)
![Built with: Rust + Tauri](https://img.shields.io/badge/Built%20with-Rust%20%2B%20Tauri-orange)
![RAM: ~50 MB](https://img.shields.io/badge/RAM-~50%20MB-success)

<!-- Add a clean screenshot here: docs/panel.png -->

A Windows tray app that shows how much of your Claude plan you've used, inspired by [CodexBar](https://github.com/steipete/codexbar) (which is macOS‑focused) and maintained as a fork of [Daybi](https://github.com/Daybi)'s original Claude Bar. Built with **Rust + Tauri 2**, so it sips RAM (~50 MB) and the binary is ~3.6 MB.

> **This is a maintained fork of the original Claude Bar by Daybi. All credit for the original app goes to Daybi.** This fork keeps the MIT license and adds the [improvements below](#improvements-in-this-fork). Maintained by Alberth Salazar.

## Improvements in this fork

Changes made on top of Daybi's original:

- **Single-instance lock** (`tauri-plugin-single-instance`) — opening the app again now focuses the existing window instead of spawning another process. Fixes the bug where multiple copies fought over the tray slot and the tray icon ended up invisible.
- **Project cleanup** — removed a duplicate Electron prototype and consolidated everything into one clean Tauri project.

> More improvements coming. Suggestions and PRs welcome.

## Why

- **See your limits at a glance** — the tray icon shows your 5‑hour session % so you always know where you stand.
- **No dashboards** — session, weekly, Sonnet and cost, right in your tray.
- **Private by design** — everything is read **locally** on your PC. No servers, no telemetry, no account of the author involved.
- **Light** — native Windows WebView2 (no bundled Chromium), so it can stay open all day.

## What it shows

- **Session** — the 5‑hour limit: % used and when it resets.
- **Weekly** — the 7‑day limit: % used, reset time and "pace".
- **Sonnet** — the model‑specific weekly window.
- **Extra usage** — extra monthly spend (if enabled on your account).
- **Cost** — today / week / last 30 days, as an **API‑equivalent value** (what you'd pay pay‑as‑you‑go; your plan covers it).
- **Exact plan** — e.g. `Max 20x`, derived from your rate‑limit tier.
- Glassmorphism UI · movable · minimize / compact modes · Windows notifications · Spanish & English.

## Install

**Requirements:** Windows 10/11 and **Claude Code** installed and logged in (Claude Bar reads your local Claude Code session — see *How it works*).

1. Download the installer `Claude-Bar-v0.1.0-x64-setup.exe` from [Releases](../../releases).
2. Run it (installs to your user, no admin needed; SmartScreen may warn for an unsigned app → *More info → Run anyway*).
3. The panel appears on first run; afterwards it lives in the tray. It can start with Windows (toggle in the tray icon menu).

## Downloads

Build artifacts are attached to [GitHub Releases](../../releases), not committed to the repository.

| Type | File |
|------|------|
| Installer | `Claude-Bar-v0.1.0-x64-setup.exe` |
| Portable | `Claude-Bar-v0.1.0-portable.zip` |

## How it works

Everything is read locally on your machine:

| Data | Source |
|------|--------|
| Session / Weekly / Sonnet / Extra | `GET https://api.anthropic.com/api/oauth/usage` using your local Claude Code OAuth token |
| Token + plan tier | `%USERPROFILE%\.claude\.credentials.json` |
| Cost & tokens | parsing `%USERPROFILE%\.claude\projects\**\*.jsonl` (like `ccusage`) |

- The token is **read** from the file Claude Code already maintains; it is never bundled or sent anywhere except Anthropic's own usage endpoint.
- The usage endpoint is rate‑limited, so Claude Bar polls every **5 min** (with backoff). Cost is recomputed every **60 s**.
- Cost is an **estimate** (Claude Code doesn't store the real cost; it's computed from token counts using a local price table).

### Where Claude Bar stores its data

Claude Bar barely stores anything of its own:

- **First‑run flag** + WebView data (language preference): `%APPDATA%\com.daybi.claudebar\` and `%LOCALAPPDATA%\com.daybi.claudebar\`.
- **Start‑with‑Windows**: a `Claude Bar` entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
- **The app**: `%LOCALAPPDATA%\Claude Bar\`.
- It does **not** copy or store your Claude token — it reads it live from `~/.claude/.credentials.json` each time.

## Features

- Tray icon with the live session % drawn inside (green → amber → red).
- Click the tray icon to open/close; **drag the top bar** to move the window anywhere.
- **Minimize** to tray, or **compact mode** (tiny always‑on‑top widget in the corner showing only Session + Weekly).
- **Notifications** when your 5‑hour session resets, when you hit the session limit, and when your weekly limit resets.
- **Languages**: Spanish (default) and English, toggle at the bottom.
- **Glassmorphism**: translucent, blurred, light UI.

## Privacy

Claude Bar is read‑only and offline‑first. It only talks to `api.anthropic.com` (the same usage endpoint Claude Code uses) and reads files on your own disk. No analytics, no third‑party servers. The source is open — audit it.

> Note on accounts: Claude Bar uses **your own** local Claude Code session. It does **not** implement a third‑party login, on purpose — reusing Claude's OAuth client for third‑party logins is against Anthropic's Terms. To switch accounts, log out/in within Claude Code.

## Build from source

Requirements: [Rust](https://rustup.rs/) (MSVC toolchain recommended), [Node.js](https://nodejs.org/), and Windows with WebView2 (preinstalled on Win 11).

```powershell
npm install                       # frontend deps (once)
npm run tauri dev                 # development, hot reload
npm run tauri build               # release installer (NSIS) in src-tauri/target/release/bundle/nsis/
npm run tauri build --no-bundle   # just the standalone .exe
```

Release files should be uploaded to GitHub Releases:

- Installer: rename the NSIS output to `Claude-Bar-v0.1.0-x64-setup.exe`.
- Portable: zip the standalone exe with `LICENSE` and a short `README.txt` as `Claude-Bar-v0.1.0-portable.zip`.

Structure:

```
claude-bar-windows/
├─ docs/
│  ├─ panel.png
│  ├─ compact.png
│  └─ tray.png
├─ src/
├─ src-tauri/
├─ index.html
├─ README.md
├─ LICENSE
├─ .gitignore
├─ package.json
└─ package-lock.json

src-tauri/src/
   ├─ main.rs · lib.rs        # tray, window, polling, notifications
   ├─ credentials.rs          # reads the local token + plan
   ├─ claude_api.rs           # oauth/usage endpoint
   ├─ cost.rs · pricing.rs    # cost from the local jsonl logs
   └─ tray_icon.rs            # draws the % inside the tray icon
```

## Credits

- **Original app: [Claude Bar by Daybi](https://github.com/Daybi)** — this project is a fork of their work. All credit for the original design and implementation goes to them.
- Inspired by [CodexBar](https://github.com/steipete/codexbar) by Peter Steinberger (MIT, macOS).
- Cost calculation modeled after [ccusage](https://github.com/ryoppippi/ccusage).
- Related project (same idea, macOS / Swift): [ClaudeBar by tddworks](https://github.com/tddworks/ClaudeBar) — referenced as prior art only; no code is shared with it.

## License

MIT — © 2026 Daybi (original author) · © 2026 Alberth Salazar (fork & modifications).
See [LICENSE](LICENSE). You are free to use, modify and distribute under the MIT terms, keeping this notice.
