import { isValidEvmAddress } from "./withdraw-context.ts"

/**
 * Unified wallet address resolution for background service worker.
 *
 * Priority:
 * 1. payloadWalletAddress (from content script message) — if valid EVM address
 * 2. chrome.storage.local["coinbuddy_wallet"] — persisted by popup on connect
 * 3. cachedWalletAddress — in-memory fallback from pendingDepositDraft etc.
 * 4. null
 */
export async function getEffectiveWalletAddress(
  payloadWalletAddress?: string | null,
  cachedWalletAddress?: string | null,
): Promise<string | null> {
  // 1. Payload — must be a real EVM address, not garbage from content script
  if (payloadWalletAddress && isValidEvmAddress(payloadWalletAddress)) {
    return payloadWalletAddress
  }
  if (payloadWalletAddress) {
    console.warn(`[BG][wallet] invalid payload walletAddress: "${payloadWalletAddress}" — ignoring`)
  }

  // 2. chrome.storage.local
  try {
    const stored = await chrome.storage.local.get("coinbuddy_wallet")
    if (stored.coinbuddy_wallet && isValidEvmAddress(stored.coinbuddy_wallet)) {
      console.log(`[BG][wallet] recovered from storage: ${stored.coinbuddy_wallet.slice(0, 10)}...`)
      return stored.coinbuddy_wallet
    }
  } catch (e) {
    console.warn("[BG][wallet] failed to read coinbuddy_wallet from storage:", e)
  }

  // 3. In-memory cache (e.g. pendingDepositDraft.walletAddress)
  if (cachedWalletAddress && isValidEvmAddress(cachedWalletAddress)) {
    console.log(`[BG][wallet] using cached walletAddress: ${cachedWalletAddress.slice(0, 10)}...`)
    return cachedWalletAddress
  }

  return null
}
