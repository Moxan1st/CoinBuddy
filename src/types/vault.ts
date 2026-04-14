export interface VaultProtocol {
  name: string
  url?: string
}

export interface VaultApy {
  base: number
  reward: number
  total: number
}

export interface VaultAnalytics {
  apy: VaultApy
  apy1d?: number | null
  apy7d?: number | null
  apy30d?: number | null
  tvl?: { usd: string } | number
  updatedAt?: string
}

export interface VaultUnderlyingToken {
  address: string
  symbol: string
  decimals?: number
}

export interface Vault {
  address: string
  chainId: number
  name: string
  network?: string
  protocol: VaultProtocol
  analytics: VaultAnalytics
  underlyingTokens: VaultUnderlyingToken[]
  tags?: string[]
  isTransactional?: boolean
  isRedeemable?: boolean
}
