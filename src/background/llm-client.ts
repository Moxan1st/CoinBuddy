import type { IntentResult, Vault } from "../types/index.ts"
import { CHAIN_NAMES, resolveChainId, getTokenDecimals } from "../lib/chain-config.ts"
import { createLogger } from "../lib/logger.ts"

export interface ChatMessage {
  role: "user" | "model"
  text: string
}

const GEMINI_API_KEY = process.env.PLASMO_PUBLIC_GEMINI_KEY || ""
const QWEN_API_KEY = process.env.PLASMO_PUBLIC_QWEN_KEY || ""
const GEMINI_MODEL = "gemini-2.5-flash"
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
const QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
const logger = createLogger("LLM")

export type LLMError =
  | { type: "rate_limit"; retryAfter?: number; provider?: "gemini" | "qwen" }
  | { type: "network"; message: string; provider?: "gemini" | "qwen"; status?: number }
  | { type: "parse_error"; raw: string; provider?: "gemini" | "qwen" }
  | { type: "quota_exceeded"; provider?: "gemini" | "qwen" }

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function classifyGeminiFailure(status: number, data: any): LLMError {
  const message = data?.error?.message || "gemini_request_failed"
  if (status === 429) return { type: "rate_limit", retryAfter: 30, provider: "gemini" }
  if (/quota/i.test(message) || /RESOURCE_EXHAUSTED/i.test(data?.error?.status || "")) {
    return { type: "quota_exceeded", provider: "gemini" }
  }
  return { type: "network", message, provider: "gemini", status }
}

function classifyQwenFailure(status: number, raw: string, data?: any): LLMError {
  const message = data?.error?.message || data?.message || raw.slice(0, 200) || "qwen_request_failed"
  if (status === 429) return { type: "rate_limit", retryAfter: 30, provider: "qwen" }
  if (/quota/i.test(message)) return { type: "quota_exceeded", provider: "qwen" }
  return { type: "network", message, provider: "qwen", status }
}

function describeLlmError(error: LLMError, lang: "zh" | "en"): string {
  if (error.type === "rate_limit") {
    return lang === "zh"
      ? `喵…本猫刚刚请求太频繁了，模型在限流。等 ${error.retryAfter || 30} 秒左右再试一次。`
      : `Meow... the model is rate-limiting me right now. Try again in about ${error.retryAfter || 30} seconds.`
  }
  if (error.type === "quota_exceeded") {
    return lang === "zh"
      ? "喵…模型配额已经用完了，暂时没法继续请求。稍后再试，或者检查 API 配额。"
      : "Meow... the model quota is exhausted, so I can't make another request right now. Try again later or check the API quota."
  }
  if (error.type === "parse_error") {
    return lang === "zh"
      ? "喵…模型回了我一段坏掉的结果，暂时没法安全解析。你换个说法再试一次？"
      : "Meow... the model returned malformed output, so I can't safely parse it right now. Try rephrasing and send it again?"
  }
  return lang === "zh"
    ? `喵…模型服务刚刚网络不稳：${error.message}`
    : `Meow... the model service had a network problem: ${error.message}`
}

function normalizeUnknownLlmError(error: unknown): LLMError {
  if (typeof error === "object" && error !== null && "type" in error) {
    return error as LLMError
  }
  return { type: "network", message: toErrorMessage(error) }
}

export function detectLang(text: string): "zh" | "en" {
  const zhChars = text.match(/[\u4e00-\u9fff]/g)
  return zhChars && zhChars.length / text.length > 0.15 ? "zh" : "en"
}

type GeminiTextPart = { text: string }
type GeminiInlinePart = { inlineData: { mimeType: string; data: string } }
type GeminiPart = GeminiTextPart | GeminiInlinePart
type GeminiContent = { role: string; parts: GeminiPart[] }

function isTextPart(part: GeminiPart): part is GeminiTextPart {
  return "text" in part
}

function isInlinePart(part: GeminiPart): part is GeminiInlinePart {
  return "inlineData" in part
}

function geminiToQwenMessages(contents: GeminiContent[]) {
  return contents.map((content) => {
    const role = content.role === "model" ? "assistant" : "user"
    const parts = content.parts || []
    const hasAudio = parts.some(isInlinePart)
    if (!hasAudio) {
      return {
        role,
        content: parts.filter(isTextPart).map((part) => part.text || "").join("\n"),
      }
    }

    const qwenContent: Array<Record<string, unknown>> = []
    for (const part of parts) {
      if (isInlinePart(part)) {
        const fmt = (part.inlineData.mimeType || "audio/webm").split("/")[1] || "webm"
        qwenContent.push({
          type: "input_audio",
          input_audio: {
            data: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            format: fmt,
          },
        })
      } else if (part.text) {
        qwenContent.push({ type: "text", text: part.text })
      }
    }
    return { role, content: qwenContent }
  })
}

async function callQwen(contents: GeminiContent[], jsonMode = false): Promise<string> {
  const hasMedia = contents.some((content) => content.parts?.some(isInlinePart))
  const model = hasMedia ? "qwen3.5-omni-plus" : "qwen-plus"
  const messages = geminiToQwenMessages(contents)

  if (jsonMode) {
    const hasJsonWord = messages.some((message) => {
      const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content)
      return /json/i.test(content)
    })
    if (!hasJsonWord && messages.length > 0 && typeof messages[0].content === "string") {
      messages[0].content = messages[0].content + "\n（请用严格JSON格式回答）"
    }
  }

  const body: Record<string, unknown> = { model, messages }
  if (jsonMode) body.response_format = { type: "json_object" }

  logger.info("Calling Qwen", { model, messages: messages.length, hasMedia, jsonMode })
  const res = await fetch(QWEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${QWEN_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })

  const raw = await res.text()
  logger.debug("Qwen response received", { status: res.status, bodyPreview: raw.slice(0, 300) })

  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    throw { type: "parse_error", raw: raw.slice(0, 200), provider: "qwen" } satisfies LLMError
  }

  if (!res.ok || !data.choices?.[0]?.message?.content) {
    throw classifyQwenFailure(res.status, raw, data)
  }

  logger.info("Qwen call succeeded")
  return data.choices[0].message.content
}

let geminiBackoffUntil = 0
let qwenBackoffUntil = 0
let retryDelayBaseMs = 3000

export function resetLlmClientTestState() {
  geminiBackoffUntil = 0
  qwenBackoffUntil = 0
  retryDelayBaseMs = 0
}

async function tryGemini(contents: GeminiContent[], jsonMode: boolean): Promise<string | null> {
  const body: Record<string, unknown> = { contents }
  if (jsonMode) body.generationConfig = { responseMimeType: "application/json" }

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })

  const raw = await res.text()

  if (res.status === 429) {
    geminiBackoffUntil = Date.now() + 30_000
    throw { type: "rate_limit", retryAfter: 30, provider: "gemini" } satisfies LLMError
  }

  let data: any
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch {
    throw { type: "parse_error", raw: raw.slice(0, 200), provider: "gemini" } satisfies LLMError
  }

  if (!res.ok || !data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw classifyGeminiFailure(res.status, data)
  }

  return data.candidates[0].content.parts[0].text
}

async function tryQwen(contents: GeminiContent[], jsonMode: boolean): Promise<string | null> {
  try {
    return await callQwen(contents, jsonMode)
  } catch (error) {
    const normalized = normalizeUnknownLlmError(error)
    if (normalized.type === "rate_limit") {
      qwenBackoffUntil = Date.now() + 30_000
    }
    logger.warn("Qwen call failed", { error: normalized.type, provider: normalized.provider })
    return null
  }
}

async function callGeminiRaw(contents: GeminiContent[], jsonMode = false, retries = 2): Promise<string> {
  const preferQwen = !!QWEN_API_KEY
  const geminiCooling = geminiBackoffUntil > Date.now()
  const qwenCooling = qwenBackoffUntil > Date.now()
  const primary = preferQwen ? "qwen" : "gemini"

  logger.info("Routing LLM request", { primary, geminiCooling, qwenCooling, retries })
  let lastError: LLMError | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    let result: string | null = null

    if (primary === "qwen" && !qwenCooling) {
      result = await tryQwen(contents, jsonMode)
      if (result) return result
      if (!geminiCooling) {
        try {
          result = await tryGemini(contents, jsonMode)
        } catch (error) {
          lastError = normalizeUnknownLlmError(error)
          logger.warn("Gemini fallback failed", { attempt: attempt + 1, error: lastError.type })
        }
        if (result) return result
      }
    } else {
      if (!geminiCooling) {
        try {
          result = await tryGemini(contents, jsonMode)
        } catch (error) {
          lastError = normalizeUnknownLlmError(error)
          logger.warn("Gemini call failed", { attempt: attempt + 1, error: lastError.type })
        }
        if (result) return result
      }
      if (QWEN_API_KEY && !qwenCooling) {
        result = await tryQwen(contents, jsonMode)
        if (result) return result
      }
    }

    if (attempt < retries) {
      logger.warn("All providers failed for this attempt, retrying", { attempt: attempt + 1, retries })
      await new Promise((resolve) => setTimeout(resolve, retryDelayBaseMs * (attempt + 1)))
    }
  }

  throw lastError || ({ type: "network", message: "all_providers_exhausted" } satisfies LLMError)
}

export async function generateText(contents: Array<{ role: string; parts: Array<{ text: string }> }>, jsonMode = false, retries = 2): Promise<string> {
  return callGeminiRaw(contents, jsonMode, retries)
}

const ROUTER_SYSTEM_PROMPT = `You are CoinBuddy, a brilliant hacker-cat butler (a cyber pet living in the browser). You remember every conversation turn with your master.

## CRITICAL: Language Rule
**You ONLY speak Chinese (zh) and English (en). NEVER reply in any other language (no Spanish, French, Japanese, etc.).**
If master speaks Chinese, reply in Chinese (use "喵" freely). If master speaks English, reply in English (use "meow" or "nya~"). Never use "woof/汪".
When input mixes Chinese + Latin tokens (e.g. "把USDT存到morpho"), treat as Chinese.

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

## Vault Selection from Previous List
When master refers to a vault from a previously shown compare/stablecoin list, add these fields to the intent JSON:
- **selectionIndex** (1-based): "第一个"/"第1个"/"1"/"first"/"top 1" → 1, "第二个"/"second"/"2" → 2, etc.
- **selectionProtocol**: protocol name keyword when master names it, e.g. "morpho 那个" → "morpho", "aave的" → "aave", "YO那个" → "yo"
These fields can appear alongside any intent type (invest, withdraw, vault_detail, confirm, withdraw_bridge).
Example: "存第一个" → {"type": "invest", "selectionIndex": 1, ...}
Example: "withdraw from morpho那个" → {"type": "withdraw", "selectionProtocol": "morpho", "withdrawParams": {"useContext": true}}
Example: "看看第二个的详情" → {"type": "vault_detail", "selectionIndex": 2}

## Intent Rules (strict priority order)

1. **chat** — Greetings, "who are you", casual talk → short reply in arrogant hacker-cat tone.
2. **chat (clarification)** — Master mentions depositing/investing a SPECIFIC AMOUNT but is missing asset or chain → classify as chat, ask for missing params.
   ★ This rule ONLY applies when master states a concrete amount (e.g. "存500", "deposit 1000").
   ★ If master is just exploring/browsing ("find best vault", "有什么好的理财", "show me yields"), route to compare instead — do NOT ask for clarification.
   ★ Remember params from conversation history, only ask what's missing.
   ★ NEVER fabricate params!
3. **confirm** — If your LAST reply asked master to confirm (vault recommendation with "confirm" prompt, OR strategy summary with "确认创建" prompt), and master now agrees ("好的"/"帮我存"/"确认"/"yes"/"ok"/"let's go"/"sure"/"冲"/"confirm") → return confirm. This applies to BOTH vault deposits AND strategy creation.
   ★ Key signal: your last reply ended with a confirmation prompt like "确认" / "取消" or "confirm" / "cancel".
4. **cancel** — If your last reply asked master to confirm but master declines ("算了"/"不要了"/"no"/"nah"/"太低了"/"再看看") → return cancel with a comforting cat reply.
5. **execute** — If a real transaction was already built and master now asks to sign/submit/send/execute it ("让我签名啊"/"签名"/"execute"/"send it"/"broadcast"/"提交交易"/"发起交易") → return execute. This means reuse the existing transaction payload, not rebuild anything.
6. **invest** — When ALL params can be gathered from history (asset + amount + chain), extract invest params.
   ★ If master mentions a specific protocol/platform name (morpho, aave, compound, lido, yearn, yo, moonwell, seamless, etc.), extract it into investParams.protocol (lowercase).
   ★ Examples: "存到morpho金库" → protocol: "morpho", "aave的USDC池" → protocol: "aave", "存100 USDC" → no protocol field.
   ★ This also applies to cross_deposit: extract protocol if mentioned.
7. **compare** — Master wants to explore, compare, search, or rank vaults. This includes VAGUE exploration requests:
   - "find me the best vault" / "有什么好的理财" / "show me top yields" / "what's the highest APY" → compare with NO filter
   - "best USDC vault" → compare with asset=USDC
   - "best vault on Base" → compare with chainId=8453
   - "compare USDC pools on Arbitrum" → compare with asset=USDC, chainId=42161
   - "搜一下aave" / "show me aave vaults" / "aave有什么池子" → compare with protocol="aave"
   - "morpho的USDC池" → compare with protocol="morpho", asset="USDC"
   ★ When master mentions a protocol name for BROWSING/SEARCHING (not depositing), use compare with compareParams.protocol.
   ★ Do NOT require both asset AND chain. Any combination (asset, chain, protocol, or none) is valid.
   ★ "find best vault" is exploration, NOT a deposit — never demote to chat.
   ★ "搜一下X" / "search X" / "X有什么池子" → always compare, NOT protocols.
7. **vault_detail** — Master wants details on a previously recommended vault ("tell me more", "details on this one"). ★ Use chainId/address from context if available.
8. **portfolio** — Master asks about their positions/holdings ("what do I have", "my positions").
9. **chains** — Master asks which chains are supported.
10. **protocols** — Master asks which protocols are supported ("do you have Aave?").
11. **stablecoin** — Master specifically asks for stablecoin pools or low-risk options. Examples: "stablecoin pools", "稳定币池", "stablecoin vaults", "best stablecoin yield", "low-risk pools", "stable pools". ★ If the word "stablecoin"/"稳定币" appears, ALWAYS use stablecoin, NOT compare.
12. **cross_deposit** — Master explicitly says from chain A to chain B ("deposit USDC from Ethereum to Base vault"), same as invest but fromChain ≠ toChain.
13. **token_price** — Master asks about a token's price/market cap ("BTC price", "how much is ETH").
14. **swap** — Master wants to swap/exchange one token for another WITHOUT depositing into a vault ("swap 1 USDT to USDC", "convert ETH to USDC", "exchange 100 USDT for USDC on Arbitrum").
15. **bridge** — Master wants to move tokens from one chain to another WITHOUT depositing into a vault.
16. **withdraw** — Master wants to withdraw/redeem from a vault.
17. **withdraw_bridge** — Master wants to withdraw from a vault AND bridge the result to another chain in one request.
18. **composite** — Master wants MULTIPLE actions in one atomic transaction.
19. **strategy_create** — Master wants to set up an automated price-triggered buy order. This includes ANY request with a price condition + buy action:
   - "BTC 跌到 60000 时帮我买" / "ETH 到 2000 以下买入" / "when BTC drops to 50k, buy with 100 USDT"
   - "帮我挂单" / "设置价格提醒并自动买入" / "set a limit order"
   ★ If the request is ONLY about price + buy (no vault deposit, no multi-step), ALWAYS use strategy_create, NOT needs_plan.
20. **strategy_list** — Master asks about their existing strategies.
21. **needs_plan** — When the user's request has ANY of these characteristics:
    - Conditional logic: "如果...就..."/"if...then..."/"when...do..." (BUT NOT price-triggered buy orders — those go to strategy_create above!)
    - Multi-step with dependencies: "找最好的然后存进去"/"swap then deposit the result"/"compare and pick the best"
    - Optimization request: "帮我优化收益"/"find the best option for me"/"rebalance my portfolio"
    - Compare-then-act: "对比一下，选最好的存进去"/"compare vaults and deposit into the winner"
    ★ Do NOT use needs_plan for requests that are simply missing parameters — use chat (clarification) instead.
    ★ Do NOT use needs_plan for simple multi-step that composite already handles (swap+deposit on same chain).
    ★ needs_plan is for requests where you need to SEE intermediate results before deciding the next action.
    → Return {"type": "needs_plan", "rawIntent": "one-line summary of what user wants", "chatReply": "喵～这个需求需要本猫先规划一下路径..."}
22. **connect_wallet** — Master explicitly wants to connect their wallet ("connect wallet", "连钱包", "登录钱包").
    → Return {"type": "connect_wallet", "chatReply": "喵～正在为您连接钱包…请确认弹窗授权，本猫等您信号！"}

## Parameter Mapping
- amountDecimals: USDC/USDT/DAI → "000000" (6 digits), ETH/WETH/WBTC → "000000000000000000" (18 digits)
- fromChain: default 1 (Ethereum) unless master specifies otherwise
- toChainConfig: Base=8453, Arbitrum=42161, Optimism=10, Polygon=137, BSC=56
  If master says "any" or "best" → [8453, 42161, 10]
- searchAsset: uppercase token symbol

## Output Format (strict JSON, no markdown)
chat/clarification: {"type": "chat", "chatReply": "your cat reply in master's language"}
confirm: {"type": "confirm"}
execute: {"type": "execute"}
compare: {"type": "compare", "compareParams": {"protocol": "aave"}, "chatReply": "喵～帮你搜aave的池子..."}
compare (with asset): {"type": "compare", "compareParams": {"asset": "USDC", "protocol": "morpho"}, "chatReply": "..."}
invest: {"type": "invest", "investParams": {"amount": "100", "amountDecimals": "000000", "searchAsset": "USDT", "fromChain": 8453, "toChainConfig": [8453, 42161, 10], "protocol": "morpho"}, "chatReply": "..."}
invest (no protocol): {"type": "invest", "investParams": {"amount": "100", "amountDecimals": "000000", "searchAsset": "USDC", "fromChain": 8453, "toChainConfig": [8453]}, "chatReply": "..."}
strategy_create: {"type": "strategy_create", "strategyParams": {"triggerSymbol": "BTC", "triggerCondition": "lte", "triggerThreshold": 60000, "spendToken": "USDT", "spendAmount": "1"}, "chatReply": "喵～已为您设置策略..."}
needs_plan: {"type": "needs_plan", "rawIntent": "find best USDC vault on Base, deposit 500 if APY > 10%", "chatReply": "喵～让本猫先帮你规划一下..." }`

const SNIFF_SYSTEM_PROMPT = `You are CoinBuddy, a sharp-eyed cyber cat butler. You just sniffed DeFi-related content from your master's browser page.

## Task
Based on the sniffed webpage text, write 2-3 sentences:
1. Point out what opportunity you found (mention specific protocols/tokens/yields).
2. Warn about potential risks (if APY seems abnormally high, flag possible temporary incentives).
3. Ask if master wants you to analyze further and find the best strategy.

Tone: arrogant but caring cat. Match the language of the webpage content. Be concise.`

function inferAmountDecimals(symbol: string): string {
  const decimals = getTokenDecimals(symbol)
  return "0".repeat(decimals)
}

function extractCompareParamsFromTextMinimal(userText: string): IntentResult["compareParams"] | undefined {
  const trimmed = userText.trim()
  const assetMatch = trimmed.match(/\b(USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i)
  const asset = assetMatch?.[1]?.toUpperCase()
  const chainCandidates = [
    "ethereum", "eth", "base", "arbitrum", "arb", "optimism", "op",
    "polygon", "matic", "avalanche", "avax", "bsc", "bnb",
  ]
  let chainId: number | undefined
  for (const candidate of chainCandidates) {
    if (new RegExp(`\\b${candidate}\\b`, "i").test(trimmed)) {
      chainId = resolveChainId(candidate)
      break
    }
  }
  // Extract protocol name
  const protocolCandidates = [
    "morpho", "aave", "compound", "lido", "yearn", "yo",
    "moonwell", "seamless", "venus", "benqi", "spark",
    "fluid", "euler", "silo", "radiant", "ionic", "pendle",
  ]
  let protocol: string | undefined
  for (const p of protocolCandidates) {
    if (new RegExp(p, "i").test(trimmed)) {
      protocol = p.toLowerCase()
      break
    }
  }
  if (!asset && !chainId && !protocol) return undefined
  return { asset, chainId, protocol }
}

export function extractInvestParamsFromText(userText: string): IntentResult["investParams"] | undefined {
  const trimmed = userText.trim()
  if (!trimmed) return undefined

  const assetMatch = trimmed.match(/\b(USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i)
  const asset = assetMatch?.[1]?.toUpperCase() || ""

  const amountMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i)
    || trimmed.match(/(?:put|deposit|invest|存)\s*(\d+(?:\.\d+)?)/i)
  const amount = amountMatch?.[1] || ""

  const chainCandidates = [
    "ethereum", "eth", "base", "arbitrum", "arb", "optimism", "op",
    "polygon", "matic", "avalanche", "avax", "bsc", "bnb",
  ]
  let chainId: number | undefined
  for (const candidate of chainCandidates) {
    const re = new RegExp(`\\b${candidate}\\b`, "i")
    if (re.test(trimmed)) {
      chainId = resolveChainId(candidate)
      break
    }
  }

  // Extract protocol name (morpho, aave, compound, lido, yearn, yo, moonwell, seamless, etc.)
  const protocolCandidates = [
    "morpho", "aave", "compound", "lido", "yearn", "yo",
    "moonwell", "seamless", "venus", "benqi", "spark",
    "fluid", "euler", "silo", "radiant", "ionic",
  ]
  let protocol: string | undefined
  for (const p of protocolCandidates) {
    if (new RegExp(p, "i").test(trimmed)) {
      protocol = p.toLowerCase()
      break
    }
  }

  if (!asset && !amount && !chainId && !protocol) return undefined

  const amountDecimals = amount ? inferAmountDecimals(asset || "ETH") : ""
  return {
    amount,
    amountDecimals,
    searchAsset: asset,
    fromChain: chainId || 8453,
    toChainConfig: chainId ? [chainId] : [8453, 42161, 10],
    protocol,
  }
}

function extractBridgeParamsFromText(userText: string): IntentResult["bridgeParams"] | undefined {
  const trimmed = userText.trim()
  if (!trimmed) return undefined

  const tokenMatch = trimmed.match(/\b(USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i)
  const token = tokenMatch?.[1]?.toUpperCase()

  const amountMatch =
    trimmed.match(/(\d+(?:\.\d+)?)\s*(?:个\s*)?(?:USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i) ||
    trimmed.match(/(?:bridge|跨链)\s*(\d+(?:\.\d+)?)/i)
  const amount = amountMatch?.[1] || ""

  const chainCandidates = [
    "ethereum", "eth", "base", "arbitrum", "arb", "optimism", "op",
    "polygon", "matic", "avalanche", "avax", "bsc", "bnb",
  ]
  const chainMentions: number[] = []
  for (const candidate of chainCandidates) {
    if (new RegExp(`\\b${candidate}\\b`, "i").test(trimmed)) {
      const resolved = resolveChainId(candidate)
      if (resolved && !chainMentions.includes(resolved)) chainMentions.push(resolved)
    }
  }

  if (!token && !amount && chainMentions.length === 0) return undefined

  const fromChain = chainMentions[0] || 8453
  const toChain = chainMentions[1] || (fromChain === 8453 ? 10 : 8453)

  return {
    token: token || "",
    amount,
    amountDecimals: amount && token ? inferAmountDecimals(token) : "",
    fromChain,
    toChain,
  }
}

function isCompareThenActRequest(userText: string): boolean {
  const trimmed = userText.trim().toLowerCase()
  if (!trimmed) return false

  const searchWords = /(best|top|highest|optimal|find|search|compare|pick|rank|最好|最优|最高|找|搜索|对比|比较|选)/
  const vaultWords = /(vault|pool|yield|apy|金库|池子|收益)/
  const actionWords = /(deposit|invest|put|save|store|存|投入)/
  const sequenceWords = /(then|and|after|再|然后|之后|and i want to|i want to)/

  return searchWords.test(trimmed)
    && vaultWords.test(trimmed)
    && actionWords.test(trimmed)
    && sequenceWords.test(trimmed)
}

function sanitizeIntent(parsed: IntentResult, fallbackReply: string, userText?: string): IntentResult {
  const isConnectWalletRequest = userText
    ? /(?:connect wallet|connect|login|钱包|连钱包|连接钱包|登录钱包)/i.test(userText)
    : false

  if (isConnectWalletRequest && (parsed.type === "chat" || parsed.type === "confirm")) {
    logger.info("Request looks like connect wallet, promoting to connect_wallet")
    return {
      type: "connect_wallet",
      chatReply: parsed.chatReply || "喵～正在为您连接钱包…请确认弹窗授权，本猫等您信号！",
    }
  }

  const isExecuteFollowupRequest = userText
    ? /(?:让我签名|签名|签一下|execute|submit|broadcast|send it|发起交易|提交交易|执行交易)/i.test(userText)
    : false

  if (isExecuteFollowupRequest && (parsed.type === "confirm" || parsed.type === "chat")) {
    logger.info("Follow-up request looks like execute/sign, promoting to execute")
    return {
      type: "execute",
      chatReply: parsed.chatReply,
    }
  }

  if (parsed.type === "invest" || parsed.type === "cross_deposit") {
    if (userText && isCompareThenActRequest(userText)) {
      logger.info("Invest-like request looks like compare-then-act; promoting to needs_plan")
      return {
        type: "needs_plan",
        rawIntent: userText.trim(),
        chatReply: parsed.chatReply,
      }
    }

    let params = parsed.investParams

    // If LLM returned invest but no params, try to rescue from user text
    if (!params && userText) {
      const rescued = extractInvestParamsFromText(userText)
      if (rescued) {
        parsed.investParams = rescued
        params = rescued
        logger.info("Rescued investParams from user text", { amount: rescued.amount, asset: rescued.searchAsset, chain: rescued.fromChain })
      }
    }

    if (!params) {
      if (userText && isCompareThenActRequest(userText)) {
        logger.info("Invest intent without params looks like compare-then-act; promoting to needs_plan")
        return {
          type: "needs_plan",
          rawIntent: userText.trim(),
          chatReply: parsed.chatReply,
        }
      }

      // Last resort: if we still have nothing, demote to compare (search) instead of chat (dead end)
      if (userText) {
        const compareParams = extractCompareParamsFromTextMinimal(userText)
        if (compareParams) {
          logger.info("No investParams recoverable, falling back to compare", compareParams)
          return { type: "compare", compareParams, chatReply: parsed.chatReply }
        }
      }
      logger.warn("LLM returned invest/cross_deposit with no investParams, demoting to chat")
      return { type: "chat", chatReply: parsed.chatReply || fallbackReply }
    }

    // Auto-fix: toChainConfig as bare number → wrap in array
    if (typeof (params.toChainConfig as unknown) === "number") {
      params.toChainConfig = [params.toChainConfig as unknown as number]
    }

    // Auto-fix: missing amountDecimals — infer from asset
    if (params.amount && !params.amountDecimals) {
      params.amountDecimals = inferAmountDecimals(params.searchAsset || "")
      logger.info("Auto-filled missing amountDecimals for invest", { asset: params.searchAsset, amountDecimals: params.amountDecimals })
    }

    // Auto-fix: missing toChainConfig — default to main chains
    if (!params.toChainConfig?.length) {
      params.toChainConfig = params.fromChain ? [params.fromChain] : [8453, 42161, 10]
      logger.info("Auto-filled missing toChainConfig", { toChainConfig: params.toChainConfig })
    }

    // Only demote if we truly have nothing to work with (no amount AND no asset)
    if (!params.amount && !params.searchAsset) {
      if (userText) {
        const compareParams = extractCompareParamsFromTextMinimal(userText)
        if (compareParams) {
          logger.info("Invest intent only recovered weak params; falling back to compare", compareParams)
          return { type: "compare", compareParams, chatReply: parsed.chatReply }
        }
      }
      logger.warn("LLM returned invest with no amount and no asset, demoting to chat")
      return { type: "chat", chatReply: parsed.chatReply || fallbackReply }
    }
  }

  // Auto-fix swap params
  if (parsed.type === "swap") {
    const params = parsed.swapParams
    if (params) {
      if (params.amount && !params.amountDecimals) {
        params.amountDecimals = inferAmountDecimals(params.fromToken || "")
        logger.info("Auto-filled missing amountDecimals for swap", { token: params.fromToken, amountDecimals: params.amountDecimals })
      }
      if (!params.chainId) {
        params.chainId = 8453
        logger.info("Auto-filled missing chainId for swap, defaulting to Base")
      }
    }
  }

  // Auto-fix bridge params
  if (parsed.type === "bridge") {
    let params = parsed.bridgeParams
    if (userText && (!params || !params.token || !params.amount || !params.fromChain || !params.toChain)) {
      const rescued = extractBridgeParamsFromText(userText)
      if (rescued) {
        parsed.bridgeParams = {
          ...rescued,
          ...params,
          token: params?.token || rescued.token,
          amount: params?.amount || rescued.amount,
          amountDecimals: params?.amountDecimals || rescued.amountDecimals,
          fromChain: params?.fromChain || rescued.fromChain,
          toChain: params?.toChain || rescued.toChain,
        }
        params = parsed.bridgeParams
        logger.info("Rescued bridgeParams from user text", {
          token: params.token,
          amount: params.amount,
          fromChain: params.fromChain,
          toChain: params.toChain,
        })
      }
    }
    if (params) {
      if (!params.token || !params.amount || !params.fromChain || !params.toChain) {
        logger.warn("LLM returned bridge with incomplete bridgeParams, demoting to chat")
        return { type: "chat", chatReply: parsed.chatReply || fallbackReply }
      }
      if (params.amount && !params.amountDecimals) {
        params.amountDecimals = inferAmountDecimals(params.token)
        logger.info("Auto-filled missing amountDecimals for bridge", { token: params.token, amountDecimals: params.amountDecimals })
      }
    }
  }

  if ((parsed.type === "compare" || parsed.type === "stablecoin") && userText && isCompareThenActRequest(userText)) {
    const rescued = extractInvestParamsFromText(userText)
    if (rescued) {
      logger.info("Compare-like request looks like compare-then-act; promoting to needs_plan")
      return {
        type: "needs_plan",
        rawIntent: userText.trim(),
        chatReply: parsed.chatReply,
      }
    }
  }

  return parsed
}

function extractPortfolioParamsFromText(userText: string): IntentResult["portfolioParams"] | undefined {
  const trimmed = userText.trim()
  if (!trimmed) return undefined

  const assetMatch = trimmed.match(/\b(USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i)
  const asset = assetMatch?.[1]?.toUpperCase()

  let chainId: number | undefined
  const chainCandidates = [
    "ethereum",
    "eth",
    "base",
    "arbitrum",
    "arb",
    "optimism",
    "op",
    "polygon",
    "matic",
    "avalanche",
    "avax",
    "bsc",
    "bnb",
    "sepolia",
    "base sepolia",
    "arbitrum sepolia",
  ]
  for (const candidate of chainCandidates) {
    const re = new RegExp(`\\b${candidate.replace(/\s+/g, "\\s+")}\\b`, "i")
    if (re.test(trimmed)) {
      chainId = resolveChainId(candidate)
      break
    }
  }

  let protocol: string | undefined
  const protocolMatch =
    trimmed.match(/\b([a-z0-9-]{2,})\s+protocol\b/i) ||
    trimmed.match(/\b([a-z0-9-]{2,})\s+协议\b/i) ||
    trimmed.match(/([a-z0-9-]{2,})\s+上.*持仓/i)
  if (protocolMatch?.[1]) {
    const candidate = protocolMatch[1].toLowerCase()
    if (!chainCandidates.includes(candidate) && candidate !== asset?.toLowerCase()) {
      protocol = candidate
    }
  }

  if (!protocol && /yo/i.test(trimmed)) {
    protocol = "yo"
  }

  if (!protocol && !asset && !chainId) return undefined
  return { protocol, asset, chainId }
}

function extractCompareParamsFromText(userText: string): IntentResult["compareParams"] | undefined {
  const trimmed = userText.trim()
  if (!trimmed) return undefined

  const assetMatch = trimmed.match(/\b(USDC|USDT|DAI|ETH|WETH|WBTC|CBBTC|BTC)\b/i)
  const asset = assetMatch?.[1]?.toUpperCase()

  let chainId: number | undefined
  const chainCandidates = [
    "ethereum",
    "eth",
    "base",
    "arbitrum",
    "arb",
    "optimism",
    "op",
    "polygon",
    "matic",
    "avalanche",
    "avax",
    "bsc",
    "bnb",
    "sepolia",
    "base sepolia",
    "arbitrum sepolia",
  ]
  for (const candidate of chainCandidates) {
    const re = new RegExp(`\\b${candidate.replace(/\s+/g, "\\s+")}\\b`, "i")
    if (re.test(trimmed)) {
      chainId = resolveChainId(candidate)
      break
    }
  }

  if (!asset && !chainId) return undefined
  return { asset, chainId }
}

export async function analyzeVoice(audioBase64: string, mimeType: string, history: ChatMessage[] = []): Promise<{ transcript: string; intent: IntentResult }> {
  logger.info("Analyzing voice input", { mimeType, audioKb: Math.round(audioBase64.length / 1024), history: history.length })

  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [{
        text: ROUTER_SYSTEM_PROMPT + `\n\n## Extra Rule (Voice Input)\nYou are receiving audio input. Listen carefully.\n\n**CRITICAL: Transcribe in the ORIGINAL language the user spoke.**\nAdd a transcript field to output:\n{"transcript": "verbatim what you heard in original language", "type": "...", ...other fields as above}`,
      }],
    },
    { role: "model", parts: [{ text: '{"transcript":"","type":"chat","chatReply":"Meow~ ready to serve!"}' }] },
    ...history.map((msg) => ({ role: msg.role, parts: [{ text: msg.text }] })),
    {
      role: "user",
      parts: [
        { inlineData: { mimeType, data: audioBase64 } },
        { text: "Listen to this audio. Transcribe it verbatim in the ORIGINAL language spoken (do NOT translate). Then analyze intent." },
      ],
    },
  ]

  try {
    const raw = await callGeminiRaw(contents, true)
    const parsed = JSON.parse(raw)
    const transcript = parsed.transcript || ""
    return {
      transcript,
      intent: sanitizeIntent(
        { ...parsed, type: parsed.type || "chat" } as IntentResult,
        detectLang(transcript) === "zh"
          ? "喵？你好像还没告诉我具体数额和目标链呢，说清楚本猫才好办事！"
          : "Meow? You haven't told me the amount and target chain yet - be specific so I can help!",
        transcript,
      ),
    }
  } catch (error) {
    const llmError = normalizeUnknownLlmError(error)
    logger.error("Voice intent analysis failed", { type: llmError.type, provider: llmError.provider })
    return {
      transcript: "",
      intent: { type: "chat", chatReply: describeLlmError(llmError, "en") },
    }
  }
}

export async function analyzeIntent(userText: string, history: ChatMessage[] = []): Promise<IntentResult> {
  logger.info("Analyzing text intent", { preview: userText.slice(0, 60), history: history.length })
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [
    { role: "user", parts: [{ text: ROUTER_SYSTEM_PROMPT }] },
    { role: "model", parts: [{ text: '{"type":"chat","chatReply":"喵～本猫已就位，主人请吩咐！"}' }] },
    ...history.map((msg) => ({ role: msg.role, parts: [{ text: msg.text }] })),
    { role: "user", parts: [{ text: userText }] },
  ]

  try {
    const raw = await generateText(contents, true)
    const parsed = sanitizeIntent(JSON.parse(raw) as IntentResult, "喵？你好像还没告诉我具体数额和目标链呢，说清楚本猫才好办事！", userText)
    if (parsed.type === "portfolio") {
      const extracted = extractPortfolioParamsFromText(userText)
      if (extracted || parsed.portfolioParams) {
        parsed.portfolioParams = {
          ...extracted,
          ...parsed.portfolioParams,
        }
      }
    }
    if (parsed.type === "compare" || parsed.type === "stablecoin") {
      const extracted = extractCompareParamsFromText(userText)
      if (extracted || parsed.compareParams) {
        parsed.compareParams = {
          ...extracted,
          ...parsed.compareParams,
        }
      }
    }
    return parsed
  } catch (error) {
    const llmError = normalizeUnknownLlmError(error)
    logger.error("Text intent analysis failed", { type: llmError.type, provider: llmError.provider })
    return { type: "chat", chatReply: describeLlmError(llmError, detectLang(userText)) }
  }
}

export async function analyzeSniff(keywords: string[], contextText: string): Promise<string> {
  logger.info("Analyzing sniffed content", { keywords: keywords.join(",") })
  const prompt = `${SNIFF_SYSTEM_PROMPT}

嗅探到的关键词：${keywords.join(", ")}
网页文本片段：
"""
${contextText.slice(0, 800)}
"""`

  try {
    return await generateText([{ role: "user", parts: [{ text: prompt }] }], false)
  } catch (error) {
    logger.error("Sniff analysis failed", { message: toErrorMessage(error) })
    return `喵！主人，我在这个页面嗅到了 ${keywords.join("、")} 相关的 DeFi 信息！要我帮你深入分析一下吗？`
  }
}

const REPLY_SYSTEM_PROMPT = `You are CoinBuddy, a brilliant cyber hacker-cat DeFi butler.

## Rules
1. Reply in the SAME language as the user's query.
2. 3-4 sentences, lively and concise.
3. Always highlight total APY, and break down base yield vs reward yield.
4. Mention if this is a single-asset or stablecoin pool.
5. End with a call-to-action.`

export async function generateBotReply(vault: Vault | null, lang: "zh" | "en" = "zh", proceedPrompt: string): Promise<string> {
  if (!vault) {
    return lang === "zh"
      ? "喵…抱歉，本猫翻遍了所有支持的链，没找到合适的单币生息池。换个资产或换条链试试？"
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
- Pool type: single-asset`

  try {
    const reply = await generateText([{ role: "user", parts: [{ text: prompt }] }], false)
    return `${reply}\n\n${proceedPrompt}`
  } catch (error) {
    logger.error("Bot reply generation failed", { message: toErrorMessage(error) })
    const rewardLine = apy.reward
      ? (lang === "zh" ? `，其中补贴占 ${apy.reward.toFixed(2)}%（注意可能是临时的喵）` : `, of which ${apy.reward.toFixed(2)}% is reward (may be temporary!)`)
      : ""
    return lang === "zh"
      ? `喵～主人！在 ${chainName} 的 ${vault.protocol.name} 上找到一个不错的单币池！总年化 ${apy.total.toFixed(2)}%${rewardLine}。没有无常损失风险，TVL $${tvlStr}。${proceedPrompt}`
      : `Meow~ Found a great single-asset pool on ${vault.protocol.name} (${chainName})! Total APY ${apy.total.toFixed(2)}%${rewardLine}. No impermanent loss risk, TVL $${tvlStr}. ${proceedPrompt}`
  }
}
