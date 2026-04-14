import type { IntentResult } from "~types"
import { handleBridge } from "./bridge"
import { handleComposite } from "./composite"
import { handleInvest } from "./invest"
import { handlePortfolio } from "./portfolio"
import { handleStrategy } from "./strategy"
import { handleSwap } from "./swap"
import { handleWithdraw } from "./withdraw"
import type { HandlerContext } from "./types"

const orderedHandlers = [
  handleStrategy,
  handleInvest,
  handlePortfolio,
  handleComposite,
  handleSwap,
  handleBridge,
  handleWithdraw,
]

export async function routeIntent(intent: IntentResult, ctx: HandlerContext): Promise<boolean> {
  for (const handler of orderedHandlers) {
    if (await handler(intent, ctx)) return true
  }
  return false
}
