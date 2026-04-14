import test from "node:test"
import assert from "node:assert/strict"

// Mock chrome.storage.local for Node test environment
let mockStorage: Record<string, any> = {}
;(globalThis as any).chrome = {
  storage: {
    local: {
      get: (key: string) => Promise.resolve({ [key]: mockStorage[key] }),
    },
  },
}

// Import after mock is set up
const { getEffectiveWalletAddress } = await import("./wallet-resolve.ts")

const VALID_ADDR = "0x1234567890abcdef1234567890abcdef12345678"
const VALID_ADDR_2 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"

test("payload has valid address -> returns payload", async () => {
  mockStorage = {}
  const result = await getEffectiveWalletAddress(VALID_ADDR)
  assert.equal(result, VALID_ADDR)
})

test("payload empty, storage has address -> returns storage", async () => {
  mockStorage = { coinbuddy_wallet: VALID_ADDR }
  const result = await getEffectiveWalletAddress(undefined)
  assert.equal(result, VALID_ADDR)
})

test("payload and storage both empty -> returns null", async () => {
  mockStorage = {}
  const result = await getEffectiveWalletAddress(undefined)
  assert.equal(result, null)
})

test("invalid payload address -> ignores it, tries storage", async () => {
  mockStorage = { coinbuddy_wallet: VALID_ADDR }
  const result = await getEffectiveWalletAddress("0x...")
  assert.equal(result, VALID_ADDR)
})

test("invalid payload, empty storage, valid cache -> returns cache", async () => {
  mockStorage = {}
  const result = await getEffectiveWalletAddress("not-an-address", VALID_ADDR_2)
  assert.equal(result, VALID_ADDR_2)
})

test("payload takes priority over storage", async () => {
  mockStorage = { coinbuddy_wallet: VALID_ADDR_2 }
  const result = await getEffectiveWalletAddress(VALID_ADDR)
  assert.equal(result, VALID_ADDR)
})

test("all three empty -> null", async () => {
  mockStorage = {}
  const result = await getEffectiveWalletAddress(undefined, undefined)
  assert.equal(result, null)
})

test("null payload, null storage, null cache -> null", async () => {
  mockStorage = {}
  const result = await getEffectiveWalletAddress(null, null)
  assert.equal(result, null)
})
