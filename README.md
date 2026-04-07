<p align="center">
  <a href="https://github.com/sickboydroid/SnapSense/releases">
    <img src="assets/icon.png" alt="SnapSense" width="160" height="160" />
  </a>
</p>

<h1 align="center">SnapSense</h1>

<p align="center">
  Cross-platform tray screenshot tool with AI chat, text extraction, and Google Lens — built with Electron.
</p>

<p align="center">
  <a href="https://snapsense-tawny.vercel.app/">Website</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/sickboydroid/SnapSense/releases">Download Releases</a>
</p>

---

## Features

- **Capture** — Global shortcut freezes the desktop and lets you drag a region to analyze.
- **AI** — Send the capture to **Groq** for chat-style answers and follow-up questions.
- **Text** — OCR-style extraction from the screenshot.
- **Lens** — Open or route captures toward Google Lens workflows.
- **In-app Groq key setup** — Paste and save your Groq API key directly inside SnapSense; no baked `.env` key required for packaged apps.
- **Stealth mode** — Uses Electron content protection on Windows and macOS to keep SnapSense windows out of many screen recordings and screen shares. Linux builds keep the toggle, but Electron does not provide the same capture protection there.

## Requirements

- **Windows**, **macOS**, or **Linux**, plus **Node.js** 18+ for development and builds.
- A **Groq API key** ([Groq Console](https://console.groq.com/)) for live AI (not needed for **Test** mode).

## Quick start (development)

```bash
npm install
```

```bash
npm run dev
```

The app runs in the system tray. Use the shortcut shown in the tray tooltip to start a capture. For AI mode, open the panel and use the `Key` button to save a Groq key locally. A `GROQ_KEY` environment variable is still supported for development, but it is optional.

## Building releases

Build the current platform:

```bash
npm run dist
```

Build a specific target:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

`npm run pack` produces an unpacked folder under `dist/` for testing without an installer.

Default packaged outputs:

- Windows: NSIS installer
- macOS: DMG + ZIP
- Linux: AppImage

## GitHub releases

Pushing a new Git tag triggers `.github/workflows/release.yml`, which builds Windows, macOS, and Linux artifacts on GitHub Actions and attaches them to the GitHub Release for that tag.

## Project layout

| Path | Role |
|------|------|
| `src/main.js` | Electron main: tray, shortcuts, capture & panel windows |
| `src/aiClient.js` | AI settings, local key storage, Groq requests |
| `src/panel/` | Results UI (AI / text / Lens) |
| `src/capture/` | Full-screen selection overlay |
| `assets/` | `icon.png` / `icon.svg` for UI and docs |

## License

Copyright © SnapSense. All rights reserved. *(Update this section when you choose a license.)*
