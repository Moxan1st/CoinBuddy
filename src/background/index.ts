// CoinBuddy Background Service Worker
// 消息路由 + 对话记忆 + 待确认状态管理

import { CoinBuddyBrain, detectLang, type ChatMessage } from "./brain"

// 会话记忆（Service Worker 生命周期内持久化，最多 20 条）
let conversationHistory: ChatMessage[] = []
const MAX_HISTORY = 20

// 待确认状态缓存：用户确认时直接复用，无需重新搜索
let pendingVault: any = null
let pendingInvestParams: any = null
let pendingWalletAddress: string | null = null

function pushHistory(role: "user" | "model", text: string) {
  conversationHistory.push({ role, text })
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY)
  }
}

function clearPending() {
  pendingVault = null
  pendingInvestParams = null
  pendingWalletAddress = null
}

// 双语固定回复
const L = (lang: "zh" | "en", zh: string, en: string) => lang === "zh" ? zh : en

// 向发送消息的 tab 推送进度更新
function sendProgress(tabId: number | undefined, text: string) {
  if (!tabId) return
  chrome.tabs.sendMessage(tabId, { action: "PROGRESS", text }).catch(() => {})
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab?.id
  const handleRequest = async () => {
    try {
      switch (request.action) {
        case "SNIFF_MATCH":
          await handleSniffMatch(request.payload, sendResponse)
          break
        case "USER_ASK":
          await handleUserAsk(request.payload, sendResponse, tabId)
          break
        case "VOICE_ASK":
          await handleVoiceAsk(request.payload, sendResponse)
          break
        case "VOICE_TRANSCRIBE":
          await handleVoiceTranscribe(request.payload, sendResponse)
          break
        case "BUILD_TRANSACTION":
          await handleBuildTransaction(request.payload, sendResponse)
          break
        case "OPEN_POPUP":
          chrome.windows.create({
            url: chrome.runtime.getURL("popup.html"),
            type: "popup",
            width: 380,
            height: 320
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("[BG] Failed to open popup:", chrome.runtime.lastError.message)
            }
          })
          sendResponse({ status: "success" })
          break
        case "CLEAR_HISTORY":
          conversationHistory = []
          clearPending()
          CoinBuddyBrain.clearCache()
          sendResponse({ status: "success" })
          break
        default:
          sendResponse({ status: "error", error: "UNKNOWN_ACTION" })
      }
    } catch (error: any) {
      console.error("[Background Error]", error)
      sendResponse({ status: "error", error: error.message })
    }
  }

  handleRequest()
  return true // async sendResponse
})

// ── 嗅探命中 ──
async function handleSniffMatch(payload: any, sendResponse: (r: any) => void) {
  const keywords = payload.keywords || []
  const contextText = payload.contextText || ""
  console.log(`[BG] Sniff match: ${keywords.join(", ")}`)

  const suggestedReply = await CoinBuddyBrain.analyzeSniff(keywords, contextText)

  sendResponse({
    status: "success",
    petState: "alert",
    suggestedReply
  })
}

// ── 语音转文字（仅 STT，快速返回 transcript）──
async function handleVoiceTranscribe(payload: any, sendResponse: (r: any) => void) {
  const { audioBase64, mimeType } = payload
  try {
    const { transcript } = await CoinBuddyBrain.analyzeVoice(audioBase64, mimeType, conversationHistory)
    console.log(`[BG] Transcribe: "${transcript}"`)
    sendResponse({ transcript })
  } catch (e: any) {
    console.error("[BG] Transcribe failed:", e.message)
    sendResponse({ transcript: "" })
  }
}

// ── 语音对话：Gemini 多模态 音频→意图 一步到位 ──
async function handleVoiceAsk(payload: any, sendResponse: (r: any) => void) {
  const { audioBase64, mimeType, walletAddress } = payload

  const { transcript, intent: analysis } = await CoinBuddyBrain.analyzeVoice(
    audioBase64, mimeType, conversationHistory
  )

  console.log(`[BG] Voice transcript: "${transcript}", intent: ${analysis.type}`)

  // Reuse the same logic as text, but with the transcript as user text
  // We fake a USER_ASK payload with the transcript
  if (transcript) {
    await handleUserAsk({ text: transcript, walletAddress, _fromVoice: true, _voiceIntent: analysis }, sendResponse)
  } else {
    // Gemini couldn't hear anything
    const reply = analysis.chatReply || "Meow... couldn't hear that, say again?"
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, transcript: "" })
  }
}

// ── 用户对话：路由到 chat / invest / confirm / cancel ──
async function handleUserAsk(payload: any, rawSendResponse: (r: any) => void, tabId?: number) {
  const userText = payload.text
  const walletAddress = payload.walletAddress
  const lang = detectLang(userText)

  // Wrap sendResponse to always include transcript (needed for voice flow)
  const sendResponse = (r: any) => rawSendResponse({ ...r, transcript: userText })

  sendProgress(tabId, L(lang, "\uD83D\uDD0D \u6B63\u5728\u5206\u6790\u4F60\u7684\u610F\u56FE...", "\uD83D\uDD0D Analyzing your intent..."))

  // 如果从语音流过来，直接用已分析的意图；否则重新分析
  const analysis = payload._voiceIntent
    ? payload._voiceIntent
    : await CoinBuddyBrain.analyzeIntent(userText, conversationHistory)
  console.log(`[BG] Intent: ${analysis.type}`)

  // ── 闲聊 ──
  if (analysis.type === "chat") {
    const botReply = analysis.chatReply || L(lang, "\u55B5\uFF1F", "Meow?")
    pushHistory("user", userText)
    pushHistory("model", botReply)

    const walletKeywords = /连.{0,2}钱包|connect.*wallet|链接钱包|绑定钱包/i
    const wantsWallet = walletKeywords.test(userText) && !walletAddress

    sendResponse({
      status: "success",
      petState: "idle",
      reply: wantsWallet
        ? L(lang, "\u55B5\uFF5E\u6B63\u5728\u5E2E\u4F60\u5F39\u51FA\u94B1\u5305\u8FDE\u63A5\u7A97\u53E3\uFF01\u7A0D\u7B49\u4E00\u4E0B\uFF5E", "Meow~ Opening wallet connection window! One moment~")
        : botReply,
      transactionPayload: null,
      openWallet: wantsWallet
    })
    return
  }

  // ── 确认交易 / 连钱包（confirm 状态下也检测钱包关键词）──
  if (analysis.type === "confirm") {
    pushHistory("user", userText)

    // 先检测：用户说的其实是"连钱包"
    const walletKeywords = /连.{0,2}钱包|connect.*wallet|链接钱包|绑定钱包/i
    const wantsWallet = walletKeywords.test(userText) && !walletAddress

    if (wantsWallet) {
      const reply = L(lang, "\u55B5\uFF5E\u6B63\u5728\u5E2E\u4F60\u5F39\u51FA\u94B1\u5305\u8FDE\u63A5\u7A97\u53E3\uFF01\u7A0D\u7B49\u4E00\u4E0B\uFF5E", "Meow~ Opening wallet connection window! One moment~")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
      return
    }

    if (!pendingVault || !pendingInvestParams) {
      const reply = L(lang, "\u55B5\uFF1F\u4F60\u5728\u786E\u8BA4\u4EC0\u4E48\u5440\u2026\u672C\u732B\u8FD8\u6CA1\u7ED9\u4F60\u63A8\u8350\u8FC7\u91D1\u5E93\u5462\uFF0C\u5148\u544A\u8BC9\u6211\u4F60\u60F3\u5B58\u4EC0\u4E48\u5427\uFF01", "Meow? I haven't recommended any vault yet! Tell me what you'd like to deposit first!")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return
    }

    const effectiveWallet = walletAddress || pendingWalletAddress

    if (!effectiveWallet) {
      const reply = L(lang, "\u55B5\uFF5E\u4F60\u8FD8\u6CA1\u8FDE\u63A5\u94B1\u5305\u5462\uFF01\u672C\u732B\u5E2E\u4F60\u5F39\u51FA\u6765\uFF0C\u8FDE\u597D\u540E\u518D\u8DDF\u6211\u8BF4\u300C\u786E\u8BA4\u300D\uFF5E", "Meow~ You haven't connected a wallet yet! Let me open it for you - say 'confirm' after connecting~")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
      return
    }

    sendProgress(tabId, "🔧 正在构建交易...")
    let txPayload = await CoinBuddyBrain.buildDepositTransaction(
      pendingInvestParams.fromChain,
      pendingVault,
      effectiveWallet,
      pendingInvestParams.amount + pendingInvestParams.amountDecimals
    )

    const reply = txPayload
      ? L(lang, "\u55B5\uFF01\u4EA4\u6613\u5DF2\u5C31\u7EEA\uFF5E\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u7B7E\u540D\u5C31\u80FD\u4E00\u952E\u5B58\u5165\u5566\uFF01", "Meow! Transaction ready~ Click the button below to sign and deposit!")
      : L(lang, "\u55B5\u2026\u4EA4\u6613\u6784\u5EFA\u5931\u8D25\u4E86\uFF0C\u53EF\u80FD\u662F\u7F51\u7EDC\u6CE2\u52A8\uFF0C\u518D\u8BD5\u4E00\u6B21\uFF1F", "Meow... transaction build failed. Could be a network hiccup - try again?")

    pushHistory("model", reply)

    // 成功构建后清空 pending
    if (txPayload) clearPending()

    console.log(`[BG] Confirm: hasTx=${!!txPayload}, wallet=${!!effectiveWallet}`)
    sendResponse({
      status: "success",
      petState: "idle",
      reply,
      transactionPayload: txPayload
    })
    return
  }

  // ── 取消交易 ──
  if (analysis.type === "cancel") {
    clearPending()
    const reply = analysis.chatReply || L(lang, "\u55B5\uFF0C\u597D\u5427\uFF5E\u6709\u9700\u8981\u518D\u53EB\u672C\u732B\uFF01", "Meow, alright~ Call me when you need anything!")
    pushHistory("user", userText)
    pushHistory("model", reply)

    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  // ── 对比金库 compare ──
  if (analysis.type === "compare") {
    pushHistory("user", userText)
    sendProgress(tabId, "📊 正在对比金库数据...")
    const params = analysis.compareParams || {}
    const vaults = await CoinBuddyBrain.fetchVaultComparison({
      chainId: params.chainId,
      asset: params.asset,
      sortBy: params.sortBy || "apy",
      limit: params.limit || 5
    })
    const reply = CoinBuddyBrain.generateCompareReply(vaults, lang)
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  // ── 金库详情 vault_detail ──
  if (analysis.type === "vault_detail") {
    pushHistory("user", userText)
    sendProgress(tabId, "\uD83D\uDD0E " + L(lang, "\u6B63\u5728\u67E5\u8BE2\u91D1\u5E93\u8BE6\u60C5...", "Fetching vault details..."))
    let vault: any = null
    if (analysis.vaultParams?.chainId && analysis.vaultParams?.address) {
      vault = await CoinBuddyBrain.fetchVaultDetail(analysis.vaultParams.chainId, analysis.vaultParams.address)
    } else if (pendingVault) {
      vault = await CoinBuddyBrain.fetchVaultDetail(pendingVault.chainId, pendingVault.address)
    }
    const reply = vault
      ? CoinBuddyBrain.generateVaultDetailReply(vault, lang)
      : L(lang, "\u55B5\uFF1F\u4F60\u60F3\u770B\u54EA\u4E2A\u91D1\u5E93\u7684\u8BE6\u60C5\uFF1F\u5148\u8BA9\u672C\u732B\u5E2E\u4F60\u641C\u7D22\u4E00\u4E0B\u5427\uFF01", "Meow? Which vault do you want details on? Let me search first!")
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  // ── 查持仓 portfolio ──
  if (analysis.type === "portfolio") {
    pushHistory("user", userText)
    const effectiveWallet = walletAddress || pendingWalletAddress
    if (!effectiveWallet) {
      const reply = L(lang, "\u55B5\uFF5E\u4F60\u8FD8\u6CA1\u8FDE\u63A5\u94B1\u5305\u5462\uFF01\u8DDF\u6211\u8BF4\u300C\u8FDE\u94B1\u5305\u300D\uFF0C\u672C\u732B\u5E2E\u4F60\u5F39\u51FA\u6765\uFF5E", "Meow~ You haven't connected a wallet! Say 'connect wallet' and I'll open it~")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
      return
    }
    sendProgress(tabId, "\uD83D\uDCBC " + L(lang, "\u6B63\u5728\u67E5\u8BE2\u4F60\u7684\u6301\u4ED3...", "Fetching your positions..."))
    const positions = await CoinBuddyBrain.fetchPortfolio(effectiveWallet)
    const reply = CoinBuddyBrain.generatePortfolioReply(positions, lang)
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  // ── 查链 chains ──
  if (analysis.type === "chains") {
    pushHistory("user", userText)
    sendProgress(tabId, "🔗 正在获取支持的链...")
    const chains = await CoinBuddyBrain.fetchSupportedChains()
    const reply = CoinBuddyBrain.generateChainsReply(chains, lang)
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  // ── 查协议 protocols ──
  if (analysis.type === "protocols") {
    pushHistory("user", userText)
    sendProgress(tabId, "🏛️ 正在获取支持的协议...")
    const protocols = await CoinBuddyBrain.fetchSupportedProtocols()
    const reply = CoinBuddyBrain.generateProtocolsReply(protocols, lang)
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  // ── 稳定币池 stablecoin ──
  if (analysis.type === "stablecoin") {
    pushHistory("user", userText)
    sendProgress(tabId, "🪙 正在搜索稳定币池...")
    const params = analysis.compareParams || {}
    const vaults = await CoinBuddyBrain.fetchVaultComparison({
      sortBy: params.sortBy || "apy",
      limit: params.limit || 5,
      tags: "stablecoin"
    })
    const reply = CoinBuddyBrain.generateCompareReply(vaults, lang)
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  // ── 查价格 token_price ──
  if (analysis.type === "token_price") {
    pushHistory("user", userText)
    sendProgress(tabId, "💰 正在查询价格...")
    const params = analysis.tokenParams || { symbol: "ETH" }
    const token = await CoinBuddyBrain.fetchTokenPrice(params.symbol, params.chainId || 1)
    const reply = CoinBuddyBrain.generateTokenPriceReply(token, params.symbol, lang)
    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
    return
  }

  // ── 代币兑换 swap ──
  if (analysis.type === "swap") {
    pushHistory("user", userText)
    const sp = analysis.swapParams
    if (!sp) {
      const reply = L(lang, "\u55B5\uFF1F\u4F60\u60F3\u6362\u4EC0\u4E48\u5E01\uFF1F\u544A\u8BC9\u672C\u732B\u6570\u91CF\u548C\u5E01\u79CD\uFF0C\u6BD4\u5982\u300Cswap 1 USDT to USDC\u300D", "Meow? What do you want to swap? Tell me the amount and tokens, like 'swap 1 USDT to USDC'")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return
    }

    const effectiveWallet = walletAddress || pendingWalletAddress
    const chainName = sp.chainId === 1 ? "Ethereum" : sp.chainId === 8453 ? "Base" : sp.chainId === 42161 ? "Arbitrum" : `Chain ${sp.chainId}`

    // 先给用户看方案
    const preview = L(lang,
      `\u55B5\uFF5E\u672C\u732B\u5E2E\u4F60\u5151\u6362\uFF1A${sp.amount} ${sp.fromToken} \u2192 ${sp.toToken}\uFF08${chainName}\uFF09`,
      `Meow~ Swapping for you: ${sp.amount} ${sp.fromToken} \u2192 ${sp.toToken} (${chainName})`)

    if (!effectiveWallet) {
      const reply = preview + "\n" + L(lang, "\u4F46\u4F60\u8FD8\u6CA1\u8FDE\u94B1\u5305\u5462\uFF01\u672C\u732B\u5E2E\u4F60\u5F39\u51FA\u6765\uFF5E", "\nBut you haven't connected a wallet! Let me open it for you~")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
      return
    }

    sendProgress(tabId, L(lang, "\uD83D\uDD04 \u6B63\u5728\u6784\u5EFA\u5151\u6362\u4EA4\u6613...", "\uD83D\uDD04 Building swap transaction..."))
    const rawAmount = sp.amount + sp.amountDecimals
    const txPayload = await CoinBuddyBrain.buildSwapTransaction(
      sp.fromToken, sp.toToken, sp.chainId, effectiveWallet, rawAmount
    )

    const reply = txPayload
      ? preview + "\n" + L(lang, "\u4EA4\u6613\u5DF2\u5C31\u7EEA\uFF5E\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u7B7E\u540D\u5373\u53EF\uFF01", "\nTransaction ready~ Click the button below to sign!")
      : preview + "\n" + L(lang, "\u55B5\u2026\u4EA4\u6613\u6784\u5EFA\u5931\u8D25\u4E86\uFF0C\u53EF\u80FD\u662F\u8BE5\u94FE\u4E0A\u6CA1\u6709\u8FD9\u4E2A\u4EA4\u6613\u5BF9\uFF0C\u8BD5\u8BD5\u5176\u4ED6\u94FE\uFF1F", "\nMeow... swap build failed. This pair might not be available on this chain. Try another chain?")

    pushHistory("model", reply)
    sendResponse({ status: "success", petState: "idle", reply, transactionPayload: txPayload })
    return
  }

  // ── 组合操作 composite（ERC-8211 Smart Batching）──
  if (analysis.type === "composite") {
    pushHistory("user", userText)
    const steps = analysis.compositeSteps || []

    if (steps.length < 2) {
      const reply = L(lang, "\u55B5\uFF1F\u8FD9\u4E2A\u64CD\u4F5C\u53EA\u6709\u4E00\u6B65\uFF0C\u4E0D\u9700\u8981\u7EC4\u5408\u6267\u884C\u5440\uFF5E", "Meow? This only has one step, no need for batch execution~")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return
    }

    const effectiveWallet = walletAddress || pendingWalletAddress
    if (!effectiveWallet) {
      const reply = L(lang,
        "\u55B5\uFF5E\u8FD9\u662F\u4E2A\u591A\u6B65\u64CD\u4F5C\uFF0C\u4F46\u4F60\u8FD8\u6CA1\u8FDE\u94B1\u5305\u5462\uFF01\u672C\u732B\u5E2E\u4F60\u5F39\u51FA\u6765\uFF5E",
        "Meow~ This is a multi-step operation, but you haven't connected a wallet! Let me open it for you~")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null, openWallet: true })
      return
    }

    // Progress for each step
    for (let i = 0; i < steps.length; i++) {
      const stepName = steps[i].action === "swap" ? "swap" : steps[i].action === "deposit" ? "deposit" : steps[i].action
      sendProgress(tabId, L(lang,
        `\u26A1 Step ${i + 1}/${steps.length}: \u6B63\u5728\u6784\u5EFA ${stepName} \u4EA4\u6613...`,
        `\u26A1 Step ${i + 1}/${steps.length}: Building ${stepName} transaction...`))
    }

    const result = await CoinBuddyBrain.buildComposableBatch(steps, effectiveWallet, lang)

    if (!result) {
      const reply = L(lang,
        "\u55B5\u2026\u7EC4\u5408\u4EA4\u6613\u6784\u5EFA\u5931\u8D25\u4E86\uFF0C\u53EF\u80FD\u67D0\u4E2A\u6B65\u9AA4\u7684\u4EE3\u5E01\u5BF9\u4E0D\u53EF\u7528\u3002\u8BD5\u8BD5\u5206\u5F00\u6267\u884C\uFF1F",
        "Meow... batch build failed. A token pair in one of the steps might not be available. Try executing them separately?")
      pushHistory("model", reply)
      sendResponse({ status: "success", petState: "idle", reply, transactionPayload: null })
      return
    }

    const batchFooter = L(lang,
      "\n\n\u{1F43E} Powered by ERC-8211 Smart Batching\n\u4E00\u952E\u7B7E\u540D\u5373\u53EF\u539F\u5B50\u6267\u884C\u4EE5\u4E0A\u6240\u6709\u6B65\u9AA4\uFF01",
      "\n\n\u{1F43E} Powered by ERC-8211 Smart Batching\nSign once to atomically execute all steps!")
    const reply = result.preview + batchFooter

    pushHistory("model", reply)
    sendResponse({
      status: "success",
      petState: "idle",
      reply,
      transactionPayload: {
        isBatch: true,
        calls: result.calls,
        chainId: steps[0]?.params?.chainId || 8453,
        erc8211: result.erc8211Data,
      }
    })
    return
  }

  // ── 跨链存款 cross_deposit（同 invest，fromChain 明确不同于 toChain） ──
  if (analysis.type === "cross_deposit") {
    // Falls through to invest logic below
  }

  // ── 投资模式：搜索金库 + 生成推荐 ──
  const intent = analysis.investParams!
  console.log(`[BG] Invest mode:`, intent)

  sendProgress(tabId, "🏦 正在搜索最优金库...")
  const vault = await CoinBuddyBrain.fetchOptimalVault(intent.toChainConfig, intent.searchAsset)
  sendProgress(tabId, "✍️ 正在生成推荐...")
  const reply = await CoinBuddyBrain.generateBotReply(vault, lang)

  pushHistory("user", userText)
  pushHistory("model", reply)

  // 缓存金库和参数，等待用户确认
  if (vault) {
    pendingVault = vault
    pendingInvestParams = intent
    pendingWalletAddress = walletAddress || null
    console.log(`[BG] Cached pending vault: ${vault.protocol.name}, waiting for confirm`)
  }

  // 如果钱包已连接，也预构建 txPayload（用户可以直接点按钮）
  let txPayload = null
  if (vault && walletAddress) {
    sendProgress(tabId, "🔧 正在构建交易...")
    txPayload = await CoinBuddyBrain.buildDepositTransaction(
      intent.fromChain,
      vault,
      walletAddress,
      intent.amount + intent.amountDecimals
    )
  }

  console.log(`[BG] Invest result: vault=${vault?.protocol.name || "none"}, hasTx=${!!txPayload}`)

  sendResponse({
    status: "success",
    petState: "idle",
    reply,
    transactionPayload: txPayload
  })
}

// ── 独立交易构建请求 ──
async function handleBuildTransaction(payload: any, sendResponse: (r: any) => void) {
  const { walletAddress } = payload

  if (!pendingVault || !pendingInvestParams) {
    sendResponse({ status: "error", error: "No pending vault to build transaction for" })
    return
  }

  const txPayload = await CoinBuddyBrain.buildDepositTransaction(
    pendingInvestParams.fromChain,
    pendingVault,
    walletAddress,
    pendingInvestParams.amount + pendingInvestParams.amountDecimals
  )

  sendResponse({
    status: "ready",
    txData: txPayload
  })
}

console.log("[CoinBuddy Background] Service Worker Activated.")
