export function shouldPersistWalletAddress(address?: string | null): address is string {
  return typeof address === "string" && address.trim().length > 0
}
