# StreamTTS

**Desktop TTS for streamers.** Reads Twitch and YouTube chat messages aloud during live streams.

[Download](https://github.com/MananJK/StreamTTS/releases) · [Report Bug](https://github.com/MananJK/StreamTTS/issues) · [Privacy](PRIVACY.md)

## Features

- **Twitch + YouTube** — OAuth-based chat integration; Twitch via IRC (tmi.js), YouTube via Data API v3 polling
- **Dual TTS Engine** — Browser Web Speech API (free, unlimited) or ElevenLabs (premium)
- **`!г` Command Prefix** — read specific messages aloud; designed for Russian-language communities
- **Alert Integration** — backend ingests Twitch EventSub subs/gifts/redemptions and YouTube PubSubHubbub events
- **OBS Ready** — route audio through Browser Source
- **Privacy-First** — tokens and settings stored locally; no telemetry, no analytics
- **Cross-Platform** — Windows, macOS, Linux (Tauri v2)

## Quick Start

```bash
git clone https://github.com/MananJK/StreamTTS.git
cd StreamTTS
npm install
npm run tauri:dev
```

## Tech Stack

| Layer | |
|-------|---|
| Desktop | Tauri v2, Rust (Axum) |
| Frontend | React 18, TypeScript, Tailwind CSS, Vite |
| UI | shadcn/ui, Radix primitives, Lucide icons |
| State | Zustand (client) + TanStack React Query (server) |
| Chat | tmi.js (Twitch IRC), YouTube Data API v3 |
| TTS | Web Speech API, ElevenLabs REST API |
| Tests | Vitest |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   StreamTTS                         │
├─────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript + Tailwind)           │
│    ├── Pages: Login, Index, NotFound                │
│    ├── Components: Chat, Connections, Settings      │
│    ├── Services: twitch, youtube, tts, alerts, queue│
│    └── Stores: auth, chat, settings (Zustand)       │
├─────────────────────────────────────────────────────┤
│  Backend (Rust + Axum, localhost:3000)              │
│    ├── OAuth callback server                        │
│    ├── Google token exchange & refresh              │
│    ├── Twitch EventSub webhook (HMAC verification)  │
│    └── YouTube PubSubHubbub alerts                  │
├─────────────────────────────────────────────────────┤
│  External Services                                  │
│    ├── Twitch IRC via tmi.js                        │
│    ├── YouTube Data API v3 (polling)                │
│    └── TTS: Web Speech API / ElevenLabs             │
└─────────────────────────────────────────────────────┘
```

## Project Structure

```
src/                          # React frontend
├── pages/                    # Index, Login, NotFound
├── components/               # UI components + shadcn/ui primitives
├── services/                 # twitch, youtube, tts, ttsQueue, alerts
├── stores/                   # Zustand: auth, chat, settings
├── hooks/                    # React hooks (connections, queries, TTS queue, OAuth, updates)
├── config/                   # Client IDs, security utilities
├── types/                    # TypeScript definitions
├── lib/                      # Utilities
└── tests/                    # Vitest tests for stores, services, security

src-tauri/                    # Rust backend
├── src/
│   ├── main.rs               # Entry point
│   ├── lib.rs                # App init, Tauri plugin setup, event forwarding
│   ├── oauth.rs              # Axum server: OAuth callbacks, token exchange, webhooks
│   └── alerts.rs             # Alert payload processing
├── tauri.conf.json
└── Cargo.toml
```

## OAuth Setup (Development)

Set these in a `.env` at the project root (see `.env.example`):

Twitch and YouTube Client IDs are configured in `src/config/security.ts`.

**Twitch:** [Developer Console](https://dev.twitch.tv/console) → OAuth Redirect URL: `http://localhost:3000/callback`

**YouTube:** [Google Cloud Console](https://console.cloud.google.com) → OAuth 2.0 Client ID → redirect URI `http://localhost:3000/callback` + scopes `youtube.readonly`, `youtube`, `youtube.force-ssl`

The backend `.env` (`src-tauri/.env.example`) requires `YOUTUBE_CLIENT_SECRET` and `TWITCH_EVENTSUB_SECRET` for token exchange and webhook verification.

## Scripts

| Command | |
|---------|-|
| `npm run dev` | Vite dev server |
| `npm run tauri:dev` | Full desktop app in dev mode |
| `npm run tauri:build` | Production build |
| `npm run test` | Run Vitest |
| `npm run lint` | ESLint |
| `npm run clean` | Remove `dist/` |

Platform-specific builds: `tauri:build:win`, `tauri:build:mac`, `tauri:build:linux`.

## Requirements

- Node.js 18+, Rust 1.77+, platform build tools (VC++ on Windows, Xcode CLT on macOS, `libwebkit2gtk-4.1-dev` on Linux)

## License

MIT — see [LICENSE](LICENSE).
