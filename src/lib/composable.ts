/**
 * ERC-8211 Smart Batching — Type Definitions & Encoder
 *
 * This module implements the composable execution encoding defined by ERC-8211.
 * It converts LI.FI transaction quotes into ComposableExecution[] arrays with
 * runtime parameter injection and constraint-based slippage protection.
 *
 * Current execution: EIP-5792 wallet_sendCalls (Coinbase Smart Wallet native support)
 * Future execution: IComposableExecution.executeComposable() when wallets adopt ERC-8211
 */

import { encodeFunctionData, encodeAbiParameters, parseAbiParameters, type Hex } from "viem"

// ─── ERC-8211 Enums ──────────────────────────────────────────────

export enum InputParamType {
  CALL_DATA = 0,
  TARGET = 1,
  VALUE = 2,
}

export enum InputParamFetcherType {
  RAW_BYTES = 0,
  STATIC_CALL = 1,
  CAPTURED_RETURN_VALUE = 2,
  BALANCE = 3,
}

export enum OutputParamFetcherType {
  RETURN_VALUE = 0,
}

export enum ConstraintType {
  EQ = 0,
  GTE = 1,
  LTE = 2,
  NEQ = 3,
}

// ─── ERC-8211 Structs ─────────────────────────────────────────────

export interface Constraint {
  constraintType: ConstraintType
  referenceValue: bigint
}

export interface InputParam {
  paramType: InputParamType
  fetcherType: InputParamFetcherType
  paramData: Hex // abi-encoded fetcher-specific data
  constraints: Constraint[]
}

export interface OutputParam {
  fetcherType: OutputParamFetcherType
  paramData: Hex // slot index for Storage contract (uint256 encoded)
}

export interface ComposableExecution {
  target: Hex        // address
  value: bigint      // uint256
  functionSig: Hex   // bytes4
  inputParams: InputParam[]
  outputParams: OutputParam[]
}

// ─── IComposableExecution ABI ─────────────────────────────────────

export const COMPOSABLE_EXECUTION_ABI = [
  {
    name: "executeComposable",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "executions",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "functionSig", type: "bytes4" },
          {
            name: "inputParams",
            type: "tuple[]",
            components: [
              { name: "paramType", type: "uint8" },
              { name: "fetcherType", type: "uint8" },
              { name: "paramData", type: "bytes" },
              {
                name: "constraints",
                type: "tuple[]",
                components: [
                  { name: "constraintType", type: "uint8" },
                  { name: "referenceValue", type: "uint256" },
                ],
              },
            ],
          },
          {
            name: "outputParams",
            type: "tuple[]",
            components: [
              { name: "fetcherType", type: "uint8" },
              { name: "paramData", type: "bytes" },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
] as const

// ─── EIP-5792 Batch Call (practical execution path) ───────────────

export interface BatchCall {
  to: Hex
  data: Hex
  value: bigint
}

/**
 * Convert LI.FI transactionRequest objects into an EIP-5792 calls array.
 * This is the practical execution path — Coinbase Smart Wallet supports this natively.
 */
export function toBatchCalls(
  txRequests: Array<{ to: string; data?: string; value?: string | number | bigint }>
): BatchCall[] {
  return txRequests.map((tx) => ({
    to: tx.to as Hex,
    data: (tx.data || "0x") as Hex,
    value: tx.value ? BigInt(tx.value) : 0n,
  }))
}

// ─── ERC-8211 Encoding (future-ready) ─────────────────────────────

/**
 * Build a ComposableExecution for a simple call (all params are RAW_BYTES).
 * Used when we have a fully-formed transactionRequest from LI.FI.
 */
export function txToComposableExecution(tx: {
  to: string
  data?: string
  value?: string | number | bigint
}): ComposableExecution {
  const data = (tx.data || "0x") as Hex
  const functionSig = (data.length >= 10 ? data.slice(0, 10) : "0x00000000") as Hex
  const calldata = data.length > 10 ? (`0x${data.slice(10)}` as Hex) : ("0x" as Hex)

  const inputParams: InputParam[] = []

  // TARGET param
  inputParams.push({
    paramType: InputParamType.TARGET,
    fetcherType: InputParamFetcherType.RAW_BYTES,
    paramData: encodeAbiParameters(parseAbiParameters("address"), [tx.to as Hex]),
    constraints: [],
  })

  // VALUE param (if non-zero)
  const value = tx.value ? BigInt(tx.value) : 0n
  if (value > 0n) {
    inputParams.push({
      paramType: InputParamType.VALUE,
      fetcherType: InputParamFetcherType.RAW_BYTES,
      paramData: encodeAbiParameters(parseAbiParameters("uint256"), [value]),
      constraints: [],
    })
  }

  // CALL_DATA — the remaining calldata bytes as a single raw param
  if (calldata !== "0x") {
    inputParams.push({
      paramType: InputParamType.CALL_DATA,
      fetcherType: InputParamFetcherType.RAW_BYTES,
      paramData: calldata,
      constraints: [],
    })
  }

  return {
    target: tx.to as Hex,
    value,
    functionSig,
    inputParams,
    outputParams: [],
  }
}

/**
 * Build a swap-then-deposit ComposableExecution[] with:
 * - Step 1 (swap): captures output amount via OutputParam
 * - Step 2 (deposit): injects captured amount via CAPTURED_RETURN_VALUE
 * - Constraint on step 2: GTE minOutputAmount (slippage protection)
 *
 * NOTE: This is the full ERC-8211 encoding for demonstration.
 * Actual execution currently uses EIP-5792 batch calls.
 */
export function buildSwapThenDepositComposable(
  swapTx: { to: string; data?: string; value?: string | number | bigint },
  depositTx: { to: string; data?: string; value?: string | number | bigint },
  minSwapOutput: bigint,
  storageSlot: bigint = 0n
): ComposableExecution[] {
  // Step 1: Swap — capture return value (output token amount)
  const swapExec = txToComposableExecution(swapTx)
  swapExec.outputParams = [
    {
      fetcherType: OutputParamFetcherType.RETURN_VALUE,
      paramData: encodeAbiParameters(parseAbiParameters("uint256"), [storageSlot]),
    },
  ]

  // Step 2: Deposit — use captured value from step 1 as amount
  const depositExec = txToComposableExecution(depositTx)

  // Replace the amount CALL_DATA param with a CAPTURED_RETURN_VALUE fetcher
  // and add a GTE constraint for slippage protection
  const capturedAmountParam: InputParam = {
    paramType: InputParamType.CALL_DATA,
    fetcherType: InputParamFetcherType.CAPTURED_RETURN_VALUE,
    paramData: encodeAbiParameters(parseAbiParameters("uint256"), [storageSlot]),
    constraints: [
      {
        constraintType: ConstraintType.GTE,
        referenceValue: minSwapOutput,
      },
    ],
  }

  // Insert the captured amount param (keeping other params)
  depositExec.inputParams.push(capturedAmountParam)

  return [swapExec, depositExec]
}

/**
 * Encode a ComposableExecution[] array into executeComposable() calldata.
 * This is the full ERC-8211 wire format for when wallets support it natively.
 */
export function encodeExecuteComposable(executions: ComposableExecution[]): Hex {
  return encodeFunctionData({
    abi: COMPOSABLE_EXECUTION_ABI,
    functionName: "executeComposable",
    args: [
      executions.map((e) => ({
        target: e.target,
        value: e.value,
        functionSig: e.functionSig,
        inputParams: e.inputParams.map((ip) => ({
          paramType: ip.paramType,
          fetcherType: ip.fetcherType,
          paramData: ip.paramData,
          constraints: ip.constraints.map((c) => ({
            constraintType: c.constraintType,
            referenceValue: c.referenceValue,
          })),
        })),
        outputParams: e.outputParams.map((op) => ({
          fetcherType: op.fetcherType,
          paramData: op.paramData,
        })),
      })),
    ],
  })
}

/**
 * Generate a human-readable summary of a composable batch.
 */
export function describeBatch(
  steps: Array<{ action: string; description: string }>,
  lang: "zh" | "en" = "en"
): string {
  const header = lang === "zh"
    ? `\u26A1 Smart Batch\uFF08${steps.length} \u6B65\u539F\u5B50\u6267\u884C\uFF09\uFF1A`
    : `\u26A1 Smart Batch (${steps.length} atomic steps):`
  const lines = steps.map(
    (s, i) => `  ${i + 1}. ${s.description}`
  )
  const footer = lang === "zh"
    ? "\n\u26A0 \u6240\u6709\u6B65\u9AA4\u539F\u5B50\u6267\u884C\uFF0C\u4EFB\u4E00\u5931\u8D25\u5168\u90E8\u56DE\u6EDA\u3002"
    : "\n\u26A0 All steps execute atomically \u2014 if any fails, everything reverts."
  return `${header}\n${lines.join("\n")}${footer}`
}
