/**
 * Strategy Executor — Two-step execution (default reliable path)
 *
 * Step 1: Swap spend token → buy token via LI.FI /v1/quote
 * Step 2: Deposit buy token into configured vault via LI.FI /v1/quote
 *
 * Key design decisions:
 * - Records balance before AND after swap; Step 2 uses the delta only
 * - Agent wallet signs all txs (not user's main wallet)
 * - One-step contractCalls path is stubbed for future upgrade
 */

import type { AgentWallet, Strategy, ExecutionResult } from "./types"
import { createLogger } from "~lib/logger"
import {
  LIFI_API_BASE,
  PROXY_TOKEN,
  resolveTokenAddress,
  getTokenDecimals,
  toRawAmount,
} from "./config"
const logger = createLogger("StrategyExecutor")

// ─── LI.FI Headers ───

function lifiHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" }
  if (PROXY_TOKEN) h["x-cb-token"] = PROXY_TOKEN
  return h
}

// ─── LI.FI Quote ───

async function getQuote(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString()
  const url = `${LIFI_API_BASE}/quote?${qs}`
  logger.info("Requesting LI.FI quote", { url })

  const res = await fetch(url, {
    headers: lifiHeaders(),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json()

  if (data.message || data.error) {
    throw new Error(`LI.FI quote error: ${data.message || data.error}`)
  }
  if (!data.transactionRequest) {
    throw new Error("LI.FI quote returned no transactionRequest")
  }
  return data
}

// ─── ERC-20 Approve Helper ───

function buildApproveCalldata(spender: string, amount: string): string {
  const spenderHex = spender.replace("0x", "").padStart(64, "0")
  // Max approval to avoid precision issues
  const amountHex = "f".repeat(64)
  return "0x095ea7b3" + spenderHex + amountHex
}

// ─── Two-Step Executor ───

export async function executeTwoStep(
  strategy: Strategy,
  wallet: AgentWallet,
): Promise<ExecutionResult> {
  const result: ExecutionResult = {}

  // ── Resolve addresses ──
  const spendTokenAddr = resolveTokenAddress(strategy.spendToken, strategy.spendChainId)
  if (!spendTokenAddr) {
    return { error: `No address for ${strategy.spendToken} on chain ${strategy.spendChainId}`, failedAt: "pre_check" }
  }

  const buyTokenAddr = resolveTokenAddress(strategy.buyToken, strategy.targetChainId)
  if (!buyTokenAddr) {
    return { error: `No address for ${strategy.buyToken} on chain ${strategy.targetChainId}`, failedAt: "pre_check" }
  }

  const spendDecimals = getTokenDecimals(strategy.spendToken)
  const rawSpendAmount = toRawAmount(strategy.spendAmount, spendDecimals)

  // ── Pre-check: sufficient balance ──
  try {
    const spendBalance = await wallet.getErc20Balance(spendTokenAddr, strategy.spendChainId)
    if (spendBalance < BigInt(rawSpendAmount)) {
      return {
        error: `Insufficient ${strategy.spendToken} balance: have ${spendBalance}, need ${rawSpendAmount}`,
        failedAt: "pre_check",
      }
    }

    const nativeBalance = await wallet.getNativeBalance(strategy.spendChainId)
    // Rough gas check: require at least 0.001 ETH equivalent
    const minGas = BigInt("1000000000000000") // 0.001 ETH
    if (nativeBalance < minGas) {
      return {
        error: `Insufficient native gas: have ${nativeBalance}, need at least ${minGas}`,
        failedAt: "pre_check",
      }
    }
  } catch (err: any) {
    logger.warn("Balance pre-check failed", { message: err.message })
    // Non-blocking: proceed anyway, tx will revert if truly insufficient
  }

  // ══════════════════════════════════════════════════════════
  // STEP 1: Swap spend token → buy token
  // ══════════════════════════════════════════════════════════

  logger.info("Executing step 1", { spendAmount: strategy.spendAmount, spendToken: strategy.spendToken, buyToken: strategy.buyToken })

  // Record buy token balance BEFORE swap
  let balanceBefore: bigint
  try {
    balanceBefore = await wallet.getErc20Balance(buyTokenAddr, strategy.targetChainId)
  } catch {
    balanceBefore = 0n
  }

  // Get LI.FI quote for swap
  let swapQuote: any
  try {
    swapQuote = await getQuote({
      fromChain: String(strategy.spendChainId),
      toChain: String(strategy.targetChainId),
      fromToken: spendTokenAddr,
      toToken: buyTokenAddr,
      fromAddress: wallet.address,
      toAddress: wallet.address,
      fromAmount: rawSpendAmount,
    })
  } catch (err: any) {
    return { error: `Step 1 quote failed: ${err.message}`, failedAt: "quote" }
  }

  const swapTxReq = swapQuote.transactionRequest

  // Approve spend token if needed (ERC-20, not native)
  const isNative = spendTokenAddr === "0x0000000000000000000000000000000000000000"
  if (!isNative) {
    try {
      logger.info("Approving spend token", { token: strategy.spendToken, spender: swapTxReq.to })
      const approveTxHash = await wallet.signAndSendTransaction({
        to: spendTokenAddr,
        data: buildApproveCalldata(swapTxReq.to, rawSpendAmount),
        value: "0",
        chainId: strategy.spendChainId,
      })
      const approveReceipt = await wallet.waitForReceipt(approveTxHash, strategy.spendChainId)
      if (approveReceipt.status !== "success") {
        return { error: "Approve tx reverted", failedAt: "step1" }
      }
      logger.info("Approve confirmed", { txHash: approveTxHash })
    } catch (err: any) {
      return { error: `Approve failed: ${err.message}`, failedAt: "step1" }
    }
  }

  // Execute swap
  let swapTxHash: string
  try {
    swapTxHash = await wallet.signAndSendTransaction({
      to: swapTxReq.to,
      data: swapTxReq.data,
      value: swapTxReq.value || "0",
      chainId: strategy.spendChainId,
      gasLimit: swapTxReq.gasLimit,
    })

    const swapReceipt = await wallet.waitForReceipt(swapTxHash, strategy.spendChainId)
    if (swapReceipt.status !== "success") {
      return { error: `Swap tx reverted: ${swapTxHash}`, failedAt: "step1" }
    }
  } catch (err: any) {
    return { error: `Step 1 tx failed: ${err.message}`, failedAt: "step1" }
  }

  // Record buy token balance AFTER swap
  let balanceAfter: bigint
  try {
    // Small delay to allow RPC state to update
    await new Promise(r => setTimeout(r, 2000))
    balanceAfter = await wallet.getErc20Balance(buyTokenAddr, strategy.targetChainId)
  } catch {
    balanceAfter = balanceBefore // worst case: can't measure delta
  }

  const balanceDelta = balanceAfter - balanceBefore

  result.step1 = {
    txHash: swapTxHash,
    balanceBefore: balanceBefore.toString(),
    balanceAfter: balanceAfter.toString(),
    balanceDelta: balanceDelta.toString(),
    timestamp: Date.now(),
  }

  logger.info("Step 1 completed", { balanceDelta: balanceDelta.toString(), balanceBefore: balanceBefore.toString(), balanceAfter: balanceAfter.toString() })

  if (balanceDelta <= 0n) {
    return {
      ...result,
      error: "Step 1 completed but balance delta is zero or negative",
      failedAt: "step1",
    }
  }

  // ── Skip Step 2 if postAction is "none" (buy-only strategy) ──
  if (strategy.postAction.type === "none" || !strategy.postAction.vaultAddress) {
    logger.info("Skipping step 2 due to postAction", { postAction: strategy.postAction.type })
    return result
  }

  // ══════════════════════════════════════════════════════════
  // STEP 2: Deposit buy token into vault
  // ══════════════════════════════════════════════════════════

  logger.info("Executing step 2", { balanceDelta: balanceDelta.toString(), buyToken: strategy.buyToken, vaultAddress: strategy.postAction.vaultAddress })

  // Get LI.FI quote for deposit (buy token → vault token)
  let depositQuote: any
  try {
    depositQuote = await getQuote({
      fromChain: String(strategy.targetChainId),
      toChain: String(strategy.postAction.vaultChainId),
      fromToken: buyTokenAddr,
      toToken: strategy.postAction.vaultAddress, // vault address as toToken for LI.FI deposit
      fromAddress: wallet.address,
      toAddress: wallet.address,
      fromAmount: balanceDelta.toString(),
    })
  } catch (err: any) {
    return {
      ...result,
      error: `Step 2 quote failed: ${err.message}`,
      failedAt: "step2",
    }
  }

  const depositTxReq = depositQuote.transactionRequest

  // Approve buy token for deposit if needed
  try {
    logger.info("Approving buy token for deposit", { token: strategy.buyToken, spender: depositTxReq.to })
    const approveTxHash = await wallet.signAndSendTransaction({
      to: buyTokenAddr,
      data: buildApproveCalldata(depositTxReq.to, balanceDelta.toString()),
      value: "0",
      chainId: strategy.targetChainId,
    })
    const approveReceipt = await wallet.waitForReceipt(approveTxHash, strategy.targetChainId)
    if (approveReceipt.status !== "success") {
      return { ...result, error: "Step 2 approve tx reverted", failedAt: "step2" }
    }
    logger.info("Step 2 approve confirmed", { txHash: approveTxHash })
  } catch (err: any) {
    return { ...result, error: `Step 2 approve failed: ${err.message}`, failedAt: "step2" }
  }

  // Execute deposit
  let depositTxHash: string
  try {
    depositTxHash = await wallet.signAndSendTransaction({
      to: depositTxReq.to,
      data: depositTxReq.data,
      value: depositTxReq.value || "0",
      chainId: strategy.postAction.vaultChainId,
      gasLimit: depositTxReq.gasLimit,
    })

    const depositReceipt = await wallet.waitForReceipt(depositTxHash, strategy.postAction.vaultChainId)
    if (depositReceipt.status !== "success") {
      return { ...result, error: `Deposit tx reverted: ${depositTxHash}`, failedAt: "step2" }
    }
  } catch (err: any) {
    return { ...result, error: `Step 2 tx failed: ${err.message}`, failedAt: "step2" }
  }

  result.step2 = {
    txHash: depositTxHash,
    depositAmount: balanceDelta.toString(),
    timestamp: Date.now(),
  }

  logger.info("Step 2 completed", { txHash: depositTxHash })
  return result
}

// ─── One-Step Executor (future: LI.FI /v1/quote/contractCalls) ───

/**
 * Placeholder for one-step execution via LI.FI contractCalls.
 * This combines swap + deposit into a single atomic tx.
 * NOT used in MVP — here as an upgrade entry point.
 */
export async function executeOneStep(
  _strategy: Strategy,
  _wallet: AgentWallet,
): Promise<ExecutionResult> {
  // TODO: Implement using LI.FI /v1/quote/contractCalls
  // - Build contractCalls payload with deposit action
  // - Submit single tx that does swap + deposit atomically
  // - This is the "beta path" — only enable after two-step is stable
  return {
    error: "One-step execution not implemented yet. Use two-step path.",
    failedAt: "pre_check",
  }
}
