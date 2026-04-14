/**
 * Agent Wallet — Isolated execution wallet for automated strategy execution
 *
 * NOT the user's main wallet. This is a dedicated hot wallet for background
 * strategy execution with spend limits and idempotency controls.
 *
 * ⚠️  DEV/TEST ONLY — CURRENT STORAGE MODEL LIMITATIONS:
 * - Private key is stored in chrome.storage.local as plaintext
 * - This is acceptable for development and testnet usage
 * - NOT suitable for production or real funds of significant value
 * - Production requires: encrypted storage, MPC wallet, or hardware signer
 *   (swap in a different WalletAdapter when ready)
 *
 * SECURITY MODEL (dev context):
 * - Private key is stored in chrome.storage.local at runtime only
 * - Only background service worker can read/write chrome.storage.local
 * - Content scripts and popup CANNOT access this storage area directly
 *   (they'd need to go through chrome.runtime.sendMessage, which we don't expose)
 * - The key is NEVER compiled into the bundle (no PLASMO_PUBLIC_ prefix)
 * - Injected once via a STRATEGY_SETUP_WALLET message from background console
 *
 * Wallet adapter abstraction preserved for future backends (MPC, hardware, etc).
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  type Hex,
  type TransactionReceipt,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { base, mainnet, arbitrum, optimism } from "viem/chains"
import type { AgentWallet, WalletAdapter } from "./types"
import { CHAIN_RPC } from "./config"

// ─── Storage key (chrome.storage.local, background-only) ───

const WALLET_STORAGE_KEY = "coinbuddy_agent_wallet_pk"

// ─── Chain objects for viem ───

const VIEM_CHAINS: Record<number, any> = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
}

// ─── ERC-20 balanceOf ABI ───

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const

// ─── Private Key Wallet Implementation ───

class PrivateKeyAgentWallet implements AgentWallet {
  readonly address: string
  private account: ReturnType<typeof privateKeyToAccount>

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey)
    this.address = this.account.address
    console.log(`[AgentWallet] Initialized: ${this.address}`)
  }

  private getPublicClient(chainId: number) {
    const chain = VIEM_CHAINS[chainId]
    const rpcUrl = CHAIN_RPC[chainId]
    if (!chain || !rpcUrl) throw new Error(`Unsupported chain: ${chainId}`)
    return createPublicClient({ chain, transport: http(rpcUrl) })
  }

  private getWalletClient(chainId: number) {
    const chain = VIEM_CHAINS[chainId]
    const rpcUrl = CHAIN_RPC[chainId]
    if (!chain || !rpcUrl) throw new Error(`Unsupported chain: ${chainId}`)
    return createWalletClient({
      account: this.account,
      chain,
      transport: http(rpcUrl),
    })
  }

  async signAndSendTransaction(tx: {
    to: string
    data: string
    value: string
    chainId: number
    gasLimit?: string
  }): Promise<string> {
    const wallet = this.getWalletClient(tx.chainId)

    const txHash = await wallet.sendTransaction({
      to: tx.to as Hex,
      data: tx.data as Hex,
      value: BigInt(tx.value || "0"),
      ...(tx.gasLimit ? { gas: BigInt(tx.gasLimit) } : {}),
    } as any)

    console.log(`[AgentWallet] Tx sent: ${txHash} on chain ${tx.chainId}`)
    return txHash
  }

  async waitForReceipt(
    txHash: string,
    chainId: number,
  ): Promise<{ status: "success" | "reverted" }> {
    const client = this.getPublicClient(chainId)
    const receipt: TransactionReceipt = await client.waitForTransactionReceipt({
      hash: txHash as Hex,
      timeout: 120_000, // 2 min
    })
    const status = receipt.status === "success" ? "success" : "reverted"
    console.log(`[AgentWallet] Tx ${txHash} status: ${status}`)
    return { status }
  }

  async getErc20Balance(tokenAddress: string, chainId: number): Promise<bigint> {
    const client = this.getPublicClient(chainId)
    const balance = await client.readContract({
      address: tokenAddress as Hex,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [this.address as Hex],
    })
    return balance as bigint
  }

  async getNativeBalance(chainId: number): Promise<bigint> {
    const client = this.getPublicClient(chainId)
    return client.getBalance({ address: this.address as Hex })
  }
}

// ─── Private Key Wallet Adapter ───

const PrivateKeyAdapter: WalletAdapter = {
  type: "private_key",
  createWallet(config: Record<string, unknown>): AgentWallet {
    const pk = config.privateKey as Hex
    if (!pk) throw new Error("privateKey is required")
    return new PrivateKeyAgentWallet(pk)
  },
}

// ─── Adapter Registry ───

const adapters = new Map<string, WalletAdapter>()
adapters.set("private_key", PrivateKeyAdapter)

export function registerWalletAdapter(adapter: WalletAdapter): void {
  adapters.set(adapter.type, adapter)
}

export function getWalletAdapter(type: string): WalletAdapter | undefined {
  return adapters.get(type)
}

// ─── Runtime key storage (background-only) ───

/**
 * Store agent wallet private key in chrome.storage.local.
 * This is only callable from the background service worker context.
 * Content scripts / popup have no handler that exposes this data.
 *
 * ⚠️  DEV/TEST ONLY — stored as plaintext. Not for production or real funds.
 *
 * Validations performed:
 * 1. Format: must be 0x-prefixed, exactly 66 chars (32 bytes)
 * 2. Hex content: must be valid hexadecimal after 0x prefix
 * 3. Address derivation: must produce a valid EVM address
 * 4. Duplicate check: warns if overwriting an existing key
 */
export async function storeAgentWalletKey(privateKey: string): Promise<string> {
  // 1. Format check
  if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
    throw new Error("Invalid private key format. Expected 0x-prefixed 32-byte hex (66 chars total).")
  }

  // 2. Hex content check
  const hexBody = privateKey.slice(2)
  if (!/^[0-9a-fA-F]{64}$/.test(hexBody)) {
    throw new Error("Invalid private key: contains non-hex characters.")
  }

  // 3. Address derivation (will throw if key is invalid for secp256k1)
  let account: ReturnType<typeof privateKeyToAccount>
  try {
    account = privateKeyToAccount(privateKey as Hex)
  } catch (err: any) {
    throw new Error(`Failed to derive address from private key: ${err.message}`)
  }

  if (!account.address || !account.address.startsWith("0x") || account.address.length !== 42) {
    throw new Error("Private key produced an invalid address. Key may be malformed.")
  }

  // 4. Duplicate check
  try {
    const existing = await chrome.storage.local.get(WALLET_STORAGE_KEY)
    const existingPk = existing[WALLET_STORAGE_KEY] as string | undefined
    if (existingPk) {
      const existingAccount = privateKeyToAccount(existingPk as Hex)
      if (existingPk === privateKey) {
        console.warn(`[AgentWallet] Same key already configured (${account.address}), no change needed.`)
        return account.address
      }
      console.warn(
        `[AgentWallet] Overwriting existing wallet ${existingAccount.address} with new wallet ${account.address}`
      )
    }
  } catch {
    // If we can't read existing, proceed with store anyway
  }

  await chrome.storage.local.set({ [WALLET_STORAGE_KEY]: privateKey })
  console.log(`[AgentWallet] Key stored for address: ${account.address}`)
  console.warn("[AgentWallet] Reminder: current storage is plaintext, suitable for dev/test only.")
  return account.address
}

/**
 * Remove the stored agent wallet key.
 */
export async function clearAgentWalletKey(): Promise<void> {
  await chrome.storage.local.remove(WALLET_STORAGE_KEY)
  console.log("[AgentWallet] Stored key cleared")
}

/**
 * Check if a wallet key exists and return its address (for diagnostics).
 * NEVER returns the key itself — only the derived address or null.
 */
export async function getStoredWalletAddress(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(WALLET_STORAGE_KEY)
    const pk = result[WALLET_STORAGE_KEY] as string | undefined
    if (!pk || !pk.startsWith("0x") || pk.length !== 66) return null
    const account = privateKeyToAccount(pk as Hex)
    return account.address
  } catch {
    return null
  }
}

/**
 * Load agent wallet from chrome.storage.local (background-only).
 * Returns null if no key is stored.
 */
export async function loadAgentWalletFromStorage(): Promise<AgentWallet | null> {
  try {
    const result = await chrome.storage.local.get(WALLET_STORAGE_KEY)
    const pk = result[WALLET_STORAGE_KEY] as string | undefined
    if (!pk) return null
    if (!pk.startsWith("0x") || pk.length !== 66) {
      console.error("[AgentWallet] Stored key has invalid format, ignoring")
      return null
    }
    const adapter = adapters.get("private_key")!
    return adapter.createWallet({ privateKey: pk })
  } catch (err: any) {
    console.error(`[AgentWallet] Failed to load from storage: ${err.message}`)
    return null
  }
}
