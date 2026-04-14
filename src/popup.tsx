import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { WagmiProvider, useAccount, useConnect, useDisconnect, useSendTransaction, useSwitchChain } from "wagmi"
import { useSendCalls } from "wagmi/experimental"
import { wagmiConfig } from "~lib/wagmi-config"
import { shouldPersistWalletAddress } from "./popup-wallet-storage"
import {
  canFallbackToSequentialBatch,
  describePendingPopupTransaction,
  describePopupCall,
  formatPopupWalletError,
  normalizePendingPopupTransaction,
  selectPreferredPopupConnector,
  shouldFallbackToSingleSend,
  splitSequentialBatchCalls,
} from "~lib/popup-transaction"

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
  const { address, isConnected, connector } = useAccount()
  const { connectAsync, connectors } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { sendTransactionAsync } = useSendTransaction()
  const { sendCallsAsync } = useSendCalls()
  const { switchChainAsync } = useSwitchChain()
  const [status, setStatus] = useState("")
  const [pendingTx, setPendingTx] = useState<any>(null)
  const [txSigning, setTxSigning] = useState(false)

  // Sync wallet address to storage
  useEffect(() => {
    if (shouldPersistWalletAddress(address)) {
      chrome.storage.local.set({ coinbuddy_wallet: address })
      setStatus("")
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
    return selectPreferredPopupConnector(connectors, connector || null)
  }

  // Auto-sign when popup opens with a pending tx
  useEffect(() => {
    if (pendingTx && !txSigning) {
      const t = setTimeout(() => handleSignTx(pendingTx), 300)
      return () => clearTimeout(t)
    }
  }, [pendingTx])

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
      const normalized = normalizePendingPopupTransaction(payload)
      if (!normalized) {
        throw new Error("Invalid pending transaction payload")
      }
      // 优化连接逻辑：如果已经连接了正确的 connector，不需要重新连接
      const preferredConnector = getPreferredConnector()
      if (!preferredConnector) {
        throw new Error("No wallet connector available")
      }

      if (!isConnected || connector?.id !== preferredConnector.id) {
        try {
          await disconnectAsync()
        } catch (_) {}
        await connectAsync({ connector: preferredConnector })
      }

      const targetChainId = normalized.chainId ?? undefined
      if (targetChainId) {
        // 只有当 chainId 不匹配时才切换
        const { chainId: currentChainId } = wagmiConfig.state
        if (currentChainId !== targetChainId) {
          try {
            await switchChainAsync({ chainId: targetChainId })
          } catch (switchErr: any) {
            throw new Error(`Please switch wallet network to chain ${targetChainId} first: ${switchErr?.shortMessage || switchErr?.message || "switch failed"}`)
          }
        }
      }

      let hash: string
      const canFallbackToSingleSend = shouldFallbackToSingleSend(normalized)
      const canFallbackToSequential = canFallbackToSequentialBatch(normalized)
      const summary = describePendingPopupTransaction(normalized)

      if (normalized.kind === "batch") {
        const batchPreview = summary.steps.length
          ? summary.steps.slice(0, 3).join(" → ")
          : normalized.calls
              .slice(0, 3)
              .map((call, index) => describePopupCall(call, index, normalized.calls.length))
              .join(" → ")
        setStatus(batchPreview ? `Sending atomic smart batch: ${batchPreview}` : "Sending atomic smart batch...")
        console.log(`[Popup] Sending full atomic batch: ${normalized.calls.length} calls via EIP-5792`)
        try {
          const batchId = await sendCallsAsync({
            calls: normalized.calls.map((call) => ({
              to: call.to,
              data: call.data,
              value: call.value,
            })),
          } as any)
          hash = String(batchId)
        } catch (batchErr: any) {
          if (canFallbackToSequential) {
            const sequentialCalls = splitSequentialBatchCalls(normalized)
            let latestHash = ""
            for (let i = 0; i < sequentialCalls.length; i += 1) {
              const call = sequentialCalls[i]
              setStatus(`Sequential fallback: ${describePopupCall(call, i, sequentialCalls.length)}...`)
              latestHash = await sendTransactionAsync({
                to: call.to,
                data: call.data,
                value: call.value,
                chainId: targetChainId,
              })
            }
            hash = latestHash
          } else if (canFallbackToSingleSend) {
            setStatus("Batch unsupported, falling back to single send...")
            const single = normalized.calls[0]
            hash = await sendTransactionAsync({
              to: single.to,
              data: single.data,
              value: single.value,
              chainId: targetChainId,
            })
          } else {
            throw batchErr
          }
        }
      } else {
        // Single transaction (existing flow)
        const single = normalized.calls[0]
        setStatus(`Signing ${describePopupCall(single, 0, 1)}...`)
        hash = await sendTransactionAsync({
          to: single.to,
          data: single.data,
          value: single.value,
          chainId: targetChainId,
        })
      }

      await chrome.storage.local.set({
        coinbuddy_tx_result: { success: true, hash }
      })
      setStatus(`TX sent! ${String(hash).slice(0, 10)}...`)
      setPendingTx(null)
      chrome.storage.local.remove("coinbuddy_pending_tx")
    } catch (err: any) {
      const normalized = normalizePendingPopupTransaction(payload)
      const canFallbackToSingleSend = normalized ? shouldFallbackToSingleSend(normalized) : false
      const canFallbackToSequential = normalized ? canFallbackToSequentialBatch(normalized) : false
      const popupError = formatPopupWalletError(err, {
        isBatch: normalized?.kind === "batch",
        callCount: normalized?.calls.length || 0,
      })
      console.error("[Popup] TX Error full:", JSON.stringify(err, Object.getOwnPropertyNames(err), 2))
      console.error("[Popup] TX Error details:", err?.details || err?.cause?.message || err?.cause?.details || "none")
      const lower = popupError.message.toLowerCase()
      const friendly = lower.includes("insufficient funds")
        ? "余额不足：当前钱包不足以支付金额+Gas，请先充值后再试。"
        : lower.includes("transfer_from_failed")
          ? "批量模拟失败（TRANSFER_FROM_FAILED）：这不是 403/CSP 问题，通常是钱包 bundler 在原子模拟时看不到授权状态。已尝试自动先授权再执行；若仍失败请先单独授权后重试。"
          : popupError.message

      await chrome.storage.local.set({
        coinbuddy_tx_result: {
          success: false,
          error: friendly,
          code: popupError.code,
          retryable: popupError.retryable,
          preservePendingTx: popupError.retryable,
          fallbackTried: normalized?.kind === "batch" ? canFallbackToSingleSend || canFallbackToSequential : false,
          details: popupError.details || null,
        }
      })
      setStatus(lower.includes("rejected") || lower.includes("denied") ? "Cancelled by user" : `Error: ${friendly.slice(0, 60)}`)
      if (!popupError.retryable) {
        setPendingTx(null)
        chrome.storage.local.remove("coinbuddy_pending_tx")
      }
    } finally {
      setTxSigning(false)
    }
  }

  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null
  const normalizedPendingTx = pendingTx ? normalizePendingPopupTransaction(pendingTx) : null
  const pendingTxSummary = normalizedPendingTx ? describePendingPopupTransaction(normalizedPendingTx) : null

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
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
            {pendingTxSummary?.isBatch ? `Smart Batch (${pendingTxSummary.callCount} steps)` : "Pending Transaction"}
          </div>
          <div style={{ fontSize: 13, color: "#fbbf24", fontWeight: 700, lineHeight: 1.3 }}>
            {pendingTxSummary?.title || (pendingTx.isBatch ? `Smart Batch (${pendingTx.calls?.length || 0} steps)` : "Pending Transaction")}
          </div>
          {pendingTxSummary?.subtitle && (
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4, lineHeight: 1.4 }}>
              {pendingTxSummary.subtitle}
            </div>
          )}
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4, lineHeight: 1.4 }}>
            {pendingTxSummary?.vaultLabel && <div>Vault: {pendingTxSummary.vaultLabel}</div>}
            <div>Chain: {pendingTxSummary?.chainLabel || pendingTx.chainId || "?"}</div>
            {pendingTxSummary?.asset && pendingTxSummary?.amount && (
              <div>Amount: {pendingTxSummary.amount} {pendingTxSummary.asset}</div>
            )}
            {pendingTxSummary?.note && <div style={{ opacity: 0.8 }}>{pendingTxSummary.note}</div>}
          </div>
          {Array.isArray(pendingTxSummary?.steps) && pendingTxSummary.steps.length > 0 && (
            <div style={{ fontSize: 11, opacity: 0.82, marginTop: 6, lineHeight: 1.45 }}>
              {pendingTxSummary.steps.map((step, index) => (
                <div key={index}>{step}</div>
              ))}
            </div>
          )}
          {!pendingTxSummary && pendingTx.isBatch && Array.isArray(pendingTx.calls) && pendingTx.calls.length > 0 && (
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6, lineHeight: 1.4 }}>
              {pendingTx.calls.slice(0, 3).map((call: any, index: number) => (
                <div key={index}>{describePopupCall({
                  to: call.to,
                  data: (call.data || "0x") as `0x${string}`,
                  value: call.value ? BigInt(call.value) : 0n,
                }, index, pendingTx.calls.length)}</div>
              ))}
            </div>
          )}
          {pendingTx.erc8211 && (
            <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>ERC-8211 Compatible | EIP-5792 Execution</div>
          )}
          {txSigning ? (
            <div style={{ marginTop: 8, textAlign: "center", fontSize: 12, opacity: 0.7 }}>
              {status || "Signing in progress..."}
            </div>
          ) : (
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
