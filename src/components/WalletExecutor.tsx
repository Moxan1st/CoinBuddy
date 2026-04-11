import { useEffect } from "react"

/**
 * Invisible component that bridges custom events to the popup for signing.
 * Content script 内的 wagmi 实例没有已连接的 provider，
 * 所以交易签名必须通过 popup 完成。
 *
 * 流程：content script dispatch event → 这里接收 → 存到 chrome.storage
 *       → 打开 popup → popup 读取 pending tx → wagmi sendTransaction → 结果回传
 */
export default function WalletExecutor() {
  useEffect(() => {
    const handler = async (e: Event) => {
      const payload = (e as CustomEvent).detail
      try {
        // 存交易数据到 chrome.storage，popup 会读取并签名
        // isBatch + calls 会原样传递给 popup 以触发 EIP-5792 batch 路径
        await chrome.storage.local.set({ coinbuddy_pending_tx: payload })

        // 打开 popup 进行签名
        chrome.runtime.sendMessage({ action: "OPEN_POPUP" }, () => {
          if (chrome.runtime.lastError) {
            window.dispatchEvent(
              new CustomEvent("coinbuddy:tx-result", {
                detail: { success: false, error: "无法打开签名窗口" }
              })
            )
          }
        })

        // 监听 popup 签名完成的结果
        const onResult = (changes: any) => {
          if (changes.coinbuddy_tx_result) {
            const result = changes.coinbuddy_tx_result.newValue
            if (result) {
              window.dispatchEvent(
                new CustomEvent("coinbuddy:tx-result", { detail: result })
              )
              // 清理
              chrome.storage.local.remove(["coinbuddy_pending_tx", "coinbuddy_tx_result"])
              chrome.storage.onChanged.removeListener(onResult)
            }
          }
        }
        chrome.storage.onChanged.addListener(onResult)

        // 60s 超时自动清理
        setTimeout(() => {
          chrome.storage.onChanged.removeListener(onResult)
        }, 60000)

      } catch (err: any) {
        window.dispatchEvent(
          new CustomEvent("coinbuddy:tx-result", {
            detail: { success: false, error: err.message || "Failed to initiate transaction" }
          })
        )
      }
    }
    window.addEventListener("coinbuddy:execute-tx", handler)
    return () => window.removeEventListener("coinbuddy:execute-tx", handler)
  }, [])

  return null
}
