import test, { afterEach } from "node:test"
import assert from "node:assert/strict"

import type { HandlerContext } from "../handlers/types.ts"
import type { AgentTool, ToolResult } from "./types.ts"
import {
  clearPendingAgentSession,
  getPendingAgentSession,
} from "./state.ts"
import {
  resumePendingReActRuntime,
  runReActRuntime,
  type AgentRuntimeDependencies,
} from "./runtime.ts"

function ok(toolName: string, data: Record<string, unknown>): ToolResult {
  return {
    ok: true,
    toolName,
    data,
    error: null,
    meta: {
      durationMs: 0,
      timestamp: new Date().toISOString(),
    },
  }
}

function makeCtx() {
  const responses: any[] = []
  const progress: string[] = []
  const history: Array<{ role: "user" | "model"; text: string }> = []

  const ctx = {
    lang: "en",
    tabId: 1,
    userText: "",
    walletAddress: "0xabc",
    pushHistory: (role: "user" | "model", text: string) => {
      history.push({ role, text })
    },
    sendProgress: (_tabId: number | undefined, text: string) => {
      progress.push(text)
    },
    sendResponse: (payload: any) => {
      responses.push(payload)
    },
    pendingDepositDraft: { selectedVault: null, vaultChoices: [], investParams: null, walletAddress: null },
    ensurePortfolioSnapshot: async () => [],
    cacheVaultChoices: () => undefined,
    resolveVaultForWithdraw: async () => ({ vault: null }),
    getPendingBridgeAfterWithdraw: () => null,
    setPendingBridgeAfterWithdraw: () => undefined,
    getPendingStrategyDraft: () => null,
    setPendingStrategyDraft: () => undefined,
    getEngine: () => null,
    clearPending: () => undefined,
    legacy: async () => false,
  } satisfies HandlerContext

  return { ctx, responses, progress, history }
}

function buildDeps(
  responses: string[],
  options?: { captureBuildDepositInputs?: Array<Record<string, unknown>> },
): AgentRuntimeDependencies {
  const tools: Record<string, AgentTool> = {
    search_vaults: {
      name: "search_vaults",
      description: "search vaults",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
      safety: { readOnly: true },
      run: async () => ok("search_vaults", {
        vault: { address: "0xvault", chainId: 8453, protocol: { name: "Aave" } },
        vaultAddress: "0xvault",
        vaultChainId: 8453,
        apy: 5.2,
        protocol: "Aave",
      }),
    },
    build_deposit: {
      name: "build_deposit",
      description: "build deposit",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
      safety: { requiresWallet: true, buildsTransaction: true, requiresConfirm: true },
      run: async (input) => {
        options?.captureBuildDepositInputs?.push({ ...input })
        return ok("build_deposit", {
          txPayload: { to: "0xdeposit", data: "0x123" },
        })
      },
    },
  }

  return {
    toolRegistry: {
      getTool: (name: string) => tools[name as keyof typeof tools],
      listTools: () => Object.values(tools).map((tool) => ({
        name: tool.name,
        description: tool.description,
        requiresConfirm: tool.safety.requiresConfirm,
        inputSchema: tool.inputSchema,
      })),
    },
    callModel: async () => {
      const next = responses.shift()
      if (!next) throw new Error("missing mock model response")
      return next
    },
    maxSteps: 3,
  }
}

afterEach(() => {
  clearPendingAgentSession()
})

test("runReActRuntime executes a tool call and returns the final answer", async () => {
  const { ctx, responses, history } = makeCtx()
  const deps = buildDeps([
    JSON.stringify({ type: "tool_call", tool: "search_vaults", args: { chainIds: [8453], asset: "USDC" } }),
    JSON.stringify({ type: "final_answer", reply: "Best vault found." }),
  ])

  const handled = await runReActRuntime({
    userText: "find best USDC vault on Base",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(handled, true)
  assert.equal(responses.length, 1)
  assert.equal(responses[0].reply, "Best vault found.")
  assert.equal(getPendingAgentSession(), null)
  assert.ok(history.some((entry) => entry.role === "user"))
})

test("runReActRuntime pauses on requiresConfirm tool calls", async () => {
  const { ctx, responses } = makeCtx()
  const deps = buildDeps([
    JSON.stringify({ type: "tool_call", tool: "build_deposit", args: { amount: "1000000", asset: "USDC" } }),
  ])

  const handled = await runReActRuntime({
    userText: "deposit 1 USDC",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(handled, true)
  assert.equal(responses.length, 1)
  assert.match(responses[0].reply, /deposit transaction/i)
  assert.match(responses[0].reply, /confirm/i)
  const pending = getPendingAgentSession()
  assert.ok(pending)
  assert.equal(pending?.pendingToolCall?.toolName, "build_deposit")
})

test("runReActRuntime can search first and keep a resumable confirmation pending state", async () => {
  const { ctx, responses } = makeCtx()
  const capturedBuildDepositInputs: Array<Record<string, unknown>> = []
  const deps = buildDeps([
    JSON.stringify({ type: "tool_call", tool: "search_vaults", args: { chainId: 8453 } }),
    JSON.stringify({
      type: "final_answer",
      reply: "The best vault for USDC on Base is the yo-protocol USDC vault. Would you like me to build a deposit transaction for 1 USDC?",
      keep_session: true,
      pending_tool_call: {
        tool: "build_deposit",
        args: {
          vaultAddress: "$step_1.vaultAddress",
          vaultChainId: "$step_1.vaultChainId",
        },
      },
    }),
    JSON.stringify({ type: "final_answer", reply: "Deposit ready." }),
  ], {
    captureBuildDepositInputs: capturedBuildDepositInputs,
  })

  const handled = await runReActRuntime({
    userText: "find the best vault on Base and deposit 1 USDC",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(handled, true)
  assert.equal(responses.length, 1)
  assert.match(responses[0].reply, /build a deposit transaction/i)
  const pending = getPendingAgentSession()
  assert.ok(pending)
  assert.equal(pending?.pendingToolCall?.toolName, "build_deposit")
  assert.equal(pending?.pendingToolCall?.args.vaultAddress, "0xvault")
  assert.equal(pending?.pendingToolCall?.args.vaultChainId, 8453)

  responses.length = 0

  const resumed = await resumePendingReActRuntime({
    userText: "confirm",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(resumed, true)
  assert.equal(responses.length, 1)
  assert.equal(responses[0].reply, "Deposit ready.")
  assert.equal(responses[0].transactionPayload?.to, "0xdeposit")
  assert.equal(capturedBuildDepositInputs.length, 1)
  assert.equal(capturedBuildDepositInputs[0].fromChain, 8453)
  assert.equal(capturedBuildDepositInputs[0].rawAmount, "1000000")
  assert.ok(capturedBuildDepositInputs[0].vaultAddress)
  assert.equal(getPendingAgentSession(), null)
})

test("runReActRuntime backfills pending build_deposit args from the pending draft", async () => {
  const { ctx, responses } = makeCtx()
  ctx.pendingDepositDraft.investParams = {
    amount: "1",
    amountDecimals: "000000",
    searchAsset: "USDC",
    fromChain: 8453,
    toChainConfig: [8453],
  }
  ctx.pendingDepositDraft.selectedVault = {
    address: "0xvault",
    chainId: 8453,
    name: "USDC Vault",
    protocol: { name: "Aave", url: null },
    analytics: { apy: { base: 5.2, reward: 0, total: 5.2 }, tvl: { usd: 1000000 } },
    underlyingTokens: [{ address: "0xusdc", symbol: "USDC", decimals: 6 }],
    tags: [],
    isTransactional: true,
    isRedeemable: true,
  } as any
  ctx.pendingDepositDraft.vaultChoices = [ctx.pendingDepositDraft.selectedVault]

  const deps = buildDeps([
    JSON.stringify({
      type: "final_answer",
      reply: "I found the best vault. Would you like me to build the deposit transaction now?",
      keep_session: true,
      pending_tool_call: {
        tool: "build_deposit",
        args: {
          asset: "USDC",
        },
      },
    }),
    JSON.stringify({ type: "final_answer", reply: "Deposit ready." }),
  ])

  const handled = await runReActRuntime({
    userText: "deposit 1 USDC into the best Base vault",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(handled, true)
  const pending = getPendingAgentSession()
  assert.ok(pending)
  assert.equal(pending?.pendingToolCall?.toolName, "build_deposit")
  assert.equal(pending?.pendingToolCall?.args.fromChain, 8453)
  assert.equal(pending?.pendingToolCall?.args.rawAmount, "1000000")
  assert.equal(pending?.pendingToolCall?.args.vaultAddress, "0xvault")
  assert.equal(pending?.pendingToolCall?.args.vaultChainId, 8453)

  responses.length = 0

  const resumed = await resumePendingReActRuntime({
    userText: "confirm",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(resumed, true)
  assert.equal(responses.length, 1)
  assert.equal(responses[0].reply, "Deposit ready.")
  assert.equal(responses[0].transactionPayload?.to, "0xdeposit")
})

test("resumePendingReActRuntime executes the pending tool after confirm", async () => {
  const { ctx, responses } = makeCtx()
  const deps = buildDeps([
    JSON.stringify({ type: "tool_call", tool: "build_deposit", args: { amount: "1000000", asset: "USDC" } }),
    JSON.stringify({ type: "final_answer", reply: "Deposit ready." }),
  ])

  await runReActRuntime({
    userText: "deposit 1 USDC",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  responses.length = 0

  const resumed = await resumePendingReActRuntime({
    userText: "confirm",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(resumed, true)
  assert.equal(responses.length, 1)
  assert.equal(responses[0].reply, "Deposit ready.")
  assert.equal(responses[0].transactionPayload?.to, "0xdeposit")
  assert.equal(getPendingAgentSession(), null)
})

test("resumePendingReActRuntime hydrates missing build_deposit args from the draft", async () => {
  const { ctx, responses } = makeCtx()
  const vault = {
    address: "0xvault",
    chainId: 8453,
    name: "vault",
    protocol: { name: "Aave" },
  }
  ctx.pendingDepositDraft = {
    selectedVault: vault as any,
    vaultChoices: [vault as any],
    investParams: {
      amount: "1",
      amountDecimals: "000000",
      fromChain: 8453,
      toChainConfig: [8453],
      searchAsset: "USDC",
    },
    walletAddress: "0xabc",
  }
  const deps = buildDeps([
    JSON.stringify({
      type: "final_answer",
      reply: "Would you like me to build a deposit transaction for 1 USDC?",
      keep_session: true,
      pending_tool_call: {
        tool: "build_deposit",
        args: { asset: "USDC" },
      },
    }),
    JSON.stringify({ type: "final_answer", reply: "Deposit ready." }),
  ])

  await runReActRuntime({
    userText: "find the best vault and deposit 1 USDC",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  responses.length = 0
  ctx.walletAddress = "0xabc"

  const resumed = await resumePendingReActRuntime({
    userText: "confirm",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(resumed, true)
  assert.equal(responses.length, 1)
  assert.equal(responses[0].reply, "Deposit ready.")
  assert.equal(responses[0].transactionPayload?.to, "0xdeposit")
  assert.equal(getPendingAgentSession(), null)
})

test("runReActRuntime rejects unknown tools", async () => {
  const { ctx, responses } = makeCtx()
  const deps = buildDeps([
    JSON.stringify({ type: "tool_call", tool: "does_not_exist", args: {} }),
  ])

  await runReActRuntime({
    userText: "do something impossible",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(responses.length, 1)
  assert.match(responses[0].reply, /can't find that tool/i)
  assert.equal(getPendingAgentSession(), null)
})

test("runReActRuntime stops at max step budget", async () => {
  const { ctx, responses } = makeCtx()
  const deps = buildDeps([
    JSON.stringify({ type: "tool_call", tool: "search_vaults", args: { chainIds: [8453], asset: "USDC" } }),
    JSON.stringify({ type: "tool_call", tool: "search_vaults", args: { chainIds: [8453], asset: "USDC" } }),
    JSON.stringify({ type: "tool_call", tool: "search_vaults", args: { chainIds: [8453], asset: "USDC" } }),
  ])

  await runReActRuntime({
    userText: "keep searching",
    lang: "en",
    conversationHistory: [],
    ctx,
  }, deps)

  assert.equal(responses.length, 1)
  assert.match(responses[0].reply, /step budget is exhausted/i)
  assert.equal(getPendingAgentSession(), null)
})
