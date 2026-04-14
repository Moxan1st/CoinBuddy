import test from "node:test"
import assert from "node:assert/strict"

import { extractQuoteSummary, formatQuoteSummary } from "./quote-formatter.ts"

test("extractQuoteSummary normalizes amounts, names, and fees", () => {
  const summary = extractQuoteSummary(
    {
      action: { fromChainId: 1, toChainId: 8453 },
      estimate: {
        fromAmount: "1250000",
        toAmount: "1240000",
        toAmountMin: "1235000",
        fromToken: { symbol: "USDC", decimals: 6 },
        toToken: { symbol: "USDC", decimals: 6 },
        gasCosts: [{ amountUSD: "2.15" }, { amountUSD: "0.35" }],
        feeCosts: [{ amountUSD: "0.5" }],
        executionDuration: 95,
        approvalAddress: "0xapprove",
      },
      toolDetails: { name: "lifi" },
    },
    "bridge",
  )

  assert.deepEqual(
    {
      fromChainName: summary.fromChainName,
      toChainName: summary.toChainName,
      fromToken: summary.fromToken,
      toToken: summary.toToken,
      fromAmount: summary.fromAmount,
      toAmount: summary.toAmount,
      toAmountMin: summary.toAmountMin,
      gasCostUSD: summary.gasCostUSD,
      feeCostUSD: summary.feeCostUSD,
      toolName: summary.toolName,
      approvalAddress: summary.approvalAddress,
    },
    {
      fromChainName: "Ethereum",
      toChainName: "Base",
      fromToken: "USDC",
      toToken: "USDC",
      fromAmount: 1.25,
      toAmount: 1.24,
      toAmountMin: 1.235,
      gasCostUSD: 2.5,
      feeCostUSD: 0.5,
      toolName: "lifi",
      approvalAddress: "0xapprove",
    },
  )
})

test("formatQuoteSummary renders localized output", () => {
  const output = formatQuoteSummary(
    {
      action: "bridge",
      fromChain: 1,
      toChain: 8453,
      fromChainName: "Ethereum",
      toChainName: "Base",
      fromToken: "USDC",
      toToken: "USDC",
      fromAmount: 1.25,
      toAmount: 1.24,
      toAmountMin: 1.23,
      gasCostUSD: 2.5,
      feeCostUSD: 0.5,
      toolName: "lifi",
      executionDuration: 95,
      approvalAddress: "0xapprove",
    },
    "en",
  )

  assert.match(output, /Expected: 1\.240000 USDC/)
  assert.match(output, /Fee: ~\$0\.50 \(total ~\$3\.00\)/)
  assert.match(output, /Est\. time: ~2 min/)
  assert.match(output, /Route: lifi/)
})
