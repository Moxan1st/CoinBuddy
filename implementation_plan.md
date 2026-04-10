# CoinBuddy 开发任务规划与接口定义 (含 Smart Wallet 更新)

> **最后更新：2026-04-09** | 前端外壳体系已全部搭建完成并通过构建验证

## 架构概览与进程职责

1.  **Content Script (UI & 嗅探)：** 注入到目标网页，负责渲染悬浮小宠物、截获网页文本、处理用户交互。
2.  **Background Service Worker (大脑)：** 驻留在后台，负责调用 Gemini大模型、请求 LI.FI Earn API 拿数据、调用 Composer 获取交易 Payload。
3.  **Web3 挂载层 (肌肉)：** 与前端合并在 Content UI 中，**全面引入 Wagmi v2 和 Coinbase Smart Wallet SDK** 管理用户密钥对并完成签名。

---

## 模块拆解与实现状态

### 模块 A：前端表现层与嗅探引擎 — Claude 完成
*   **A1: 构建小宠物 UI 面板** — `src/components/PetAvatar.tsx`
    - Lottie 呼吸动画加载 (`src/assets/coinbuddy-idle.json`)
    - 4 种 CSS 视觉状态切换（Idle 浮动、Alert 弹跳+红色❗、Thinking 发光+...、Done 庆祝旋转+confetti）
    - 所有动画通过父 div CSS 驱动，**绝不修改 Lottie 原始坐标**
    - 样式定义：`src/components/styles.ts`（Shadow DOM 注入方式）
*   **A2: 对话框组件** — `src/components/ChatBubble.tsx`
    - 紫色渐变头部 + 消息列表 + 输入发送区域
    - Bot/User 消息分侧显示，Bot 回复可附带交易确认按钮
    - 点击宠物切换展开/收起
*   **A3: 嗅探引擎 (Sniffer)** — `src/lib/sniffer.ts`
    - 滚动监听 + 5 秒定时轮询，30 秒防抖冷却
    - 关键词库：资产（USDC/USDT/DAI/ETH...）+ 收益词（APY/yield/earn...）+ 协议名（Morpho/Aave/Compound...）
    - 触发条件：(资产 + 收益词) OR (已知协议名)
    - 命中后发送 `chrome.runtime.sendMessage({ action: "SNIFF_MATCH" })`

### 模块 B：智能中枢与 API 对接 — Antigravity 完成核心 → Claude 迁移为 TS
*   **B1: 意图解析器** — `src/background/brain.ts` > `parseIntent()`
    - 当前为 Mock 提取（TODO: 接入 Gemini API）
*   **B2: LI.FI 数据集成** — `src/background/brain.ts` > `fetchOptimalVault()`
    - **已验证可真实调用** `earn.li.fi/v1/earn/vaults`，成功返回 Arbitrum euler-v2 等数据
    - 筛选逻辑：底层资产匹配 + 稳定币单币池 + isTransactional
*   **B3: 交易构建器** — `src/background/brain.ts` > `buildDepositTransaction()`
    - 调用 `li.quest/v1/quote` 获取跨链 payload
*   **B4: 自然语言回复** — `src/background/brain.ts` > `generateBotReply()`
    - 拆分展示 Base APY / Reward APY / Total APY，已修复 null 处理
*   **消息路由** — `src/background/index.ts`
    - 处理 SNIFF_MATCH / USER_ASK / BUILD_TRANSACTION 三种 action

### 模块 C：Web3 Passkey 签名与执行层 — Claude 完成
*   **C1: Wagmi 配置** — `src/lib/wagmi-config.ts`
    - wagmi `2.12.0` + viem `2.21.54` 稳定组合
    - 连接器：`coinbaseWallet({ preference: { options: "smartWalletOnly" } })`
    - 支持链：Ethereum / Base / Arbitrum / Optimism
*   **C2: 交易执行桥接** — `src/components/WalletExecutor.tsx`
    - 隐形组件，监听 `coinbuddy:execute-tx` 自定义事件
    - 自动连接 → Passkey 生物识别签名 → 发送交易
    - 结果通过 `coinbuddy:tx-result` 事件回传，触发 Done 庆祝状态

---

## 核心接口定义 (Interfaces)

使用 Chrome Message Bus:

### 1. 嗅探命中 (Content -> Background)
```typescript
{
  action: "SNIFF_MATCH",
  payload: { contextText: "...", keywords: ["..."] }
}
// Response
{ status: "success", petState: "alert", suggestedReply: "..." }
```

### 2. 用户交互与分析 (Content -> Background)
```typescript
// Request
{ action: "USER_ASK", payload: { text: "..." } }
// Response 
{ status: "success", petState: "thinking", reply: "...", transactionPayload: { ... } }
```

### 3. Builder 请求 (Content -> Background)
```typescript
// Request
{ action: "BUILD_TRANSACTION", payload: { fromChain: 1, toToken: "0x...", fromAmount: "500" } }
// Response
{ status: "ready", txData: { /* LI.FI 的 payload */ } }
```

### 4. 交易执行 (Content 内部自定义事件)
```typescript
// 触发签名
window.dispatchEvent(new CustomEvent("coinbuddy:execute-tx", { detail: txPayload }))
// 结果回传
window.dispatchEvent(new CustomEvent("coinbuddy:tx-result", { detail: { success: true, hash: "0x..." } }))
```

---

## 项目文件结构

```
coinbuddy/
├── package.json                    # 依赖 + Chrome manifest 配置
├── tsconfig.json
├── .env.example                    # API Keys 模板
├── assets/
│   └── icon.png + icon{16,32,48,128}.png
├── src/
│   ├── popup.tsx                   # 插件弹出窗（简介页）
│   ├── contents/
│   │   └── coinbuddy-overlay.tsx   # 核心入口：Wagmi Provider + 宠物 + 聊天 + 嗅探
│   ├── components/
│   │   ├── PetAvatar.tsx           # Lottie 宠物 + 4 状态覆盖物
│   │   ├── ChatBubble.tsx          # 对话交互框
│   │   ├── WalletExecutor.tsx      # Wagmi 交易签名桥接
│   │   ├── styles.ts              # 全部 CSS（Shadow DOM 注入）
│   │   └── coinbuddy.css          # CSS 源文件（备份）
│   ├── background/
│   │   ├── index.ts               # Service Worker 消息路由
│   │   └── brain.ts               # 智能中枢 TS 版（LI.FI + 意图解析）
│   ├── lib/
│   │   ├── pet-state.ts           # PetState / ChatMessage 类型
│   │   ├── wagmi-config.ts        # Coinbase Smart Wallet 连接器配置
│   │   └── sniffer.ts             # DOM 嗅探引擎
│   └── assets/
│       └── coinbuddy-idle.json    # Lottie 呼吸动画
└── build/chrome-mv3-dev/          # 构建产物（加载到 Chrome）
```

---

## 关键依赖版本 & 踩坑记录

| 包名 | 锁定版本 | 说明 |
|------|---------|------|
| plasmo | ^0.90.5 | Chrome 插件框架，内置 Parcel 打包器 |
| wagmi | 2.12.0 | Web3 hooks，必须锁定此版本避免 Parcel 兼容问题 |
| viem | 2.21.54 | 以太坊交互库，配合 wagmi 2.12 |
| lottie-react | ^2.4.0 | Lottie 动画渲染 |
| canvas-confetti | ^1.9.3 | Done 状态彩带爆发 |
| @coinbase/wallet-sdk | ^4.3.0 | Smart Wallet Passkey 支持 |

**踩坑：** `get-intrinsic >= 1.3.0` 引入的 `math-intrinsics` 包含 `./isNaN` 导入，被 Parcel 误判为 Node 内置模块导致构建失败。**解决方案**：在 `pnpm.overrides` 中将 `get-intrinsic` 降级到 `1.2.4`，彻底移除 `math-intrinsics` 依赖。

---

## 下一步工作

- [ ] 接入真实 Gemini API 替换 `parseIntent()` 的 Mock 逻辑
- [ ] 端到端测试 Passkey 签名流程（需要 HTTPS 环境）
- [ ] UI/UX 美化：替换占位图标为正式 CoinBuddy 图标
- [ ] 录制 Demo 视频用于黑客松提交
