export interface PendingTransactionPayloadState {
  transactionPayload: Record<string, unknown>
  sourceText: string
  updatedAt: number
}

let pendingTransactionPayload: PendingTransactionPayloadState | null = null

type ChromeStorageLocalLike = {
  get: (keys: string | string[] | Record<string, unknown>) => Promise<Record<string, unknown>>
}

export function setPendingTransactionPayload(
  transactionPayload: Record<string, unknown> | null,
  sourceText: string,
): PendingTransactionPayloadState | null {
  if (!transactionPayload) {
    pendingTransactionPayload = null
    return null
  }

  pendingTransactionPayload = {
    transactionPayload: { ...transactionPayload },
    sourceText,
    updatedAt: Date.now(),
  }
  return getPendingTransactionPayload()
}

export function getPendingTransactionPayload(): PendingTransactionPayloadState | null {
  if (!pendingTransactionPayload) return null
  return {
    transactionPayload: { ...pendingTransactionPayload.transactionPayload },
    sourceText: pendingTransactionPayload.sourceText,
    updatedAt: pendingTransactionPayload.updatedAt,
  }
}

export function clearPendingTransactionPayload(): void {
  pendingTransactionPayload = null
}

export async function getPendingTransactionPayloadFromStorage(
  storage?: ChromeStorageLocalLike | null,
): Promise<PendingTransactionPayloadState | null> {
  const localStorage = storage ?? (typeof chrome !== "undefined" ? chrome.storage?.local : null)
  if (!localStorage) return null

  try {
    const stored = await localStorage.get("coinbuddy_pending_tx")
    const transactionPayload = stored.coinbuddy_pending_tx
    if (!transactionPayload || typeof transactionPayload !== "object") return null

    return {
      transactionPayload: { ...(transactionPayload as Record<string, unknown>) },
      sourceText: "chrome.storage.local.coinbuddy_pending_tx",
      updatedAt: Date.now(),
    }
  } catch {
    return null
  }
}
