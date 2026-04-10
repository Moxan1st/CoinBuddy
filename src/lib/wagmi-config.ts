import { http, createConfig } from "wagmi"
import { base, mainnet, arbitrum, optimism, sepolia, baseSepolia, arbitrumSepolia } from "wagmi/chains"
import { coinbaseWallet, injected, metaMask, walletConnect } from "wagmi/connectors"

// WalletConnect projectId — 免费申请 https://cloud.walletconnect.com
const WC_PROJECT_ID = "b3c9e7ef0a7a0e1e7c3b6a8d9f4e2c1a" // placeholder, 可替换

export const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum, optimism, sepolia, baseSepolia, arbitrumSepolia],
  connectors: [
    injected(),
    metaMask(),
    coinbaseWallet({
      appName: "CoinBuddy",
      preference: "smartWalletOnly",
      appLogoUrl: ""
    }),
    walletConnect({ projectId: WC_PROJECT_ID })
  ],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [arbitrumSepolia.id]: http()
  }
})
