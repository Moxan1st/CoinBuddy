/**
 * DOM Sniffer - detects DeFi-related keywords in visible page text
 * Triggers SNIFF_MATCH message to background when conditions met
 */

const DEFI_PATTERNS = {
  assets: ["USDC", "USDT", "DAI", "ETH", "WETH", "WBTC"],
  yield: ["APY", "APR", "收益", "yield", "interest", "earn", "reward"],
  protocols: ["Morpho", "Aave", "Compound", "Lido", "Uniswap", "Curve", "Yearn", "Pendle", "EigenLayer"]
}

let lastSniffedText = ""
let sniffCooldown = false

function getVisibleText(): string {
  const selection = document.body.innerText
  return selection.slice(0, 10000) // Cap to avoid perf issues
}

function detectMatch(text: string): { matched: boolean; keywords: string[]; contextText: string } | null {
  const upper = text.toUpperCase()
  const foundAssets = DEFI_PATTERNS.assets.filter((a) => upper.includes(a.toUpperCase()))
  const foundYield = DEFI_PATTERNS.yield.filter((y) => upper.includes(y.toUpperCase()))
  const foundProtocols = DEFI_PATTERNS.protocols.filter((p) => upper.includes(p.toUpperCase()))

  // Trigger when: (asset + yield keyword) OR (known protocol name)
  const hasAssetYield = foundAssets.length > 0 && foundYield.length > 0
  const hasProtocol = foundProtocols.length > 0

  if (hasAssetYield || hasProtocol) {
    const keywords = [...foundAssets, ...foundYield, ...foundProtocols]
    // Extract a context snippet around the first match
    const firstKeyword = keywords[0]
    const idx = upper.indexOf(firstKeyword.toUpperCase())
    const start = Math.max(0, idx - 100)
    const end = Math.min(text.length, idx + 200)
    return { matched: true, keywords, contextText: text.slice(start, end) }
  }
  return null
}

export type SniffCallback = (keywords: string[], contextText: string) => void

export function startSniffer(onMatch: SniffCallback) {
  const check = () => {
    if (sniffCooldown) return
    const text = getVisibleText()
    if (text === lastSniffedText) return
    lastSniffedText = text

    const result = detectMatch(text)
    if (result?.matched) {
      sniffCooldown = true
      onMatch(result.keywords, result.contextText)
      // Cooldown 30s to avoid spam
      setTimeout(() => {
        sniffCooldown = false
      }, 30000)
    }
  }

  // Check on scroll and periodically
  window.addEventListener("scroll", check, { passive: true })
  const interval = setInterval(check, 5000)

  // Initial check
  setTimeout(check, 2000)

  return () => {
    window.removeEventListener("scroll", check)
    clearInterval(interval)
  }
}
