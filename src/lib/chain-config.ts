export const CHAIN_MAP: Record<string, number> = {
  ethereum: 1,
  eth: 1,
  mainnet: 1,
  base: 8453,
  arbitrum: 42161,
  arb: 42161,
  optimism: 10,
  op: 10,
  polygon: 137,
  matic: 137,
  avalanche: 43114,
  avax: 43114,
  bsc: 56,
  bnb: 56,
  sepolia: 11155111,
  "base-sepolia": 84532,
  "base sepolia": 84532,
  "arbitrum-sepolia": 421614,
  "arbitrum sepolia": 421614,
}

export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BSC",
  137: "Polygon",
  8453: "Base",
  43114: "Avalanche",
  42161: "Arbitrum",
  84532: "Base Sepolia",
  421614: "Arbitrum Sepolia",
  11155111: "Sepolia",
}

export const CHAIN_RPC: Record<number, string> = {
  1: "https://eth.llamarpc.com",
  10: "https://mainnet.optimism.io",
  56: "https://bsc-dataseed.binance.org",
  137: "https://polygon-rpc.com",
  8453: "https://mainnet.base.org",
  43114: "https://api.avax.network/ext/bc/C/rpc",
  42161: "https://arb1.arbitrum.io/rpc",
}

export const TOKEN_ADDRESSES: Record<string, Record<number, string>> = {
  USDC: {
    1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    56: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  "USDC-SEPOLIA": {
    11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  USDT: {
    1: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    10: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    56: "0x55d398326f99059fF775485246999027B3197955",
    137: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    8453: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
  ETH: {
    1: "0x0000000000000000000000000000000000000000",
    10: "0x0000000000000000000000000000000000000000",
    8453: "0x0000000000000000000000000000000000000000",
    42161: "0x0000000000000000000000000000000000000000",
  },
  WETH: {
    1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    10: "0x4200000000000000000000000000000000000006",
    8453: "0x4200000000000000000000000000000000000006",
    42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  },
  DAI: {
    1: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    10: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    42161: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  },
  WBTC: {
    1: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    10: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
    42161: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  },
  CBBTC: {
    1: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    8453: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  },
}

export const TOKEN_DECIMALS: Record<string, number> = {
  USDT: 6,
  USDC: 6,
  "USDC-SEPOLIA": 6,
  DAI: 18,
  ETH: 18,
  WETH: 18,
  WBTC: 8,
  CBBTC: 8,
}

export function resolveChainId(name: string): number | undefined {
  return CHAIN_MAP[name.trim().toLowerCase()]
}

export function resolveTokenAddress(symbol: string, chainId: number): string | null {
  return TOKEN_ADDRESSES[symbol.trim().toUpperCase()]?.[chainId] ?? null
}

export function getTokenDecimals(symbol: string): number {
  return TOKEN_DECIMALS[symbol.trim().toUpperCase()] ?? 18
}
