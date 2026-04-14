import { isValidEvmAddress } from "./withdraw-context.ts"
import type { PortfolioPositionSummary } from "./session-cache.ts"

type JsonRecord = Record<string, any>

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
  }
  return null
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function pickAddress(...values: unknown[]): string | null {
  for (const value of values) {
    if (isValidEvmAddress(value)) return value
  }
  return null
}

function pickChainId(...values: unknown[]): number | null {
  const chainId = pickNumber(...values)
  return chainId && chainId > 0 ? chainId : null
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const segment of path.split(".")) {
    if (!isRecord(current) && !Array.isArray(current)) return null
    current = (current as any)?.[segment]
  }
  return current
}

function pickFromPaths<T>(
  source: unknown,
  paths: string[],
  picker: (...values: unknown[]) => T | null,
): T | null {
  return picker(...paths.map((path) => readPath(source, path)))
}

function findNestedRecord(
  source: unknown,
  predicate: (value: JsonRecord, path: string[]) => boolean,
  path: string[] = [],
  seen = new Set<unknown>(),
): JsonRecord | null {
  if (!isRecord(source) || seen.has(source)) return null
  seen.add(source)

  if (predicate(source, path)) return source

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const found = findNestedRecord(value[i], predicate, path.concat(key, String(i)), seen)
        if (found) return found
      }
      continue
    }

    const found = findNestedRecord(value, predicate, path.concat(key), seen)
    if (found) return found
  }

  return null
}

function isVaultLikeRecord(value: JsonRecord, path: string[]): boolean {
  const address = value.address
  if (!isValidEvmAddress(address)) return false

  const pathHintsVault = path.some((segment) => segment.toLowerCase().includes("vault"))
  const hasVaultShape =
    pickChainId(value.chainId, value.chain?.id) !== null ||
    pickString(value.protocolName, value.protocol?.name) !== null ||
    Array.isArray(value.underlyingTokens) ||
    Array.isArray(value.assets)

  return pathHintsVault || hasVaultShape
}

function findVaultLikeRecord(position: unknown): JsonRecord | null {
  return findNestedRecord(position, isVaultLikeRecord)
}

function extractReliableProtocolName(position: unknown, inferredVault: JsonRecord | null): string | null {
  const nestedProtocolName = pickString(
    pickFromPaths(position, [
      "protocolName",
      "protocol.name",
      "protocol.displayName",
      "vault.protocol.name",
      "position.protocolName",
      "position.vault.protocol.name",
      "earnPosition.protocolName",
      "earnPosition.vault.protocol.name",
      "portfolioPosition.protocolName",
      "portfolioPosition.vault.protocol.name",
      "data.protocolName",
      "data.vault.protocol.name",
      "details.protocolName",
      "details.vault.protocol.name",
    ], pickString),
    inferredVault?.protocol?.name,
    inferredVault?.protocolName,
  )

  if (nestedProtocolName) return nestedProtocolName

  const hasReliableVaultRef = pickAddress(
    pickFromPaths(position, [
      "vaultAddress",
      "vault.address",
      "position.vaultAddress",
      "position.vault.address",
      "earnPosition.vaultAddress",
      "earnPosition.vault.address",
      "portfolioPosition.vaultAddress",
      "portfolioPosition.vault.address",
      "data.vaultAddress",
      "data.vault.address",
      "details.vaultAddress",
      "details.vault.address",
    ], pickAddress),
    inferredVault?.address,
  )

  if (!hasReliableVaultRef) return null

  return pickString(
    pickFromPaths(position, [
      "protocolName",
      "protocol.name",
      "protocol.displayName",
      "position.protocolName",
      "position.protocol.name",
      "earnPosition.protocolName",
      "earnPosition.protocol.name",
      "portfolioPosition.protocolName",
      "portfolioPosition.protocol.name",
      "data.protocolName",
      "data.protocol.name",
      "details.protocolName",
      "details.protocol.name",
    ], pickString),
  )
}

export function normalizePortfolioPosition(position: any): PortfolioPositionSummary {
  const inferredVault = findVaultLikeRecord(position)

  return {
    vaultAddress: pickAddress(
      pickFromPaths(position, [
        "vaultAddress",
        "vault.address",
        "position.vaultAddress",
        "position.vault.address",
        "earnPosition.vaultAddress",
        "earnPosition.vault.address",
        "portfolioPosition.vaultAddress",
        "portfolioPosition.vault.address",
        "data.vaultAddress",
        "data.vault.address",
        "details.vaultAddress",
        "details.vault.address",
      ], pickAddress),
      inferredVault?.address,
    ),
    vaultChainId: pickChainId(
      pickFromPaths(position, [
        "vaultChainId",
        "chainId",
        "chain.id",
        "vault.chainId",
        "vault.chain.id",
        "position.vaultChainId",
        "position.chainId",
        "position.chain.id",
        "position.vault.chainId",
        "position.vault.chain.id",
        "earnPosition.vaultChainId",
        "earnPosition.chainId",
        "earnPosition.chain.id",
        "earnPosition.vault.chainId",
        "earnPosition.vault.chain.id",
        "portfolioPosition.vaultChainId",
        "portfolioPosition.chainId",
        "portfolioPosition.chain.id",
        "portfolioPosition.vault.chainId",
        "portfolioPosition.vault.chain.id",
        "data.vaultChainId",
        "data.chainId",
        "data.chain.id",
        "data.vault.chainId",
        "data.vault.chain.id",
        "details.vaultChainId",
        "details.chainId",
        "details.chain.id",
        "details.vault.chainId",
        "details.vault.chain.id",
      ], pickChainId),
      inferredVault?.chainId,
      inferredVault?.chain?.id,
    ),
    protocolName: pickString(
      extractReliableProtocolName(position, inferredVault),
    ),
    assetSymbol: pickString(
      pickFromPaths(position, [
        "assetSymbol",
        "asset.symbol",
        "symbol",
        "token.symbol",
        "underlyingToken.symbol",
        "underlyingTokens.0.symbol",
        "assets.0.symbol",
        "vault.underlyingTokens.0.symbol",
        "vault.assets.0.symbol",
        "position.assetSymbol",
        "position.asset.symbol",
        "position.symbol",
        "position.token.symbol",
        "position.underlyingToken.symbol",
        "position.underlyingTokens.0.symbol",
        "position.assets.0.symbol",
        "position.vault.underlyingTokens.0.symbol",
        "earnPosition.assetSymbol",
        "earnPosition.asset.symbol",
        "earnPosition.symbol",
        "earnPosition.token.symbol",
        "earnPosition.underlyingToken.symbol",
        "earnPosition.underlyingTokens.0.symbol",
        "earnPosition.assets.0.symbol",
        "earnPosition.vault.underlyingTokens.0.symbol",
        "portfolioPosition.assetSymbol",
        "portfolioPosition.asset.symbol",
        "portfolioPosition.symbol",
        "portfolioPosition.token.symbol",
        "portfolioPosition.underlyingToken.symbol",
        "portfolioPosition.vault.underlyingTokens.0.symbol",
        "data.assetSymbol",
        "data.asset.symbol",
        "data.symbol",
        "data.token.symbol",
        "data.underlyingToken.symbol",
        "data.vault.underlyingTokens.0.symbol",
        "details.assetSymbol",
        "details.asset.symbol",
        "details.symbol",
        "details.token.symbol",
        "details.underlyingToken.symbol",
        "details.vault.underlyingTokens.0.symbol",
      ], pickString),
      inferredVault?.underlyingTokens?.[0]?.symbol,
      inferredVault?.assets?.[0]?.symbol,
    ),
    balanceUsd: pickNumber(
      pickFromPaths(position, [
        "balanceUsd",
        "positionUsd",
        "valueUsd",
        "usdValue",
        "amountUsd",
        "valuation.usd",
        "balance.usd",
        "position.balanceUsd",
        "position.positionUsd",
        "position.valueUsd",
        "position.usdValue",
        "position.amountUsd",
        "position.valuation.usd",
        "position.balance.usd",
        "earnPosition.balanceUsd",
        "earnPosition.positionUsd",
        "earnPosition.valueUsd",
        "earnPosition.usdValue",
        "earnPosition.amountUsd",
        "earnPosition.valuation.usd",
        "earnPosition.balance.usd",
        "portfolioPosition.balanceUsd",
        "portfolioPosition.positionUsd",
        "portfolioPosition.valueUsd",
        "portfolioPosition.usdValue",
        "portfolioPosition.amountUsd",
        "portfolioPosition.valuation.usd",
        "portfolioPosition.balance.usd",
        "data.balanceUsd",
        "data.positionUsd",
        "data.valueUsd",
        "data.usdValue",
        "data.amountUsd",
        "data.valuation.usd",
        "details.balanceUsd",
        "details.positionUsd",
        "details.valueUsd",
        "details.usdValue",
        "details.amountUsd",
        "details.valuation.usd",
      ], pickNumber),
    ),
    raw: position,
  }
}

export function normalizePortfolioPositions(positions: any[]): PortfolioPositionSummary[] {
  if (!Array.isArray(positions)) return []
  return positions.map(normalizePortfolioPosition)
}
