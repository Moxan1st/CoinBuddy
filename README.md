# CoinBuddy

**AI-powered DeFi pet companion Chrome extension**

![Plasmo](https://img.shields.io/badge/Plasmo-MV3-blue)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6)
![Vercel](https://img.shields.io/badge/Vercel-Edge-000)

## What is CoinBuddy?

CoinBuddy is a Chrome extension that puts a pixel cat pet in your browser to help you navigate DeFi. You type (or speak) what you want in plain language, and the pet translates your intent into real DeFi operations -- vault discovery, deposits, token swaps, cross-chain bridges, and automated strategies. No seed phrases required; it connects to your existing wallet via Coinbase Wallet SDK.

## Features

- **Vault discovery & comparison** -- search and rank yield vaults across chains by APY, TVL, or protocol
- **Stablecoin pool search** -- find the best stablecoin yields
- **Protocol-specific search** -- filter by Morpho, Aave, and other supported protocols
- **Deposit into vaults** -- same-chain deposits with automatic token approval
- **Cross-chain deposits** -- bridge + deposit in a single flow via LI.FI
- **Token swaps** -- swap tokens on the same chain
- **Cross-chain bridges** -- move assets between chains
- **Withdrawals** -- withdraw from vaults, optionally bridging proceeds to another chain
- **Portfolio tracking** -- view your positions across protocols and chains
- **Price-triggered strategies** -- set conditions like "buy ETH when it drops below $2000"
- **Composite actions** -- chain multiple steps (swap + deposit, bridge + deposit, etc.)
- **Voice input** -- speak your intent instead of typing
- **Page content sniffing** -- detects DeFi keywords on the current page and suggests actions
- **Multi-language** -- English and Chinese (i18n)

## Architecture

```
+---------------------------+       +----------------------------+
|  Chrome Extension (MV3)   |       |  Vercel Edge API Proxy     |
|  - Content script overlay |  -->  |  - Protects API keys       |
|  - Popup UI               |       |  - /api/gemini, /api/qwen  |
|  - Background SW          |       |  - /api/lifi               |
+---------------------------+       +----------------------------+
        |                                      |
        v                                      v
  Intent Router                         LLM providers
  (strategy, invest,                    (Gemini, Qwen)
   portfolio, composite,               LI.FI API
   swap, bridge, withdraw)
```

- **Chrome Extension (Plasmo MV3)** -- content script overlay that renders the pet and chat UI, plus a popup for wallet connection and settings.
- **Background service worker** -- intent routing, LLM client, LI.FI integration, dialogue state management, and strategy scheduling.
- **Vercel Edge API proxy** -- a Next.js edge API layer that keeps LLM and LI.FI keys server-side, deployed alongside the landing page.
- **Landing page** -- a Next.js app on the same Vercel deployment with hero, demo, highlights, and install instructions.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/your-org/coinbuddy.git
cd coinbuddy

# 2. Configure environment
cp .env.example .env
# Edit .env and set:
#   PLASMO_PUBLIC_API_BASE=https://your-app.vercel.app
#   PLASMO_PUBLIC_PROXY_TOKEN=your_proxy_token

# 3. Install dependencies
pnpm install

# 4. Build
pnpm build

# 5. Load in Chrome
#    - Open chrome://extensions
#    - Enable "Developer mode"
#    - Click "Load unpacked"
#    - Select the build/chrome-mv3-prod directory
```

## Vercel Proxy Setup

The extension calls LLM and DeFi APIs through a Vercel Edge proxy so that API keys are never shipped in the extension bundle.

1. Deploy the `landing/` directory to Vercel.
2. In Vercel project settings, set **Root Directory** to `landing`.
3. Add the following environment variables in the Vercel dashboard:

   | Variable | Description |
   |---|---|
   | `GEMINI_KEY` | Google Gemini API key |
   | `QWEN_KEY` | Alibaba Qwen API key |
   | `LIFI_KEY` | LI.FI API key |
   | `CB_PROXY_TOKEN` | Shared token to authenticate extension requests |

4. In the extension `.env`, set `PLASMO_PUBLIC_API_BASE` to your Vercel deployment URL and `PLASMO_PUBLIC_PROXY_TOKEN` to match `CB_PROXY_TOKEN`.

## Tech Stack

| Layer | Technology |
|---|---|
| Extension framework | [Plasmo](https://www.plasmo.com/) (Chrome MV3) |
| UI | React 18 + TypeScript |
| DeFi routing & yield | [LI.FI SDK](https://li.fi/) |
| LLM intent recognition | Google Gemini / Alibaba Qwen |
| Wallet connection | Wagmi + Viem + Coinbase Wallet SDK |
| Landing page & API proxy | Next.js on Vercel Edge Runtime |
| Animations | Lottie React + Canvas Confetti |

## License

MIT
