# CoinBuddy 核心架构文档

> **维护者**: 架构师 Agent | **更新日期**: 2026-04-14
> **所有人处理后续任务前必读此文档**
> **工作前还须阅读**: [`docs/WORKLOG.md`](WORKLOG.md) — 公共工作进展区

---

## 1. 项目定位

CoinBuddy 是基于 **Plasmo** 的 Chrome 扩展，集成 LI.FI Earn API，通过自然语言对话驱动 DeFi 交易。核心能力：
- LLM 意图识别（Gemini / Qwen 双模型路由）
- 多轮对话状态管理
- 多链交易编排（Swap / Bridge / Deposit / Withdraw）
- AI 自动化策略引擎
- ERC-8211 + EIP-5792 原子批处理

---

## 2. 模块架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                        │
├─────────────────────────────────────────────────────────────┤
│  UI Layer                                                   │
│  ├─ popup.tsx              → 钱包连接 + 交易签名            │
│  ├─ contents/overlay.tsx   → 网页悬浮聊天窗                 │
│  ├─ components/            → ChatBubble, WalletExecutor     │
│  └─ hooks/                 → React hooks                    │
├─────────────────────────────────────────────────────────────┤
│  Background Service Worker (核心)                            │
│  ├─ index.ts               → 消息路由主入口 (~900行)         │
│  ├─ brain.ts               → Facade 聚合器                  │
│  ├─ llm-client.ts          → LLM 意图识别 + 模型路由         │
│  ├─ lifi-client.ts         → LI.FI API 集成 (~500行)         │
│  ├─ handlers/              → 意图分发处理器                  │
│  │   ├─ invest.ts          → 投资/对比/详情/确认             │
│  │   ├─ swap.ts            → 代币交换                       │
│  │   ├─ bridge.ts          → 跨链转移 + 续桥                │
│  │   ├─ withdraw.ts        → 金库提现                       │
│  │   ├─ portfolio.ts       → 持仓查询                       │
│  │   ├─ composite.ts       → 多步原子交易                   │
│  │   └─ strategy.ts        → 策略创建/列表                  │
│  ├─ planner/               → 多步计划引擎                   │
│  │   ├─ agent-planner.ts   → LLM 驱动计划生成               │
│  │   ├─ action-registry.ts → 可用工具注册表                  │
│  │   └─ step-executor.ts   → 计划执行 + 条件评估            │
│  ├─ agent/                 → ReAct 智能体                   │
│  │   ├─ runtime.ts         → 思考-执行-观察循环              │
│  │   ├─ tool-registry.ts   → 工具定义与执行                  │
│  │   ├─ prompts.ts         → 系统提示                       │
│  │   └─ state.ts           → 会话状态                       │
│  └─ 状态管理                                                │
│      ├─ dialogue-state.ts  → 投资参数缓存（PendingDepositDraft）│
│      ├─ transaction-state.ts → 待签名交易缓存                │
│      ├─ session-cache.ts   → 运行时会话（钱包+持仓快照）     │
│      ├─ wallet-resolve.ts  → 钱包地址优先级解析              │
│      └─ wallet-gate.ts     → 钱包连接检查                   │
├─────────────────────────────────────────────────────────────┤
│  Strategy Engine (自动化)                                    │
│  ├─ strategy-engine.ts     → 状态机 + 触发逻辑              │
│  ├─ price-watcher.ts       → 价格监控                       │
│  ├─ executor.ts            → 两步交易执行                   │
│  └─ types.ts               → Strategy 模型定义              │
├─────────────────────────────────────────────────────────────┤
│  Shared                                                     │
│  ├─ types/                 → Intent, Vault, Quote, Plan     │
│  └─ lib/                   → chain-config, logger, i18n     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 核心数据流

### 3.1 用户消息 → 交易执行

```
User Input (Overlay / Popup)
    │
    ▼
chrome.runtime.sendMessage({ text, walletAddress })
    │
    ▼
Background index.ts:
  1. walletResolve → 确定钱包地址
  2. detectLang → 检测语言
  3. analyzeIntent → LLM 意图识别 → IntentResult
  4. orderedHandlers 按优先级路由:
     [strategy → invest → portfolio → composite → swap → bridge → withdraw]
  5. Handler 处理 → 可能调用 lifi-client 构建交易
    │
    ▼
Response { reply, transactionPayload?, petState }
    │
    ▼
Popup/Overlay 显示回复 + 签名按钮
    │
    ▼
wagmi.sendTransaction(transactionRequest)
```

### 3.2 投资流（最常见）

```
"存 500 USDC 到 Base" 
  → analyzeIntent → { type: "invest", investParams: {amount:"500", searchAsset:"USDC", toChainConfig:[8453]} }
  → handleInvest:
    1. fetchOptimalVault([8453], "USDC") → GET earn.li.fi/v1/earn/vaults
    2. 推荐金库，等待确认
    3. [确认] → buildDepositTransaction() → GET li.quest/v1/quote
    4. 返回 txPayload → 用户签名
```

### 3.3 两步提现 + 跨链

```
"从 Seamless 取出，跨到 Ethereum"
  Step1: handleWithdraw → buildWithdrawTransaction → 签名
         + setPendingBridgeAfterWithdraw({token, fromChain, toChain})
  Step2: "继续桥接" → handleBridge → 读取 pending → 自动获取余额 → buildBridgeTransaction → 签名
```

---

## 4. 状态管理

| 状态 | 文件 | 生命周期 | 用途 |
|------|------|---------|------|
| PendingDepositDraft | dialogue-state.ts | 跨消息保持 | 投资参数、选中金库、候选列表 |
| PendingTransactionPayload | transaction-state.ts | 签名前 → 签名后清除 | 待执行交易 |
| RuntimeSessionCache | session-cache.ts | SW 重启时清除 | 钱包+持仓快照 (5min TTL) |
| PendingBridgeAfterWithdraw | index.ts 变量 | 提现后 → 桥接后清除 | 两步流程协调 |
| AgentSession | agent/state.ts | 对话期间 | ReAct 循环上下文 |

---

## 5. Handler 路由优先级

```typescript
const orderedHandlers = [
  handleStrategy,    // 策略创建/列表
  handleInvest,      // 存款/对比/详情/确认/取消
  handlePortfolio,   // 持仓查询
  handleComposite,   // 多步计划
  handleSwap,        // 交换
  handleBridge,      // 跨链（含续桥）
  handleWithdraw,    // 提现
]
// 首个匹配的 handler 处理，后续不再执行
```

---

## 6. 外部依赖

| 依赖 | 用途 |
|------|------|
| Plasmo | Chrome 扩展框架 |
| wagmi + viem | 钱包连接与交易签名 |
| @coinbase/wallet-sdk | Coinbase 钱包支持 |
| @tanstack/react-query | 数据获取管理 |
| lottie-react | 宠物动画 |
| canvas-confetti | 交易成功特效 |

---

## 7. 架构优化建议

### 高优先级

| 问题 | 位置 | 建议 |
|------|------|------|
| bridge.ts logger 未导入 | bridge.ts:94,96 | 添加 `import { createLogger } from "~lib/logger"` |
| Draft 缓存可能跨 tab 串联 | index.ts 全局变量 | 按 tab/sender 隔离会话 |
| 缺乏交易回执确认 | lifi-client.ts | 集成链上确认 polling |
| 浮点精度损失 | quote-formatter.ts | 使用 BigInt 处理金额 |

### 中优先级

| 问题 | 建议 |
|------|------|
| Planner 步骤数限制 6 | 增加到 10 或支持递归规划 |
| 缺少离线降级 | 本地缓存金库列表 |
| 测试覆盖不足 | 补充 handler 集成测试 |
| 缓存仅内存级 | 添加 chrome.storage.local 二级缓存 |

---

## 8. 关键文件索引

### 核心架构
- `src/background/index.ts` — 消息路由主入口
- `src/background/brain.ts` — Facade 聚合器
- `src/background/lifi-client.ts` — LI.FI API 集成
- `src/background/llm-client.ts` — LLM 意图识别

### 意图处理
- `src/background/handlers/invest.ts` — 投资处理
- `src/background/handlers/withdraw.ts` — 提现处理
- `src/background/handlers/bridge.ts` — 跨链处理
- `src/background/handlers/composite.ts` — 多步处理

### 智能体
- `src/background/agent/runtime.ts` — ReAct 运行时
- `src/background/planner/agent-planner.ts` — 计划生成
- `src/background/planner/step-executor.ts` — 计划执行

### 策略引擎
- `src/strategy/strategy-engine.ts` — 状态机+触发逻辑
- `src/strategy/executor.ts` — 两步交易执行

### 状态管理
- `src/background/dialogue-state.ts` — 对话状态
- `src/background/transaction-state.ts` — 交易状态
- `src/background/session-cache.ts` — 会话缓存
