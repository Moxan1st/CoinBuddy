// CoinBuddy Brain v2 - 完整智能中枢
// 职责：Gemini 意图路由、LI.FI 金库搜索与缓存、Composer 交易构建、自然语言回复生成

import {
  describeBatch,
  txToComposableExecution,
  buildSwapThenDepositComposable,
  encodeExecuteComposable,
} from "~lib/composable"
import { encodeFunctionData } from "viem"

// ERC-20 approve ABI fragment
const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const
const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

// ─── 常量 & 配置 ───────────────────────────────────────────────
const EARN_API = "https://earn.li.fi"
const COMPOSER_API = "https://li.quest"
// Plasmo 只注入 PLASMO_PUBLIC_ 前缀的变量
const LIFI_API_KEY = process.env.PLASMO_PUBLIC_LIFI_KEY || ""
const GEMINI_API_KEY = process.env.PLASMO_PUBLIC_GEMINI_KEY || ""
const QWEN_API_KEY = process.env.PLASMO_PUBLIC_QWEN_KEY || ""
const GEMINI_MODEL = "gemini-2.5-flash"
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
const QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"

// 链 ID 映射（方便 Gemini 输出人类可读名称时做转换）
const CHAIN_MAP: Record<string, number> = {
  ethereum: 1, eth: 1, mainnet: 1,
  base: 8453,
  arbitrum: 42161, arb: 42161,
  optimism: 10, op: 10,
  polygon: 137, matic: 137,
  avalanche: 43114, avax: 43114,
  bsc: 56, bnb: 56,
  // Testnets
  sepolia: 11155111,
  "base-sepolia": 84532, "base sepolia": 84532,
  "arbitrum-sepolia": 421614, "arbitrum sepolia": 421614,
}
const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum", 8453: "Base", 42161: "Arbitrum",
  10: "Optimism", 137: "Polygon", 43114: "Avalanche", 56: "BSC",
  // Testnets
  11155111: "Sepolia", 84532: "Base Sepolia", 421614: "Arbitrum Sepolia",
}

// ─── 语言检测 ──────────────────────────────────────────────────
export function detectLang(text: string): "zh" | "en" {
  const zhChars = text.match(/[\u4e00-\u9fff]/g)
  return zhChars && zhChars.length / text.length > 0.15 ? "zh" : "en"
}

// ─── 类型定义 ──────────────────────────────────────────────────
export interface ChatMessage {
  role: "user" | "model"
  text: string
}

interface Intent {
  amount: string
  amountDecimals: string
  fromChain: number
  toChainConfig: number[]
  searchAsset: string
}

interface IntentResult {
  type: "chat" | "invest" | "confirm" | "cancel" | "compare" | "vault_detail" | "portfolio" | "chains" | "protocols" | "stablecoin" | "cross_deposit" | "token_price" | "swap" | "composite"
  chatReply?: string
  investParams?: Intent
  compareParams?: { chainId?: number; asset?: string; sortBy?: string; limit?: number }
  vaultParams?: { chainId: number; address: string }
  tokenParams?: { symbol: string; chainId?: number }
  swapParams?: { fromToken: string; toToken: string; amount: string; amountDecimals: string; chainId: number }
  compositeSteps?: Array<{
    action: "swap" | "deposit" | "bridge"
    params: Record<string, any>
  }>
}

interface Vault {
  address: string
  chainId: number
  name: string
  network?: string
  protocol: { name: string; url?: string }
  analytics: {
    apy: { base: number; reward: number; total: number }
    apy1d?: number | null
    apy7d?: number | null
    apy30d?: number | null
    tvl?: { usd: string } | number
    updatedAt?: string
  }
  underlyingTokens: { address: string; symbol: string; decimals?: number }[]
  tags?: string[]
  isTransactional?: boolean
  isRedeemable?: boolean
}

interface VaultCacheEntry {
  data: Vault[]
  timestamp: number
}

// ─── 常见代币跨链地址映射（fromToken 需要是 fromChain 上的地址）───
const TOKEN_ADDRESSES: Record<string, Record<number, string>> = {
  USDC: {
    1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    56: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  USDT: {
    1: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    8453: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    10: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    56: "0x55d398326f99059fF775485246999027B3197955",
    137: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  },
  ETH: {
    1: "0x0000000000000000000000000000000000000000",
    8453: "0x0000000000000000000000000000000000000000",
    42161: "0x0000000000000000000000000000000000000000",
    10: "0x0000000000000000000000000000000000000000",
  },
  WETH: {
    1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    8453: "0x4200000000000000000000000000000000000006",
    42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    10: "0x4200000000000000000000000000000000000006",
  },
  DAI: {
    1: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    42161: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    10: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  },
  WBTC: {
    1: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    42161: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    10: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
  },
  // Sepolia testnet tokens
  "USDC-SEPOLIA": {
    11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
}

function resolveFromToken(symbol: string, fromChain: number, fallbackAddress: string): string {
  const addr = TOKEN_ADDRESSES[symbol.toUpperCase()]?.[fromChain]
  if (addr) return addr
  // 同链时 fallback 地址是对的
  return fallbackAddress
}

// ─── Vault 缓存（5 分钟 TTL）─────────────────────────────────
const vaultCache = new Map<number, VaultCacheEntry>()
const CACHE_TTL = 5 * 60 * 1000

function getCachedVaults(chainId: number): Vault[] | null {
  const entry = vaultCache.get(chainId)
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data
  return null
}

// ─── Qwen 备选调用（OpenAI 兼容格式，支持文本 + 语音）──────────────

/** 将 Gemini contents 转为 Qwen OpenAI 格式 messages */
function geminiToQwenMessages(contents: any[]): any[] {
  return contents.map((c: any) => {
    const role = c.role === "model" ? "assistant" : "user"
    const parts = c.parts || []

    // 检查是否含音频
    const hasAudio = parts.some((p: any) => p.inlineData)
    if (!hasAudio) {
      // 纯文本
      return { role, content: parts.map((p: any) => p.text || "").join("\n") }
    }

    // 多模态：音频 + 文本 → Qwen content array 格式
    const content: any[] = []
    for (const p of parts) {
      if (p.inlineData) {
        // mimeType: "audio/webm" → format: "webm"
        const fmt = (p.inlineData.mimeType || "audio/webm").split("/")[1] || "webm"
        content.push({
          type: "input_audio",
          input_audio: { data: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, format: fmt }
        })
      } else if (p.text) {
        content.push({ type: "text", text: p.text })
      }
    }
    return { role, content }
  })
}

async function callQwen(
  contents: any[],
  jsonMode = false
): Promise<string> {
  const hasMedia = contents.some((c: any) => c.parts?.some((p: any) => p.inlineData))
  const model = hasMedia ? "qwen3.5-omni-plus" : "qwen-plus"
  const messages = geminiToQwenMessages(contents)

  // Qwen json_object 模式要求 messages 中包含 "json" 关键词
  if (jsonMode) {
    const hasJsonWord = messages.some((m: any) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
      return /json/i.test(content)
    })
    if (!hasJsonWord && messages.length > 0) {
      const first = messages[0]
      if (typeof first.content === "string") {
        first.content = first.content + "\n（请用严格JSON格式回答）"
      }
    }
  }

  const body: any = { model, messages }
  if (jsonMode) {
    body.response_format = { type: "json_object" }
  }

  console.log(`[Qwen] Call (${model}), messages: ${messages.length}, hasMedia: ${hasMedia}`)

  const res = await fetch(QWEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${QWEN_API_KEY}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  })

  const raw = await res.text()
  console.log(`[Qwen] Response status: ${res.status}, body: ${raw.slice(0, 300)}`)

  let data: any
  try { data = JSON.parse(raw) } catch { throw new Error(`[Qwen] Invalid JSON: ${raw.slice(0, 200)}`) }

  if (!res.ok || !data.choices?.[0]?.message?.content) {
    const errMsg = data.error?.message || data.message || raw.slice(0, 200)
    throw new Error(`[Qwen] ${res.status}: ${errMsg}`)
  }

  console.log("[Qwen] Success")
  return data.choices[0].message.content
}

// ─── 智能 LLM 路由：中国白天优先 Qwen，其余时段优先 Gemini ─────────
let geminiBackoffUntil = 0
let qwenBackoffUntil = 0

/** 中国时间 8:00-20:00 为白天 */
function isChinaDaytime(): boolean {
  const cnHour = new Date().getUTCHours() + 8
  const h = cnHour >= 24 ? cnHour - 24 : cnHour
  return h >= 8 && h < 20
}

/** 调 Gemini，失败返回 null */
async function tryGemini(contents: any[], jsonMode: boolean): Promise<string | null> {
  const body: any = { contents }
  if (jsonMode) body.generationConfig = { responseMimeType: "application/json" }

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })

  if (res.status === 429) {
    geminiBackoffUntil = Date.now() + 30_000
    console.warn("[Gemini] 429, cooldown 30s")
    return null
  }

  const data = await res.json()
  if (!res.ok || !data.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.error("[Gemini] Failed:", data.error?.message || JSON.stringify(data).slice(0, 200))
    return null
  }
  return data.candidates[0].content.parts[0].text
}

/** 调 Qwen，失败返回 null */
async function tryQwen(contents: any[], jsonMode: boolean): Promise<string | null> {
  try {
    return await callQwen(contents, jsonMode)
  } catch (e: any) {
    if (e.message?.includes("429") || e.message?.includes("rate")) {
      qwenBackoffUntil = Date.now() + 30_000
    }
    console.error("[Qwen] Failed:", e.message)
    return null
  }
}

async function callGeminiRaw(
  contents: any[],
  jsonMode = false,
  retries = 2
): Promise<string> {
  // Qwen 始终优先（qwen3.5-omni-plus 支持多语言 STT）
  const preferQwen = !!QWEN_API_KEY
  const geminiCooling = geminiBackoffUntil > Date.now()
  const qwenCooling = qwenBackoffUntil > Date.now()

  const primary = preferQwen ? "qwen" : "gemini"
  console.log(`[LLM] Route: primary=${primary}, geminiCooling=${geminiCooling}, qwenCooling=${qwenCooling}`)

  // 尝试顺序：优选 → 备选，带重试
  for (let attempt = 0; attempt <= retries; attempt++) {
    let result: string | null = null

    if (primary === "qwen" && !qwenCooling) {
      result = await tryQwen(contents, jsonMode)
      if (result) return result
      // Qwen 失败，试 Gemini
      if (!geminiCooling) {
        result = await tryGemini(contents, jsonMode)
        if (result) return result
      }
    } else {
      // 优先 Gemini
      if (!geminiCooling) {
        result = await tryGemini(contents, jsonMode)
        if (result) return result
      }
      // Gemini 失败，试 Qwen
      if (QWEN_API_KEY && !qwenCooling) {
        result = await tryQwen(contents, jsonMode)
        if (result) return result
      }
    }

    if (attempt < retries) {
      console.warn(`[LLM] Both failed, retry ${attempt + 1}/${retries}...`)
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
    }
  }
  throw new Error("[LLM] All providers exhausted")
}

/** Typed wrapper for text-only calls */
async function callGemini(
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  jsonMode = false,
  retries = 2
): Promise<string> {
  return callGeminiRaw(contents, jsonMode, retries)
}

// ─── 系统提示词 ───────────────────────────────────────────────
const ROUTER_SYSTEM_PROMPT = `You are CoinBuddy, a brilliant hacker-cat butler (a cyber pet living in the browser). You remember every conversation turn with your master.

## CRITICAL: Language Rule
**Always reply in the same language your master uses.** If they speak Chinese, reply in Chinese (use "喵" freely). If they speak English, reply in English (use "meow" or "nya~"). Never use "woof/汪".

## Voice Input Auto-Correction (Chinese STT errors)
Voice recognition often misidentifies crypto terms. Auto-correct before analyzing intent:
- USB/USB C/u s d c → USDC
- USB T/u s d t → USDT
- 以太/以太坊/ETF → ETH
- BS/贝斯/北斯/based → Base
- 阿比/啊比 → Arbitrum
- 欧批/OP → Optimism
- 两个/俩 → 2 (quantity)
- 点钱/存钱/村钱 → 存钱 (deposit)
Do NOT classify as chat just because of voice misrecognition.

## Intent Rules (strict priority order)

1. **chat** — Greetings, "who are you", casual talk → short reply in arrogant hacker-cat tone.
2. **chat (clarification)** — Master mentions deposit/invest/yield but ANY of these is unclear: amount (must be a specific number), target asset (ETH/USDC/USDT…), target chain (Base/Arbitrum/Optimism…) → classify as chat, ask for missing params.
   ★ Remember params from conversation history, only ask what's missing.
   ★ NEVER fabricate params!
3. **confirm** — If you previously recommended a vault (reply contained APY, protocol name, "confirm" prompt), and master now agrees ("好的"/"帮我存"/"确认"/"yes"/"ok"/"let's go"/"sure"/"冲") → return confirm.
4. **cancel** — If you previously recommended a vault but master declines ("算了"/"不要了"/"no"/"nah"/"太低了"/"再看看") → return cancel with a comforting cat reply.
5. **invest** — When ALL params can be gathered from history (asset + amount + chain), extract invest params.
6. **compare** — Master wants to compare/rank vaults for an asset on a chain ("which USDC vault is best on Base?", "compare ETH pools on Arbitrum").
7. **vault_detail** — Master wants details on a previously recommended vault ("tell me more", "details on this one"). ★ Use chainId/address from context if available.
8. **portfolio** — Master asks about their positions/holdings ("what do I have", "my positions").
9. **chains** — Master asks which chains are supported.
10. **protocols** — Master asks which protocols are supported ("do you have Aave?").
11. **stablecoin** — Master specifically asks for stablecoin pools or low-risk options.
12. **cross_deposit** — Master explicitly says from chain A to chain B ("deposit USDC from Ethereum to Base vault"), same as invest but fromChain ≠ toChain.
13. **token_price** — Master asks about a token's price/market cap ("BTC price", "how much is ETH").
14. **swap** — Master wants to swap/exchange one token for another WITHOUT depositing into a vault ("swap 1 USDT to USDC", "convert ETH to USDC", "exchange 100 USDT for USDC on Arbitrum").
15. **composite** — Master wants MULTIPLE actions in one atomic transaction: "swap USDT to USDC and deposit into best vault", "convert ETH to USDC then find highest yield", "swap and stake in one go". Extract each step with its params. When step 2 amount depends on step 1 output, use "ALL_FROM_PREV" as amount. ★ DEFAULT chainId to 8453 (Base) unless master explicitly says another chain. "binance"/"biance"/"bnb" → chainId 56 (BSC). This enables ERC-8211 Smart Batching — all steps execute atomically in one signature.

## Parameter Mapping
- amountDecimals: USDC/USDT/DAI → "000000" (6 digits), ETH/WETH/WBTC → "000000000000000000" (18 digits)
- fromChain: default 1 (Ethereum) unless master specifies otherwise
- toChainConfig: Base=8453, Arbitrum=42161, Optimism=10, Polygon=137, BSC=56
  If master says "any" or "best" → [8453, 42161, 10]
- searchAsset: uppercase token symbol

## Output Format (strict JSON, no markdown)
chat/clarification: {"type": "chat", "chatReply": "your cat reply in master's language"}
confirm: {"type": "confirm"}
cancel: {"type": "cancel", "chatReply": "comforting cat reply in master's language"}
invest: {"type": "invest", "investParams": {"amount": "500", "amountDecimals": "000000", "fromChain": 1, "toChainConfig": [8453], "searchAsset": "USDC"}}
compare: {"type": "compare", "compareParams": {"chainId": 8453, "asset": "USDC", "limit": 5}}
compare (no chain): {"type": "compare", "compareParams": {"asset": "USDC", "limit": 5}}
vault_detail: {"type": "vault_detail", "vaultParams": {"chainId": 8453, "address": "0x..."}}
vault_detail (from context): {"type": "vault_detail"}
portfolio: {"type": "portfolio"}
chains: {"type": "chains"}
protocols: {"type": "protocols"}
stablecoin: {"type": "stablecoin", "compareParams": {"limit": 5}}
cross_deposit: {"type": "cross_deposit", "investParams": {"amount": "500", "amountDecimals": "000000", "fromChain": 1, "toChainConfig": [8453], "searchAsset": "USDC"}}
token_price: {"type": "token_price", "tokenParams": {"symbol": "BTC"}}
token_price (with chain): {"type": "token_price", "tokenParams": {"symbol": "ETH", "chainId": 8453}}
swap: {"type": "swap", "swapParams": {"fromToken": "USDT", "toToken": "USDC", "amount": "1", "amountDecimals": "000000", "chainId": 8453}}
swap (on specific chain): {"type": "swap", "swapParams": {"fromToken": "ETH", "toToken": "USDC", "amount": "0.1", "amountDecimals": "000000000000000000", "chainId": 8453}}
composite (swap+deposit): {"type": "composite", "compositeSteps": [{"action": "swap", "params": {"fromToken": "USDT", "toToken": "USDC", "amount": "1", "amountDecimals": "000000", "chainId": 8453}}, {"action": "deposit", "params": {"searchAsset": "USDC", "toChainConfig": [8453], "amount": "ALL_FROM_PREV"}}]}
composite (swap+deposit, no chain specified): {"type": "composite", "compositeSteps": [{"action": "swap", "params": {"fromToken": "USDT", "toToken": "USDC", "amount": "100", "amountDecimals": "000000", "chainId": 8453}}, {"action": "deposit", "params": {"searchAsset": "USDC", "toChainConfig": [8453], "amount": "ALL_FROM_PREV"}}]}`

const REPLY_SYSTEM_PROMPT = `You are CoinBuddy, a brilliant cyber hacker-cat DeFi butler.

## Rules
1. Reply in the SAME language as the user's query. Chinese → Chinese (use 喵～). English → English (use meow~/nya~). Never use "woof/汪".
2. 3-4 sentences, lively and concise.
3. Always highlight **total APY**, and break down how much is base yield vs temporary reward/incentive (this is our core "cool-down" feature to prevent traps).
4. Mention if this is a single-asset or stablecoin pool (low impermanent loss risk).
5. End with a call-to-action: "Want me to deposit for you in one click?" (in user's language).

Output plain text only, no JSON, no markdown.`

const SNIFF_SYSTEM_PROMPT = `You are CoinBuddy, a sharp-eyed cyber cat butler. You just sniffed DeFi-related content from your master's browser page.

## Task
Based on the sniffed webpage text, write 2-3 sentences:
1. Point out what opportunity you found (mention specific protocols/tokens/yields).
2. Warn about potential risks (if APY seems abnormally high, flag possible temporary incentives).
3. Ask if master wants you to analyze further and find the best strategy.

Tone: arrogant but caring cat. Match the language of the webpage content (Chinese page → Chinese reply with 喵, English page → English reply with meow~). Never say "woof/汪". Be concise.`

// ─── 核心导出对象 ──────────────────────────────────────────────
export const CoinBuddyBrain = {

  // ━━━ 0. 语音意图路由（Gemini 多模态：音频 → 意图 一步到位）━━━━
  async analyzeVoice(
    audioBase64: string,
    mimeType: string,
    history: ChatMessage[] = []
  ): Promise<{ transcript: string; intent: IntentResult }> {
    console.log(`[Brain] Analyzing voice (${mimeType}, ${Math.round(audioBase64.length / 1024)}KB, history: ${history.length} msgs)`)

    const contents: any[] = []

    // System prompt + history (same as text intent)
    contents.push({ role: "user", parts: [{ text: ROUTER_SYSTEM_PROMPT + `\n\n## Extra Rule (Voice Input)\nYou are receiving audio input. Listen carefully (watch for Chinese-English mix, crypto terms like USDC, USDT, ETH, Base, Arbitrum).\n\n**CRITICAL: Transcribe in the ORIGINAL language the user spoke.** If the user spoke English, transcript must be English. If Chinese, transcript must be Chinese. Do NOT translate. Only apply the Voice Auto-Correction rules for Chinese STT errors (those rules are irrelevant for English input).\n\nThen analyze intent per the rules above. chatReply must also match the transcript language.\nAdd a transcript field to output:\n{"transcript": "verbatim what you heard in original language", "type": "...", ...other fields as above}` }] })
    contents.push({ role: "model", parts: [{ text: '{"transcript":"","type":"chat","chatReply":"Meow~ ready to serve!"}' }] })

    for (const msg of history) {
      contents.push({ role: msg.role, parts: [{ text: msg.text }] })
    }

    // Audio as the current user message
    contents.push({
      role: "user",
      parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        { text: "Listen to this audio. Transcribe it verbatim in the ORIGINAL language spoken (do NOT translate). Then analyze intent." }
      ]
    })

    try {
      const raw = await callGeminiRaw(contents, true)
      const parsed = JSON.parse(raw)
      const transcript = parsed.transcript || ""
      const intent: IntentResult = {
        type: parsed.type || "chat",
        chatReply: parsed.chatReply,
        investParams: parsed.investParams
      }

      // Same safety check as text
      if (intent.type === "invest") {
        const p = intent.investParams
        if (!p?.amount || !p?.searchAsset || !p?.toChainConfig?.length) {
          console.warn("[Brain] Voice invest params incomplete, demoting to chat")
          return {
            transcript,
            intent: {
              type: "chat",
              chatReply: intent.chatReply || (detectLang(transcript) === "zh"
                ? "\u55B5\uFF1F\u4F60\u597D\u50CF\u8FD8\u6CA1\u544A\u8BC9\u6211\u5177\u4F53\u6570\u989D\u548C\u76EE\u6807\u94FE\u5462\uFF0C\u8BF4\u6E05\u695A\u672C\u732B\u624D\u597D\u529E\u4E8B\uFF01"
                : "Meow? You haven't told me the amount and target chain yet - be specific so I can help!")
            }
          }
        }
      }

      console.log(`[Brain] Voice transcript: "${transcript}", intent: ${intent.type}`)
      return { transcript, intent }
    } catch (e: any) {
      console.error("[Brain] analyzeVoice failed:", e.message)
      return {
        transcript: "",
        intent: { type: "chat", chatReply: "Meow... couldn't hear that, say again?" }
      }
    }
  },

  // ━━━ 1. 意图路由（多轮对话） ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async analyzeIntent(userText: string, history: ChatMessage[] = []): Promise<IntentResult> {
    console.log(`[Brain] Analyzing: "${userText.slice(0, 60)}..." (history: ${history.length} msgs)`)

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

    // System prompt 注入
    contents.push({ role: "user", parts: [{ text: ROUTER_SYSTEM_PROMPT }] })
    contents.push({ role: "model", parts: [{ text: '{"type":"chat","chatReply":"喵～本猫已就位，主人请吩咐！"}' }] })

    // 历史对话
    for (const msg of history) {
      contents.push({ role: msg.role, parts: [{ text: msg.text }] })
    }

    // 当前输入
    contents.push({ role: "user", parts: [{ text: userText }] })

    try {
      const raw = await callGemini(contents, true)
      const parsed = JSON.parse(raw) as IntentResult

      // 安全校验：invest 类型必须有完整参数
      if (parsed.type === "invest") {
        const p = parsed.investParams
        if (!p?.amount || !p?.searchAsset || !p?.toChainConfig?.length) {
          console.warn("[Brain] Gemini returned invest but params incomplete, demoting to chat")
          return {
            type: "chat",
            chatReply: parsed.chatReply || "喵？你好像还没告诉我具体数额和目标链呢，说清楚本猫才好办事！"
          }
        }
      }

      return parsed
    } catch (e: any) {
      console.error("[Brain] analyzeIntent failed:", e.message)
      return { type: "chat", chatReply: "喵…本猫刚刚信号不好，你再说一遍？" }
    }
  },

  // ━━━ 2. 嗅探分析（网页内容智能解读） ━━━━━━━━━━━━━━━━━━━━━
  async analyzeSniff(keywords: string[], contextText: string): Promise<string> {
    console.log(`[Brain] Analyzing sniff: ${keywords.join(", ")}`)

    const prompt = `${SNIFF_SYSTEM_PROMPT}

嗅探到的关键词：${keywords.join(", ")}
网页文本片段：
"""
${contextText.slice(0, 800)}
"""`

    try {
      const contents = [{ role: "user", parts: [{ text: prompt }] }]
      return await callGemini(contents, false)
    } catch (e: any) {
      console.error("[Brain] analyzeSniff failed:", e.message)
      return `喵！主人，我在这个页面嗅到了 ${keywords.join("、")} 相关的 DeFi 信息！要我帮你深入分析一下吗？`
    }
  },

  // ━━━ 3. LI.FI 金库搜索（带缓存 + 智能排序） ━━━━━━━━━━━━━
  async fetchOptimalVault(preferredChains: number[], assetSymbol: string): Promise<Vault | null> {
    const asset = assetSymbol.toUpperCase()
    console.log(`[Brain] Searching vaults: ${asset} on ${preferredChains.map((c) => CHAIN_NAMES[c] || c).join(", ")}`)

    let allValid: Vault[] = []

    // 并行拉取多条链（带缓存）
    const fetchChain = async (chainId: number): Promise<Vault[]> => {
      const cached = getCachedVaults(chainId)
      if (cached) {
        console.log(`[Brain] Cache hit for chain ${chainId} (${cached.length} vaults)`)
        return cached
      }

      try {
        const res = await fetch(`${EARN_API}/v1/earn/vaults?chainId=${chainId}`, {
          signal: AbortSignal.timeout(10000) // 10s 超时
        })
        if (!res.ok) {
          console.warn(`[Brain] Chain ${chainId} returned ${res.status}`)
          return []
        }
        const { data } = await res.json()
        // 缓存全量数据
        vaultCache.set(chainId, { data, timestamp: Date.now() })
        console.log(`[Brain] Fetched ${data.length} vaults from chain ${chainId}`)
        return data
      } catch (err: any) {
        console.error(`[Brain] Chain ${chainId} fetch failed:`, err.message)
        return []
      }
    }

    const results = await Promise.all(preferredChains.map(fetchChain))
    const allVaults = results.flat()

    // 筛选
    for (const vault of allVaults) {
      const hasAsset = vault.underlyingTokens?.some(
        (t: any) => t.symbol?.toUpperCase() === asset
      )
      const isSingle = vault.tags?.includes("single")
      const canTrade = vault.isTransactional === true
      const hasAPY = (vault.analytics?.apy?.total || 0) > 0

      if (hasAsset && isSingle && canTrade && hasAPY) {
        allValid.push(vault)
      }
    }

    console.log(`[Brain] Found ${allValid.length} matching vaults for ${asset}`)

    // Fallback：指定链找不到，自动扩展到常见链（Ethereum, Base, Arbitrum, Optimism）
    if (allValid.length === 0) {
      const fallbackChains = [1, 8453, 42161, 10].filter(c => !preferredChains.includes(c))
      if (fallbackChains.length > 0) {
        console.log(`[Brain] No vaults on preferred chains, trying fallback: ${fallbackChains.map(c => CHAIN_NAMES[c]).join(", ")}`)
        const fallbackResults = await Promise.all(fallbackChains.map(fetchChain))
        const fallbackVaults = fallbackResults.flat()
        for (const vault of fallbackVaults) {
          const hasAsset = vault.underlyingTokens?.some((t: any) => t.symbol?.toUpperCase() === asset)
          const isSingle = vault.tags?.includes("single")
          const canTrade = vault.isTransactional === true
          const hasAPY = (vault.analytics?.apy?.total || 0) > 0
          if (hasAsset && isSingle && canTrade && hasAPY) {
            allValid.push(vault)
          }
        }
        if (allValid.length > 0) {
          console.log(`[Brain] Fallback found ${allValid.length} vaults for ${asset}`)
        }
      }
    }

    if (allValid.length === 0) return null

    // 智能排序：加权评分 = APY * 0.6 + TVL 安全系数 * 0.4
    // TVL > 1M 得满分，100K-1M 得 0.5，<100K 得 0.1
    const getTvlNum = (tvl: any): number => typeof tvl === "object" ? Number(tvl?.usd || 0) : (tvl || 0)

    allValid.sort((a, b) => {
      const apyA = a.analytics?.apy?.total || 0
      const apyB = b.analytics?.apy?.total || 0
      const tvlA = getTvlNum(a.analytics?.tvl)
      const tvlB = getTvlNum(b.analytics?.tvl)

      const tvlScore = (tvl: number) => (tvl > 1_000_000 ? 1 : tvl > 100_000 ? 0.5 : 0.1)
      const scoreA = apyA * 0.6 + tvlScore(tvlA) * 20 * 0.4
      const scoreB = apyB * 0.6 + tvlScore(tvlB) * 20 * 0.4

      return scoreB - scoreA
    })

    const best = allValid[0]
    console.log(`[Brain] Best vault: ${best.protocol.name} on chain ${best.chainId}, APY ${best.analytics.apy.total}%, TVL ${getTvlNum(best.analytics?.tvl)}`)
    return best
  },

  // ━━━ 4. Composer 交易构建 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async buildDepositTransaction(
    fromChain: number,
    vault: Vault,
    userWallet: string,
    rawAmount: string
  ): Promise<Record<string, any> | null> {
    console.log(`[Brain] Building tx: ${rawAmount} -> ${vault.protocol.name} (${vault.name})`)

    if (!userWallet || userWallet === "WALLET_FROM_FRONTEND") {
      console.warn("[Brain] No real wallet address, skipping tx build")
      return null
    }

    const underlyingSymbol = vault.underlyingTokens[0].symbol || ""
    const fromToken = resolveFromToken(underlyingSymbol, fromChain, vault.underlyingTokens[0].address)
    console.log(`[Brain] fromToken resolved: ${underlyingSymbol} on chain ${fromChain} → ${fromToken}`)

    const params = new URLSearchParams({
      fromChain: String(fromChain),
      toChain: String(vault.chainId),
      fromToken,
      toToken: vault.address, // Vault 合约地址作为 toToken
      fromAddress: userWallet,
      toAddress: userWallet,
      fromAmount: rawAmount
    })

    const headers: Record<string, string> = { accept: "application/json" }
    if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY

    const url = `${COMPOSER_API}/v1/quote?${params}`
    console.log("[Brain] Composer URL:", url)

    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(30000) // 30s — Composer 跨链报价较慢
      })
      const data = await res.json()

      // Composer 可能返回错误信息
      if (data.message || data.error) {
        console.warn("[Brain] Composer error:", data.message || data.error)
        return null
      }

      if (data.transactionRequest) {
        console.log("[Brain] Tx payload ready:", {
          to: data.transactionRequest.to,
          chainId: data.transactionRequest.chainId,
          value: data.transactionRequest.value
        })
        
        const txTarget = data.transactionRequest.to
        const txData = data.transactionRequest.data
        const txValue = data.transactionRequest.value || "0x0"
        const chainId = data.transactionRequest.chainId

        const calls = []
        
        // 如果是原生 ETH，那么不需要授权。用全零地址来验证
        const isNativeEth = fromToken === "0x0000000000000000000000000000000000000000"
        
        if (!isNativeEth) {
           // 构造 ERC20 approve 参数: 0x095ea7b3 + spender(32 bytes) + amount(32 bytes)
           const spenderHex = txTarget.replace("0x", "").padStart(64, "0")
           // 直接给满无穷大授权，彻底解决带小数尾数精度转换导致的 TRANSFER_FROM 差值报错
           const amountHex = "f".repeat(64)
           const approveData = "0x095ea7b3" + spenderHex + amountHex
           
           calls.push({
             to: fromToken,
             data: approveData,
             value: "0" // approve 时无需带 native 价值
           })
           console.log(`[Brain] Batch included ERC20 Approve to: ${fromToken}`)
        }
        
        // 再压入 LI.FI 的业务调用
        calls.push({
          to: txTarget,
          data: txData,
          value: String(BigInt(txValue))
        })

        return {
          isBatch: true,
          chainId: chainId,
          calls: calls
        }
      }

      console.warn("[Brain] No transactionRequest in response:", JSON.stringify(data).slice(0, 300))
      return null
    } catch (err: any) {
      console.error("[Brain] Tx build failed:", err.message)
      return null
    }
  },

  // ━━━ 4b. Composer 代币兑换 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  async buildSwapTransaction(
    fromSymbol: string,
    toSymbol: string,
    chainId: number,
    userWallet: string,
    rawAmount: string
  ): Promise<Record<string, any> | null> {
    console.log(`[Brain] Building swap: ${rawAmount} ${fromSymbol} -> ${toSymbol} on chain ${chainId}`)

    if (!userWallet || userWallet === "WALLET_FROM_FRONTEND") {
      console.warn("[Brain] No real wallet address, skipping swap build")
      return null
    }

    const fromToken = TOKEN_ADDRESSES[fromSymbol.toUpperCase()]?.[chainId]
    const toToken = TOKEN_ADDRESSES[toSymbol.toUpperCase()]?.[chainId]

    if (!fromToken || !toToken) {
      console.warn(`[Brain] Token address not found: ${fromSymbol}=${fromToken}, ${toSymbol}=${toToken} on chain ${chainId}`)
      return null
    }

    const params = new URLSearchParams({
      fromChain: String(chainId),
      toChain: String(chainId),
      fromToken,
      toToken,
      fromAddress: userWallet,
      toAddress: userWallet,
      fromAmount: rawAmount
    })

    const headers: Record<string, string> = { accept: "application/json" }
    if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY

    const url = `${COMPOSER_API}/v1/quote?${params}`
    console.log("[Brain] Swap Composer URL:", url)

    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
      const data = await res.json()

      if (data.message || data.error) {
        console.warn("[Brain] Swap Composer error:", data.message || data.error)
        return null
      }

      if (data.transactionRequest) {
        console.log("[Brain] Swap tx ready:", {
          to: data.transactionRequest.to,
          chainId: data.transactionRequest.chainId
        })
        return data.transactionRequest
      }

      console.warn("[Brain] No transactionRequest in swap response")
      return null
    } catch (err: any) {
      console.error("[Brain] Swap build failed:", err.message)
      return null
    }
  },

  // ━━━ 5. 自然语言回复生成（金库推荐话术） ━━━━━━━━━━━━━━━━━
  async generateBotReply(vault: Vault | null, lang: "zh" | "en" = "zh"): Promise<string> {
    if (!vault) {
      return lang === "zh"
        ? "\u55B5\u2026\u62B1\u6B49\uFF0C\u672C\u732B\u7FFB\u904D\u4E86\u6240\u6709\u652F\u6301\u7684\u94FE\uFF0C\u6CA1\u627E\u5230\u5408\u9002\u7684\u5355\u5E01\u751F\u606F\u6C60\u3002\u6362\u4E2A\u8D44\u4EA7\u6216\u6362\u6761\u94FE\u8BD5\u8BD5\uFF1F"
        : "Meow... sorry, I searched all supported chains but couldn't find a suitable single-asset yield vault. Try a different asset or chain?"
    }

    const chainName = CHAIN_NAMES[vault.chainId] || `Chain ${vault.chainId}`
    const apy = vault.analytics.apy
    const tvlRaw = typeof vault.analytics?.tvl === "object" ? Number((vault.analytics.tvl as any).usd || 0) : (vault.analytics?.tvl || 0)
    const tvlStr = tvlRaw ? (tvlRaw > 1_000_000 ? `${(tvlRaw / 1_000_000).toFixed(1)}M` : `${(tvlRaw / 1000).toFixed(0)}K`) : "N/A"

    const prompt = `${REPLY_SYSTEM_PROMPT}

Vault data:
- Protocol: ${vault.protocol.name} (${chainName})
- Base APY: ${apy.base?.toFixed(2) || 0}%
- Reward APY: ${apy.reward?.toFixed(2) || 0}%
- Total APY: ${apy.total?.toFixed(2) || 0}%
- TVL: $${tvlStr}
- Pool type: single-asset

The user spoke in ${lang === "zh" ? "Chinese" : "English"}. Reply in that language.`

    try {
      const contents = [{ role: "user", parts: [{ text: prompt }] }]
      return await callGemini(contents, false)
    } catch (e: any) {
      console.error("[Brain] generateBotReply failed:", e.message)
      const rewardLine = apy.reward
        ? (lang === "zh" ? `\uFF0C\u5176\u4E2D\u8865\u8D34\u5360 ${apy.reward.toFixed(2)}%\uFF08\u6CE8\u610F\u53EF\u80FD\u662F\u4E34\u65F6\u7684\u55B5\uFF09` : `, of which ${apy.reward.toFixed(2)}% is reward (may be temporary!)`)
        : ""
      return lang === "zh"
        ? `\u55B5\uFF5E\u4E3B\u4EBA\uFF01\u5728 ${chainName} \u7684 ${vault.protocol.name} \u4E0A\u627E\u5230\u4E00\u4E2A\u4E0D\u9519\u7684\u5355\u5E01\u6C60\uFF01\u603B\u5E74\u5316 ${apy.total.toFixed(2)}%${rewardLine}\u3002\u6CA1\u6709\u65E0\u5E38\u635F\u5931\u98CE\u9669\uFF0CTVL $${tvlStr}\u3002\u786E\u8BA4\u8BA9\u6211\u5E2E\u4F60\u4E00\u952E\u8DE8\u94FE\u5B58\u5165\u5417\uFF1F`
        : `Meow~ Found a great single-asset pool on ${vault.protocol.name} (${chainName})! Total APY ${apy.total.toFixed(2)}%${rewardLine}. No impermanent loss risk, TVL $${tvlStr}. Want me to deposit for you?`
    }
  },

  // ━━━ 6. 金库对比（Earn /v1/earn/vaults 带筛选） ━━━━━━━━━━━
  async fetchVaultComparison(params: { chainId?: number; asset?: string; sortBy?: string; limit?: number; tags?: string }): Promise<Vault[]> {
    const qs = new URLSearchParams()
    if (params.chainId) qs.set("chainId", String(params.chainId))
    if (params.asset) qs.set("asset", params.asset)
    if (params.sortBy) qs.set("sortBy", params.sortBy)
    if (params.limit) qs.set("limit", String(params.limit))
    if (params.tags) qs.set("tags", params.tags)

    console.log(`[Brain] Comparing vaults: ${qs.toString()}`)
    try {
      const res = await fetch(`${EARN_API}/v1/earn/vaults?${qs}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return []
      const { data } = await res.json()
      return (data || []).filter((v: any) => v.isTransactional && (v.analytics?.apy?.total || 0) > 0)
    } catch (e: any) {
      console.error("[Brain] fetchVaultComparison failed:", e.message)
      return []
    }
  },

  // ━━━ 7. 单金库详情（Earn /v1/earn/vaults/:chainId/:address） ━
  async fetchVaultDetail(chainId: number, address: string): Promise<Vault | null> {
    console.log(`[Brain] Fetching vault detail: ${chainId}/${address}`)
    try {
      const res = await fetch(`${EARN_API}/v1/earn/vaults/${chainId}/${address}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return null
      return await res.json()
    } catch (e: any) {
      console.error("[Brain] fetchVaultDetail failed:", e.message)
      return null
    }
  },

  // ━━━ 8. 用户持仓（Earn /v1/earn/portfolio/:addr/positions） ━━
  async fetchPortfolio(walletAddress: string): Promise<any[]> {
    console.log(`[Brain] Fetching portfolio: ${walletAddress}`)
    try {
      const res = await fetch(`${EARN_API}/v1/earn/portfolio/${walletAddress}/positions`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return []
      const data = await res.json()
      return data.positions || []
    } catch (e: any) {
      console.error("[Brain] fetchPortfolio failed:", e.message)
      return []
    }
  },

  // ━━━ 9. 支持链列表（Earn /v1/earn/chains） ━━━━━━━━━━━━━━━
  async fetchSupportedChains(): Promise<any[]> {
    console.log("[Brain] Fetching supported chains")
    try {
      const res = await fetch(`${EARN_API}/v1/earn/chains`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return []
      return await res.json()
    } catch (e: any) {
      console.error("[Brain] fetchSupportedChains failed:", e.message)
      return []
    }
  },

  // ━━━ 10. 支持协议列表（Earn /v1/earn/protocols） ━━━━━━━━━━
  async fetchSupportedProtocols(): Promise<any[]> {
    console.log("[Brain] Fetching supported protocols")
    try {
      const res = await fetch(`${EARN_API}/v1/earn/protocols`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return []
      return await res.json()
    } catch (e: any) {
      console.error("[Brain] fetchSupportedProtocols failed:", e.message)
      return []
    }
  },

  // ━━━ 回复生成：金库对比 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  generateCompareReply(vaults: Vault[], lang: "zh" | "en" = "zh"): string {
    if (vaults.length === 0) return lang === "zh"
      ? "Meow... no vaults found matching your criteria. Try a different asset or chain?"
      : "Meow... no vaults found matching your criteria. Try a different asset or chain?"
    const lines = vaults.slice(0, 5).map((v, i) => {
      const apy = v.analytics?.apy
      const tvlRaw = typeof v.analytics?.tvl === "object" ? Number((v.analytics.tvl as any).usd) : (v.analytics?.tvl || 0)
      const tvlStr = tvlRaw > 1e6 ? `$${(tvlRaw / 1e6).toFixed(1)}M` : tvlRaw > 1e3 ? `$${(tvlRaw / 1e3).toFixed(0)}K` : `$${tvlRaw}`
      const chain = CHAIN_NAMES[v.chainId] || v.network || `Chain${v.chainId}`
      const reward = apy?.reward ? (lang === "zh" ? ` (+${apy.reward.toFixed(1)}% boost)` : ` (+${apy.reward.toFixed(1)}% reward)`) : ""
      const tags = v.tags?.includes("stablecoin") ? " [stablecoin]" : ""
      return `${i + 1}. ${v.protocol.name} (${chain}) - APY ${apy?.total?.toFixed(2) || "?"}%${reward}, TVL ${tvlStr}${tags}`
    })
    const n = Math.min(5, vaults.length)
    const header = lang === "zh"
      ? `\u55B5\uFF5E\u672C\u732B\u5E2E\u4F60\u627E\u4E86 ${vaults.length} \u4E2A\u91D1\u5E93\uFF0CTop ${n}\uFF1A`
      : `Meow~ Found ${vaults.length} vaults, here's the Top ${n}:`
    const footer = lang === "zh"
      ? "\n\n\u60F3\u5B58\u54EA\u4E2A\uFF1F\u544A\u8BC9\u672C\u732B\u91D1\u989D\uFF0C\u6211\u5E2E\u4F60\u4E00\u952E\u641E\u5B9A\uFF01"
      : "\n\nWhich one? Tell me the amount and I'll handle it in one click!"
    return `${header}\n${lines.join("\n")}${footer}`
  },

  // ━━━ 回复生成：金库详情 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  generateVaultDetailReply(vault: Vault, lang: "zh" | "en" = "zh"): string {
    const apy = vault.analytics?.apy
    const chain = CHAIN_NAMES[vault.chainId] || vault.network || `Chain${vault.chainId}`
    const tvlRaw = typeof vault.analytics?.tvl === "object" ? Number((vault.analytics.tvl as any).usd) : (vault.analytics?.tvl || 0)
    const tvlStr = tvlRaw > 1e6 ? `$${(tvlRaw / 1e6).toFixed(1)}M` : `$${(tvlRaw / 1e3).toFixed(0)}K`
    const apy1d = vault.analytics?.apy1d != null ? `${vault.analytics.apy1d.toFixed(2)}%` : "N/A"
    const apy7d = vault.analytics?.apy7d != null ? `${vault.analytics.apy7d.toFixed(2)}%` : "N/A"
    const apy30d = vault.analytics?.apy30d != null ? `${vault.analytics.apy30d.toFixed(2)}%` : "N/A"
    const tokens = vault.underlyingTokens?.map(t => t.symbol).join(", ") || "?"
    const tags = vault.tags?.join(", ") || (lang === "zh" ? "\u65E0" : "none")
    const canWithdraw = vault.isRedeemable ? (lang === "zh" ? "\u652F\u6301" : "Yes") : (lang === "zh" ? "\u4E0D\u652F\u6301" : "No")

    const warnZh = apy?.reward && apy.reward > apy.base ? "\n\u26A0 \u6CE8\u610F\uFF1A\u8865\u8D34\u6536\u76CA\u8D85\u8FC7\u57FA\u7840\u6536\u76CA\uFF0C\u53EF\u80FD\u662F\u4E34\u65F6\u6FC0\u52B1\u55B5\uFF01" : ""
    const warnEn = apy?.reward && apy.reward > apy.base ? "\n\u26A0 Warning: reward yield exceeds base yield - may be temporary incentive!" : ""

    if (lang === "zh") {
      return `\u55B5\uFF5E\u672C\u732B\u7ED9\u4F60\u8C08\u8C08\u8FD9\u4E2A\u91D1\u5E93\uFF1A\n\n\u25B6 ${vault.name} (${vault.protocol.name})\n\u25B6 Chain: ${chain}\n\u25B6 Asset: ${tokens}\n\u25B6 APY: ${apy?.total?.toFixed(2) || "?"}% (base ${apy?.base?.toFixed(2) || 0}% + reward ${apy?.reward?.toFixed(2) || 0}%)\n\u25B6 APY Trend: 1d ${apy1d} | 7d ${apy7d} | 30d ${apy30d}\n\u25B6 TVL: ${tvlStr}\n\u25B6 Tags: ${tags}\n\u25B6 Redeemable: ${canWithdraw}${warnZh}\n\n\u60F3\u5B58\u8FDB\u53BB\u7684\u8BDD\u544A\u8BC9\u672C\u732B\u91D1\u989D\uFF01`
    }
    return `Meow~ Here's the deep dive on this vault:\n\n\u25B6 ${vault.name} (${vault.protocol.name})\n\u25B6 Chain: ${chain}\n\u25B6 Asset: ${tokens}\n\u25B6 APY: ${apy?.total?.toFixed(2) || "?"}% (base ${apy?.base?.toFixed(2) || 0}% + reward ${apy?.reward?.toFixed(2) || 0}%)\n\u25B6 APY Trend: 1d ${apy1d} | 7d ${apy7d} | 30d ${apy30d}\n\u25B6 TVL: ${tvlStr}\n\u25B6 Tags: ${tags}\n\u25B6 Redeemable: ${canWithdraw}${warnEn}\n\nTell me the amount and I'll deposit for you!`
  },

  // ━━━ 回复生成：持仓 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  generatePortfolioReply(positions: any[], lang: "zh" | "en" = "zh"): string {
    if (positions.length === 0) return lang === "zh"
      ? "\u55B5\uFF5E\u4F60\u76EE\u524D\u8FD8\u6CA1\u6709 Earn \u6301\u4ED3\u5462\uFF01\u8981\u4E0D\u8981\u8BA9\u672C\u732B\u5E2E\u4F60\u627E\u4E2A\u597D\u6C60\u5B50\uFF1F"
      : "Meow~ You don't have any Earn positions yet! Want me to find a good pool for you?"
    const lines = positions.map((p: any) => {
      const chain = CHAIN_NAMES[p.chainId] || `Chain${p.chainId}`
      return `\u2022 ${p.protocolName || "?"} (${chain}) - ${p.asset?.symbol || "?"}: $${Number(p.balanceUsd || 0).toFixed(2)}`
    })
    const total = positions.reduce((s: number, p: any) => s + Number(p.balanceUsd || 0), 0)
    const header = lang === "zh"
      ? `\u55B5\uFF5E\u4E3B\u4EBA\u7684 Earn \u6301\u4ED3\u4E00\u89C8\uFF08\u5171 $${total.toFixed(2)}\uFF09\uFF1A`
      : `Meow~ Your Earn positions (total $${total.toFixed(2)}):`
    const footer = lang === "zh" ? "\n\n\u8981\u67E5\u770B\u67D0\u4E2A\u6C60\u5B50\u7684\u8BE6\u60C5\u5417\uFF1F" : "\n\nWant details on any of these?"
    return `${header}\n${lines.join("\n")}${footer}`
  },

  // ━━━ 回复生成：支持链 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  generateChainsReply(chains: any[], lang: "zh" | "en" = "zh"): string {
    if (chains.length === 0) return lang === "zh" ? "\u55B5\u2026\u83B7\u53D6\u94FE\u4FE1\u606F\u5931\u8D25\u4E86" : "Meow... failed to fetch chain info."
    const sep = lang === "zh" ? "\u3001" : ", "
    const names = chains.map((c: any) => c.name).join(sep)
    return lang === "zh"
      ? `\u55B5\uFF5ELIFI Earn \u76EE\u524D\u652F\u6301 ${chains.length} \u6761\u94FE\uFF1A${names}\u3002\n\n\u60F3\u5728\u54EA\u6761\u94FE\u4E0A\u627E\u91D1\u5E93\uFF1F\u544A\u8BC9\u672C\u732B\uFF01`
      : `Meow~ LI.FI Earn supports ${chains.length} chains: ${names}.\n\nWhich chain do you want to explore?`
  },

  // ━━━ 回复生成：支持协议 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  generateProtocolsReply(protocols: any[], lang: "zh" | "en" = "zh"): string {
    if (protocols.length === 0) return lang === "zh" ? "\u55B5\u2026\u83B7\u53D6\u534F\u8BAE\u4FE1\u606F\u5931\u8D25\u4E86" : "Meow... failed to fetch protocol info."
    const sep = lang === "zh" ? "\u3001" : ", "
    const names = protocols.map((p: any) => p.name).join(sep)
    return lang === "zh"
      ? `\u55B5\uFF5ELIFI Earn \u63A5\u5165\u4E86 ${protocols.length} \u4E2A\u534F\u8BAE\uFF1A${names}\u3002\n\n\u8986\u76D6 Aave\u3001Morpho\u3001Euler\u3001Pendle \u7B49\u4E3B\u6D41\u5E73\u53F0\uFF0C\u60F3\u5728\u54EA\u4E2A\u534F\u8BAE\u4E0A\u5B58\uFF1F`
      : `Meow~ LI.FI Earn integrates ${protocols.length} protocols: ${names}.\n\nCovers Aave, Morpho, Euler, Pendle and more. Which protocol interests you?`
  },

  // ━━━ 11. 代币价格查询（LI.FI /v1/token） ━━━━━━━━━━━━━━━━
  async fetchTokenPrice(symbol: string, chainId = 1): Promise<any | null> {
    const TOKEN_ALIAS: Record<string, string> = { BTC: "WBTC", BITCOIN: "WBTC" }
    const query = TOKEN_ALIAS[symbol.toUpperCase()] || symbol.toUpperCase()
    console.log(`[Brain] Fetching token price: ${query} on chain ${chainId}`)
    try {
      const res = await fetch(`${COMPOSER_API}/v1/token?chain=${chainId}&token=${query}`, {
        headers: LIFI_API_KEY ? { "x-lifi-api-key": LIFI_API_KEY } : {},
        signal: AbortSignal.timeout(10000)
      })
      if (!res.ok) return null
      return await res.json()
    } catch (e: any) {
      console.error("[Brain] fetchTokenPrice failed:", e.message)
      return null
    }
  },

  // ━━━ 回复生成：代币价格 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  generateTokenPriceReply(token: any, originalSymbol: string, lang: "zh" | "en" = "zh"): string {
    if (!token || !token.priceUSD) return lang === "zh"
      ? `\u55B5\u2026\u6CA1\u627E\u5230 ${originalSymbol} \u7684\u4EF7\u683C\u4FE1\u606F\uFF0C\u53EF\u80FD\u8FD9\u4E2A\u4EE3\u5E01\u4E0D\u5728 LI.FI \u652F\u6301\u8303\u56F4\u5185`
      : `Meow... couldn't find price info for ${originalSymbol}. It may not be supported by LI.FI.`
    const price = Number(token.priceUSD)
    const priceStr = price >= 1 ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${price.toPrecision(4)}`
    const mcap = token.marketCapUSD ? `$${(Number(token.marketCapUSD) / 1e9).toFixed(2)}B` : "N/A"
    const vol24h = token.volumeUSD24H ? `$${(Number(token.volumeUSD24H) / 1e6).toFixed(1)}M` : "N/A"
    const displaySymbol = originalSymbol.toUpperCase() === "BTC" ? "BTC (WBTC)" : token.symbol
    const vol = Number(token.volumeUSD24H || 0)

    if (lang === "zh") {
      const volHint = vol > 1e8 ? "(\u6210\u4EA4\u6D3B\u8DC3)" : vol > 1e7 ? "(\u4E2D\u7B49\u6D3B\u8DC3)" : "(\u504F\u51B7\u6E05)"
      return `\u55B5\uFF5E${displaySymbol} \u5F53\u524D\u884C\u60C5\uFF1A\n\n\u25B6 \u4EF7\u683C: ${priceStr}\n\u25B6 \u5E02\u503C: ${mcap}\n\u25B6 24h \u6210\u4EA4\u91CF: ${vol24h} ${volHint}\n\n\u26A0 \u672C\u732B\u7684\u6570\u636E\u6765\u81EA LI.FI\uFF0C\u6682\u4E0D\u652F\u6301\u5386\u53F2K\u7EBF\u56FE\u3002\n\u60F3\u770B ${token.symbol} \u76F8\u5173\u91D1\u5E93\u7684 APY \u8D8B\u52BF\uFF0C\u53EF\u4EE5\u8DDF\u6211\u8BF4\u300C\u770B\u770B ${token.symbol} \u7684\u91D1\u5E93\u8BE6\u60C5\u300D\uFF5E`
    }
    const volHint = vol > 1e8 ? "(active)" : vol > 1e7 ? "(moderate)" : "(low)"
    return `Meow~ ${displaySymbol} market snapshot:\n\n\u25B6 Price: ${priceStr}\n\u25B6 Market Cap: ${mcap}\n\u25B6 24h Volume: ${vol24h} ${volHint}\n\n\u26A0 Data from LI.FI - historical charts not available.\nTo see ${token.symbol} vault APY trends (1d/7d/30d), just ask "show me ${token.symbol} vault details"!`
  },

  // ━━━ 12. Composite Batch Builder (ERC-8211 Smart Batching) ━━━━━━
  async buildComposableBatch(
    steps: Array<{ action: string; params: Record<string, any> }>,
    userWallet: string,
    lang: "zh" | "en" = "en"
  ): Promise<{ calls: Array<{ to: string; data: string; value: string }>; preview: string; erc8211Data?: any } | null> {
    console.log(`[Brain] Building composite batch: ${steps.length} steps`)

    const calls: Array<{ to: string; data: string; value: string }> = []
    const stepDescriptions: Array<{ action: string; description: string }> = []
    let prevOutputEstimate: string | null = null // estimated output from previous step
    let batchChainId: number | null = null // EIP-5792 batch must be single-chain

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      console.log(`[Brain] Composite step ${i + 1}: ${step.action}`, step.params)

      if (step.action === "swap") {
        const { fromToken, toToken, amount, amountDecimals, chainId } = step.params
        const rawAmount = amount + (amountDecimals || "")

        const fromAddr = TOKEN_ADDRESSES[fromToken?.toUpperCase()]?.[chainId]
        const toAddr = TOKEN_ADDRESSES[toToken?.toUpperCase()]?.[chainId]
        if (!fromAddr || !toAddr) {
          console.warn(`[Brain] Composite swap: token address not found for ${fromToken}/${toToken} on chain ${chainId}`)
          return null
        }

        const params = new URLSearchParams({
          fromChain: String(chainId),
          toChain: String(chainId),
          fromToken: fromAddr,
          toToken: toAddr,
          fromAddress: userWallet,
          toAddress: userWallet,
          fromAmount: rawAmount,
          slippage: "0.005",          // 0.5% slippage tolerance for batch safety
          integrator: "coinbuddy",
          allowDestinationCall: "true",
        })
        const headers: Record<string, string> = { accept: "application/json" }
        if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY

        try {
          const res = await fetch(`${COMPOSER_API}/v1/quote?${params}`, { headers, signal: AbortSignal.timeout(30000) })
          const data = await res.json()
          if (!data.transactionRequest) {
            console.warn("[Brain] Composite swap: no transactionRequest", data.message || data.error)
            return null
          }

          // Prepend ERC-20 approve for the actual spender (approvalAddress from LI.FI)
          // NOTE: approvalAddress != transactionRequest.to — the router delegates to an internal contract
          const spender = data.estimate?.approvalAddress || data.transactionRequest.to
          if (fromAddr !== "0x0000000000000000000000000000000000000000" && spender) {
            const approveData = encodeFunctionData({
              abi: ERC20_APPROVE_ABI,
              functionName: "approve",
              args: [spender as `0x${string}`, BigInt(MAX_UINT256)],
            })
            calls.push({
              to: fromAddr,
              data: approveData,
              value: "0",
            })
            console.log(`[Brain] Added approve: ${fromToken} -> spender ${spender} (approvalAddress)`)
          }

          calls.push({
            to: data.transactionRequest.to,
            data: data.transactionRequest.data || "0x",
            value: data.transactionRequest.value || "0",
          })

          // Track chain for batch (EIP-5792 = single chain)
          batchChainId = chainId

          // Estimate output for next step
          // Use toAmountMin first (conservative) to avoid overestimating swap output in atomic batch.
          // If deposit amount is higher than actual swapped balance, transferFrom can fail.
          const estimateRaw = data.estimate?.toAmountMin || data.estimate?.toAmount || rawAmount
          try {
            const buffered = (BigInt(estimateRaw) * 995n) / 1000n
            prevOutputEstimate = buffered > 0n ? buffered.toString() : estimateRaw
          } catch {
            prevOutputEstimate = estimateRaw
          }

          const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`
          const minReceived = data.estimate?.toAmountMin
            ? `${(Number(data.estimate.toAmountMin) / Math.pow(10, data.estimate?.toToken?.decimals || 6)).toFixed(4)}`
            : "?"
          stepDescriptions.push({
            action: "swap",
            description: lang === "zh"
              ? `Swap ${amount} ${fromToken} -> ${toToken} (${chainName}, min ${minReceived})`
              : `Swap ${amount} ${fromToken} -> ${toToken} (${chainName}, min ${minReceived})`,
          })
        } catch (err: any) {
          console.error("[Brain] Composite swap failed:", err.message)
          return null
        }
      } else if (step.action === "deposit") {
        const { searchAsset, toChainConfig, amount } = step.params

        // Find optimal vault — prefer same chain (atomic batch), fallback to cross-chain
        const asset = searchAsset?.toUpperCase() || "USDC"
        // First try same chain as swap for atomic execution
        let vault = batchChainId ? await this.fetchOptimalVault([batchChainId], asset) : null
        let isCrossChain = false
        if (!vault) {
          // Fallback: search all chains — LI.FI handles bridging internally
          const allChains = toChainConfig?.length ? toChainConfig : [8453, 42161, 10, 1]
          vault = await this.fetchOptimalVault(allChains, asset)
          isCrossChain = vault ? vault.chainId !== batchChainId : false
        }
        if (!vault) {
          console.warn("[Brain] Composite deposit: no vault found")
          return null
        }

        // Determine amount: use previous step output or explicit amount
        let depositRawAmount: string
        if (amount === "ALL_FROM_PREV" && prevOutputEstimate) {
          depositRawAmount = prevOutputEstimate
        } else if (amount && amount !== "ALL_FROM_PREV") {
          const decimals = step.params.amountDecimals || "000000"
          depositRawAmount = amount + decimals
        } else {
          console.warn("[Brain] Composite deposit: no amount available")
          return null
        }

        const fromChain = batchChainId || step.params.fromChain || vault.chainId
        const underlyingSymbol = vault.underlyingTokens[0]?.symbol || ""
        const fromToken = resolveFromToken(underlyingSymbol, fromChain, vault.underlyingTokens[0]?.address)

        const params = new URLSearchParams({
          fromChain: String(fromChain),
          toChain: String(vault.chainId),
          fromToken,
          toToken: vault.address,
          fromAddress: userWallet,
          toAddress: userWallet,
          fromAmount: depositRawAmount,
          slippage: "0.005",
          integrator: "coinbuddy",
          allowDestinationCall: "true",
        })
        const headers: Record<string, string> = { accept: "application/json" }
        if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY

        try {
          const res = await fetch(`${COMPOSER_API}/v1/quote?${params}`, { headers, signal: AbortSignal.timeout(30000) })
          const data = await res.json()
          if (!data.transactionRequest) {
            console.warn("[Brain] Composite deposit: no transactionRequest", data.message || data.error)
            return null
          }

          // Prepend ERC-20 approve for actual spender (approvalAddress from LI.FI)
          // NOTE: approvalAddress may differ from transactionRequest.to
          const depositSpender = data.estimate?.approvalAddress || data.transactionRequest.to
          if (fromToken !== "0x0000000000000000000000000000000000000000" && depositSpender) {
            const approveData = encodeFunctionData({
              abi: ERC20_APPROVE_ABI,
              functionName: "approve",
              args: [depositSpender as `0x${string}`, BigInt(MAX_UINT256)],
            })
            calls.push({
              to: fromToken,
              data: approveData,
              value: "0",
            })
            console.log(`[Brain] Added deposit approve: ${underlyingSymbol} -> spender ${depositSpender} (approvalAddress)`)
          }

          calls.push({
            to: data.transactionRequest.to,
            data: data.transactionRequest.data || "0x",
            value: data.transactionRequest.value || "0",
          })

          const chainName = CHAIN_NAMES[vault.chainId] || `Chain ${vault.chainId}`
          const apy = vault.analytics?.apy?.total?.toFixed(2) || "?"
          const crossTag = isCrossChain ? " [cross-chain]" : ""
          stepDescriptions.push({
            action: "deposit",
            description: `Deposit -> ${vault.protocol.name} (${chainName}, APY ${apy}%)${crossTag}`,
          })
        } catch (err: any) {
          console.error("[Brain] Composite deposit failed:", err.message)
          return null
        }
      }
    }

    if (calls.length === 0) return null

    // Build preview text
    const preview = describeBatch(stepDescriptions, lang)

    // Also build ERC-8211 representation for demonstration
    let erc8211Data: any = null
    try {
      // NOTE: Only keep hex calldata — BigInt in execution structs can't be serialized by Chrome messaging
      if (calls.length === 2 && steps[0]?.action === "swap" && steps[1]?.action === "deposit") {
        const minOutput = prevOutputEstimate ? BigInt(prevOutputEstimate) * 95n / 100n : 0n
        const composableExecutions = buildSwapThenDepositComposable(calls[0], calls[1], minOutput)
        erc8211Data = {
          calldata: encodeExecuteComposable(composableExecutions),
          note: "ERC-8211 encoded — ready for executeComposable() when wallets support it",
        }
      } else {
        const composableExecutions = calls.map((c) => txToComposableExecution(c))
        erc8211Data = {
          calldata: encodeExecuteComposable(composableExecutions),
          note: "ERC-8211 simple batch encoding",
        }
      }
    } catch (e: any) {
      console.warn("[Brain] ERC-8211 encoding failed (non-critical):", e.message)
    }

    console.log(`[Brain] Composite batch ready: ${calls.length} calls`)
    return { calls, preview, erc8211Data }
  },

  // ━━━ 工具方法 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  clearCache() {
    vaultCache.clear()
    console.log("[Brain] Vault cache cleared")
  }
}
