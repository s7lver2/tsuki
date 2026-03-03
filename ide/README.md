# GoDotIno IDE

A desktop IDE for the GoDotIno/tsuki toolchain. Write in Go, compile to C++, flash to Arduino.

**Stack:** Tauri (Rust) + Next.js (React) + TypeScript + Tailwind CSS

## Prerequisites

```bash
# 1. Node.js 18+
node --version

# 2. Rust + Cargo
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 3. Tauri prerequisites (Linux)
sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# macOS: Xcode command line tools
xcode-select --install
```

## Quick Start

```bash
# Install Node dependencies
npm install

# Run in browser (Next.js only, no Tauri)
npm run dev
# → http://localhost:3000

# Run as desktop app (requires Rust + Tauri CLI)
npm run tauri:dev

# Build distributable
npm run tauri:build
```

## Project Structure

```
godotino-ide/
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── layout.tsx    # Root layout, fonts, theme
│   │   ├── page.tsx      # Screen router
│   │   └── globals.css   # Design tokens (CSS vars)
│   ├── components/
│   │   ├── ide/
│   │   │   ├── WelcomeScreen.tsx   # Home / project picker
│   │   │   ├── IdeScreen.tsx       # Main IDE layout
│   │   │   ├── SettingsScreen.tsx  # CLI config & preferences
│   │   │   ├── FilesSidebar.tsx    # File tree explorer
│   │   │   ├── GitSidebar.tsx      # Git commit & history
│   │   │   ├── CodeEditor.tsx      # Syntax-highlighted editor
│   │   │   └── BottomPanel.tsx     # Output / terminal panel
│   │   └── ui/
│   │       └── primitives.tsx      # Btn, Input, Toggle, Badge…
│   └── lib/
│       ├── store.ts      # Zustand global state
│       ├── highlight.ts  # Go syntax tokenizer
│       └── tauri.ts      # Tauri invoke() wrappers
├── src-tauri/
│   ├── src/main.rs       # Rust backend — shell, fs, dialogs
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json   # Window config, permissions
├── next.config.js        # Static export for Tauri
├── tailwind.config.ts
└── package.json
```

## Design System

Pure black/white with greyscale accents. Inspired by Vercel/Next.js:

- **Dark mode:** `#0a0a0a` base, `#ededed` text
- **Light mode:** `#ffffff` base, `#111111` text
- **Fonts:** IBM Plex Sans (UI) + IBM Plex Mono (code)
- **Syntax:** greyscale only — keywords bold, strings muted, comments faint

Toggle dark/light with the `◐` button in the topbar.

## Adding Tauri Features

To call Rust from the frontend:
```typescript
import { runShell } from '@/lib/tauri'

const output = await runShell('tsuki', ['build', '--board', 'uno'])
```

Add new commands in `src-tauri/src/main.rs` and register them in `invoke_handler!`.

## Roadmap

- [ ] Real filesystem integration (open/save via Tauri FS API)
- [ ] Serial monitor panel (tokio serial port)  
- [ ] tsuki CLI live output streaming
- [ ] Multiple windows / split editor
- [ ] Language server protocol (gopls)
- [ ] Auto-update via Tauri updater
