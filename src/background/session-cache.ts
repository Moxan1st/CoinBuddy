export interface WalletSessionState {
  walletAddress: string | null
  updatedAt: number | null
}

export interface PortfolioPositionSummary {
  vaultAddress: string | null
  vaultChainId: number | null
  protocolName: string | null
  assetSymbol: string | null
  balanceUsd: number | null
  raw: any
}

export interface PortfolioSnapshotState {
  walletAddress: string | null
  positions: PortfolioPositionSummary[]
  fetchedAt: number | null
}

interface RuntimeSessionCache {
  wallet: WalletSessionState
  portfolio: PortfolioSnapshotState
}

const runtimeSessionCache: RuntimeSessionCache = {
  wallet: {
    walletAddress: null,
    updatedAt: null,
  },
  portfolio: {
    walletAddress: null,
    positions: [],
    fetchedAt: null,
  },
}

export function getWalletSession(): WalletSessionState {
  return { ...runtimeSessionCache.wallet }
}

export function setWalletSession(walletAddress: string | null): WalletSessionState {
  runtimeSessionCache.wallet.walletAddress = walletAddress
  runtimeSessionCache.wallet.updatedAt = walletAddress ? Date.now() : null

  if (runtimeSessionCache.portfolio.walletAddress && runtimeSessionCache.portfolio.walletAddress !== walletAddress) {
    clearPortfolioSnapshot()
  }

  return getWalletSession()
}

export function clearWalletSession(): void {
  runtimeSessionCache.wallet.walletAddress = null
  runtimeSessionCache.wallet.updatedAt = null
  clearPortfolioSnapshot()
}

export function getPortfolioSnapshot(): PortfolioSnapshotState {
  return {
    walletAddress: runtimeSessionCache.portfolio.walletAddress,
    positions: runtimeSessionCache.portfolio.positions.slice(),
    fetchedAt: runtimeSessionCache.portfolio.fetchedAt,
  }
}

export function setPortfolioSnapshot(
  walletAddress: string,
  positions: PortfolioPositionSummary[],
): PortfolioSnapshotState {
  runtimeSessionCache.portfolio.walletAddress = walletAddress
  runtimeSessionCache.portfolio.positions = positions.slice()
  runtimeSessionCache.portfolio.fetchedAt = Date.now()
  return getPortfolioSnapshot()
}

export function clearPortfolioSnapshot(): void {
  runtimeSessionCache.portfolio.walletAddress = null
  runtimeSessionCache.portfolio.positions = []
  runtimeSessionCache.portfolio.fetchedAt = null
}

export function isPortfolioFresh(walletAddress: string, maxAgeMs: number): boolean {
  if (!runtimeSessionCache.portfolio.fetchedAt) return false
  if (runtimeSessionCache.portfolio.walletAddress !== walletAddress) return false
  return Date.now() - runtimeSessionCache.portfolio.fetchedAt <= maxAgeMs
}
