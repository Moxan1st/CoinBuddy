import test from "node:test"
import assert from "node:assert/strict"

import { shouldPersistWalletAddress } from "./popup-wallet-storage.ts"

test("persists a real wallet address", () => {
  assert.equal(
    shouldPersistWalletAddress("0x1234567890abcdef1234567890abcdef12345678"),
    true,
  )
})

test("does not persist undefined, null, or empty values", () => {
  assert.equal(shouldPersistWalletAddress(undefined), false)
  assert.equal(shouldPersistWalletAddress(null), false)
  assert.equal(shouldPersistWalletAddress(""), false)
  assert.equal(shouldPersistWalletAddress("   "), false)
})
