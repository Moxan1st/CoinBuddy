import test from "node:test"
import assert from "node:assert/strict"

import { getAction, getAvailableActions } from "./action-registry.ts"
import type { ActionType } from "../../types/index.ts"

const ALL_ACTIONS: ActionType[] = [
  "search_vaults",
  "compare_vaults",
  "get_vault_detail",
  "check_balance",
  "build_deposit",
  "build_swap",
  "build_bridge",
  "build_withdraw",
  "fetch_price",
  "fetch_portfolio",
  "reply_user",
]

test("action registry has handlers for all ActionType values", () => {
  for (const action of ALL_ACTIONS) {
    assert.equal(typeof getAction(action), "function", `missing handler for ${action}`)
  }
})

test("getAvailableActions returns the full action set", () => {
  const actions = getAvailableActions()

  assert.equal(actions.length, ALL_ACTIONS.length)
  assert.deepEqual(new Set(actions), new Set(ALL_ACTIONS))
})

test("getAction returns undefined for unknown action", () => {
  assert.equal(getAction("unknown_action" as ActionType), undefined)
})
