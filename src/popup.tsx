import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { WagmiProvider, useAccount, useConnect, useDisconnect, useSendTransaction } from "wagmi"
import { wagmiConfig } from "~lib/wagmi-config"

const queryClient = new QueryClient()

const WALLET_DISPLAY: Record<string, { label: string; icon: string }> = {
  injected:          { label: "Browser Wallet",             icon: "🌐" },
  "io.metamask":     { label: "MetaMask",                  icon: "🦊" },
  metaMask:          { label: "MetaMask",                  icon: "🦊" },
  metaMaskSDK:       { label: "MetaMask",                  icon: "🦊" },
  coinbaseWalletSDK: { label: "Coinbase Smart Wallet",     icon: "🔵" },
  walletConnect:     { label: "WalletConnect",              icon: "🔗" },
}

function PopupInner() {
  const { address, isConnected } = useAccount()
  const { connectAsync, connectors } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { sendTransactionAsync } = useSendTransaction()
  const [status, setStatus] = useState("")
  const [pendingTx, setPendingTx] = useState<any>(null)
  const [txSigning, setTxSigning] = useState(false)

  // Sync wallet address to storage
  useEffect(() => {
    if (address) {
      chrome.storage.local.set({ coinbuddy_wallet: address })
      setStatus("")
    } else {
      chrome.storage.local.remove("coinbuddy_wallet")
    }
  }, [address])

  // Check for pending transaction on popup open
  useEffect(() => {
    chrome.storage.local.get("coinbuddy_pending_tx", (data) => {
      if (data.coinbuddy_pending_tx) {
        setPendingTx(data.coinbuddy_pending_tx)
      }
    })
  }, [])

  const getPreferredConnector = () => {
    const coinbase = connectors.find(
      (c) => c.id === "coinbaseWalletSDK" || c.name.toLowerCase().includes("coinbase")
    )
    return coinbase || connectors[0]
  }

  // 不自动签名 — 让用户手动点 "Sign & Send"，确保 connector 完全就绪

  const handleConnect = async (connector: typeof connectors[0]) => {
    try {
      setStatus(`Connecting ${connector.name}...`)
      await connectAsync({ connector })
      setStatus("Connected!")
    } catch (err: any) {
      setStatus(err.message?.includes("rejected") ? "Cancelled" : `Error: ${err.message?.slice(0, 60)}`)
    }
  }

  const handleDisconnect = async () => {
    await disconnectAsync()
    chrome.storage.local.remove("coinbuddy_wallet")
    setStatus("Disconnected")
  }

  const handleSignTx = async (payload: any) => {
    setTxSigning(true)
    setStatus("Connecting wallet & signing...")
    try {
      // 每次签名都强制重新连接，确保 connector 完全初始化
      // （popup 关闭后 wagmi 的 connector 实例方法丢失）
      const preferredConnector = getPreferredConnector()
      try {
        await disconnectAsync()
      } catch (_) { /* 可能本来就没连接 */ }
      await connectAsync({ connector: preferredConnector })

      const hash = await sendTransactionAsync({
        to: payload.to as `0x${string}`,
        data: (payload.data || "0x") as `0x${string}`,
        value: payload.value ? BigInt(payload.value) : 0n,
        chainId: payload.chainId ? Number(payload.chainId) : undefined,
        gas: payload.gasLimit ? BigInt(payload.gasLimit) : undefined
      })

      await chrome.storage.local.set({
        coinbuddy_tx_result: { success: true, hash }
      })
      setStatus(`TX sent! ${String(hash).slice(0, 10)}...`)
      setPendingTx(null)
      chrome.storage.local.remove("coinbuddy_pending_tx")
    } catch (err: any) {
      const rawMsg = err?.shortMessage || err?.message || "Transaction rejected"
      const lower = String(rawMsg).toLowerCase()
      const friendly = lower.includes("insufficient funds")
        ? "余额不足：当前钱包不足以支付金额+Gas，请先充值后再试。"
        : rawMsg

      await chrome.storage.local.set({
        coinbuddy_tx_result: { success: false, error: friendly }
      })
      setStatus(lower.includes("rejected") || lower.includes("denied") ? "Cancelled by user" : `Error: ${friendly.slice(0, 60)}`)
      setPendingTx(null)
      chrome.storage.local.remove("coinbuddy_pending_tx")
    } finally {
      setTxSigning(false)
    }
  }

  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null

  return (
    <div style={{
      padding: 20, width: 320, fontFamily: "system-ui, sans-serif",
      background: "linear-gradient(135deg, #1a1a2e, #16213e)", color: "#fff"
    }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>CoinBuddy</h2>
      <p style={{ margin: "0 0 16px", fontSize: 12, opacity: 0.6 }}>Your DeFi companion pet</p>

      {/* Pending transaction banner */}
      {pendingTx && (
        <div style={{
          padding: "10px 14px", background: "rgba(251,191,36,0.15)",
          borderRadius: 10, border: "1px solid rgba(251,191,36,0.4)", marginBottom: 12
        }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Pending Transaction</div>
          <div style={{ fontSize: 12, color: "#fbbf24" }}>
            To: {pendingTx.to?.slice(0, 10)}... | Chain: {pendingTx.chainId || "?"}
          </div>
          {!txSigning && (
            <button onClick={() => handleSignTx(pendingTx)} style={{
              marginTop: 8, width: "100%", padding: "8px", background: "rgba(16,185,129,0.3)",
              border: "1px solid rgba(16,185,129,0.5)", borderRadius: 8,
              color: "#6ee7b7", fontSize: 13, cursor: "pointer"
            }}>
              Sign & Send
            </button>
          )}
        </div>
      )}

      {isConnected ? (
        <div>
          <div style={{
            padding: "10px 14px", background: "rgba(16,185,129,0.15)",
            borderRadius: 10, border: "1px solid rgba(16,185,129,0.3)", marginBottom: 12
          }}>
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Connected Wallet</div>
            <div style={{ fontSize: 14, fontFamily: "monospace", color: "#6ee7b7" }}>{shortAddr}</div>
          </div>
          <button onClick={handleDisconnect} style={{
            width: "100%", padding: "10px", background: "rgba(239,68,68,0.2)",
            border: "1px solid rgba(239,68,68,0.4)", borderRadius: 10,
            color: "#fca5a5", fontSize: 13, cursor: "pointer"
          }}>
            Disconnect
          </button>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>Choose a wallet:</p>
          {connectors.map((connector) => {
            const display = WALLET_DISPLAY[connector.id] || { label: connector.name, icon: "💎" }
            return (
              <button
                key={connector.uid}
                onClick={() => handleConnect(connector)}
                style={{
                  width: "100%", padding: "10px 14px", marginBottom: 8,
                  background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)",
                  borderRadius: 10, color: "#fff", fontSize: 13, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 10, textAlign: "left" as const
                }}
              >
                <span style={{ fontSize: 20 }}>{display.icon}</span>
                <span>{display.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {status && (
        <p style={{ margin: "10px 0 0", fontSize: 11, opacity: 0.7, textAlign: "center" }}>{status}</p>
      )}
    </div>
  )
}

function IndexPopup() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <PopupInner />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export default IndexPopup
