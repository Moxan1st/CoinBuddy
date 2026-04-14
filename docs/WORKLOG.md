# CoinBuddy 公共工作进展区

> **规则**: 每个 Agent 工作前必须读此文档了解最新进展，工作后必须在此追加总结并更新自己负责的文档。
> **格式**: 按时间倒序排列（最新在最上面）。每条记录包含：时间、角色、任务、结论、影响范围。

---

## 工作记录

---

### [2026-04-14 #009] 开发+API+架构 联合 — 协议过滤 + 语言修复（三方联合诊断）

**任务**: 用户测试"把我的USDT 存到morpho金库"返回 Aave V3 Optimism（错误协议/网络），回复语言偶尔变西班牙语。三方 Agent 联合诊断后统一修复。

**结论**:
- **根因1 (协议过滤缺失)**: `Intent` 类型无 `protocol` 字段，LLM Prompt 无提取指令，`fetchOptimalVault` 无 protocol 参数 → 用户说"morpho"被完全忽略
- **根因2 (语言切换)**: Prompt 仅说 "reply in same language"，遇到中文+拉丁混合输入 LLM 偶尔误判为西班牙语
- **根因3 (wallet NONE)**: overlay 组件 walletAddress 异步加载竞态（已有，本次未改，记录待办）

**修复内容**:
- `types/intent.ts`: Intent 接口加 `protocol?: string`
- `llm-client.ts` ROUTER_SYSTEM_PROMPT: 加 protocol 提取指令（invest/cross_deposit），加显式语言约束"只说中文和英文"，加 invest output format 示例
- `llm-client.ts` `extractInvestParamsFromText`: 加 16 个常见协议名正则匹配作为兜底
- `lifi-client.ts` `fetchOptimalVault`: 签名加 `protocol?: string`，filter 中 case-insensitive partial match `vault.protocol.name`，无匹配时 log warn 而非静默 fallback
- `handlers/invest.ts`: `hydrateInvestParamsWithDraft` 保留 protocol 字段，`fetchOptimalVault` 调用传入 protocol
- 所有其他调用点（composite、action-registry、tool-registry）无需改动（protocol 为 optional，不传则行为不变）

**影响范围**: `types/intent.ts`, `llm-client.ts`, `lifi-client.ts`, `handlers/invest.ts`

---

### [2026-04-14 #008] 开发+API+架构 联合 — Composer 能力完善（4 Phase）

**任务**: 根据 LI.FI 官方文档审查，修复 Composer 集成的 3 个严重缺陷

**结论**:
- **Phase 1**: 四个核心交易函数（deposit/swap/bridge/withdraw）添加 `slippage: 0.005` + `integrator: coinbuddy` 参数，composable batch 硬编码替换为常量
- **Phase 2**: `buildSwapTransaction` 返回结构统一为 `{txPayload, quoteSummary}`，添加 approve 步骤，修复 tool-registry.ts 的 `result.txPayload` undefined BUG
- **Phase 3**: `buildDepositTransaction` 返回结构统一为 `{txPayload, quoteSummary}`，添加 approve 步骤（判断 `fromToken !== ZERO_ADDRESS`），更新全部 5 个调用点
- **Phase 4**: 新增 `pollBridgeStatus` 函数（GET /v1/status，10s 间隔，最多 60 次），background 通过 `chrome.storage.onChanged` 监听跨链交易成功后自动启动轮询，结果写入 `coinbuddy_cross_chain_status`

**额外修复**: `buildSwapTransaction` 的 tool-registry.ts 调用点原本访问 `result.txPayload` 返回 undefined（现有 BUG），统一返回结构后自动修复

**影响范围**: `lifi-client.ts`, `brain.ts`, `handlers/invest.ts`, `handlers/swap.ts`, `handlers/composite.ts`, `index.ts`, `planner/action-registry.ts`, `agent/tool-registry.ts`, `types/plan.ts`

---

### [2026-04-14 #007] 开发 Agent — 实现"一键部署"自动化能力（3 处改动）

**任务**: 支持用户指令"把我的 USDC 按最省步骤部署到推荐金库"，实现 fromChain 自动推导 + Planner 多链余额查询 + 跨链参数显式传递

**结论**:
- **改动1 (invest.ts)**: 当用户未指定 fromChain 时，自动调用 `fetchWalletBalances` 查询 6 条主链余额，找到目标资产价值最高的链作为 fromChain
- **改动2 (planner)**: 新增 `check_balance_on_chains` action，让 ReAct Agent 能主动查多链余额后决策。同步更新 types/plan.ts、agent-planner.ts、action-registry.ts、step-executor.ts
- **改动3 (lifi-client.ts)**: `buildDepositTransaction` 显式传递 `allowExchanges=true` + `allowDestinationCall=true`，不依赖 API 默认值

**影响范围**: `handlers/invest.ts`, `lifi-client.ts`, `planner/agent-planner.ts`, `planner/action-registry.ts`, `planner/step-executor.ts`, `types/plan.ts`

---

### [2026-04-14 #006] 开发 Agent — P0 修复 + 钱包余额端点修复

**任务**: 修复 bridge.ts logger 未导入(P0) + fetchWalletBalances 端点 404(P1)

**结论**:
- **P0 修复**: `handlers/bridge.ts` 添加 `import { createLogger } from "~lib/logger"` + `const logger = createLogger("BridgeHandler")`
- **P1 修复**: `fetchWalletBalances` URL 从废弃的 `/v1/balances` 更新为 `/v1/wallets/{addr}/balances?extended=true`，修正响应解析(`data.balances`)、价格字段(`priceUSD`)、金额转换(wei→human)

**影响范围**: `handlers/bridge.ts`, `lifi-client.ts`

---

### [2026-04-14 #005] API 专家 — Phase 2-4 证据链测试（8 个功能）

**任务**: 对 vault_detail, swap, bridge, strategy_create, invest, cross_deposit, withdraw, withdraw_bridge 执行完整证据链测试

**结论**:
- **功能 10 vault_detail**: PASS — selectionIndex→selectedVault→API 完整
- **功能 6 swap**: PASS — 50 USDC→49.97 USDT，transactionRequest 完整
- **功能 7 bridge**: PASS — Base→Arbitrum，Eco 桥路由，99.75 USDC
- **功能 14 strategy_create**: PASS — LLM 正确识别 lte，BTC→cbBTC 映射正确
- **功能 3 invest**: PASS — yo-protocol quote 成功，toToken=vault.address 验证通过
- **功能 4 cross_deposit**: PASS — Ethereum→Base 4 步路由，100 USDC→92.70 yoUSD
- **功能 8 withdraw**: 条件 PASS — Quote API 可行，但代码被 isRedeemable=False 阻断
- **功能 9 withdraw_bridge**: 条件 PASS — LLM 正确识别两步流程，同受 isRedeemable 阻断

**新发现问题**:
- **P1**: LLM 有时将 amount 返回为已拼接 decimals 的值（如 "100000000" 而非 "100"），若代码再拼接会导致金额膨胀
- **P1**: yo-protocol 金库 isRedeemable=False 但 Quote API 实际可构建提现交易（通过 swap），代码的 isRedeemable 守卫过严
- **P2**: morpho RE7USDC 因 price impact 11.3% 超限导致 quote 失败，UI 应有友好提示

**影响范围**: `lifi-client.ts`, `handlers/withdraw.ts`, `handlers/invest.ts`, LLM prompt

---

### [2026-04-14 #004] API 专家 — Phase 1 证据链测试（6 个功能）

**任务**: 对 chains, protocols, stablecoin, portfolio, token_price, compare 执行完整 4 步证据链测试（LLM→Intent→API构建→API调用）

**结论**:
- **功能 11 chains**: PASS — 16 条链，LLM 意图识别正确
- **功能 12 protocols**: PASS — 11 个协议，LLM 意图识别正确
- **功能 2 stablecoin**: PASS（附 P2 问题）— API 的 tags=stablecoin 过滤不严格，后 3/5 个 vault 不含 stablecoin tag
- **功能 5 portfolio**: 部分 PASS — Earn 持仓 API 正常（发现 yo-protocol 上 USDC 持仓），但 `li.quest/v1/balances` 返回 **404**
- **功能 13 token_price**: PASS — BTC→WBTC 映射正确，返回 $74,542
- **功能 1 compare**: PASS — 全局和 Base 链搜索均返回正确 USDC 金库

**新发现问题**:
- **P1**: `li.quest/v1/balances` 端点返回 404，用户无法查看钱包原生代币余额（代码有降级处理不会崩溃）
- **P2**: API 的 `tags=stablecoin` 不严格过滤，建议客户端二次过滤

**影响范围**: `lifi-client.ts` (fetchWalletBalances), `handlers/invest.ts` (stablecoin 过滤)

**输出文档**: 证据链待汇总到 `docs/api-integration.md`

---

### [2026-04-14 #003] API 专家 — API 集成全面审查

**任务**: 对照 LI.FI guide.md 检查所有 API 调用，确保核心场景覆盖

**结论**:
- 6 个核心场景（搜索/投资/跨链/持仓/提现/策略）**全部实现**
- 发现 **1 个 P0 问题**: `handlers/bridge.ts` 的 logger 未导入，行94/96 会运行时崩溃
- 发现 **3 个 P1 问题**: 缺少 nextCursor 分页、bridge.ts 金额字符串拼接风险、isTransactional 检查不严格
- Common Pitfalls 检查：URL 分离 ✅、GET 不是 POST ✅、toToken 用 vault.address ✅、分页 ❌、精度 ⚠️

**影响范围**: `lifi-client.ts`, `handlers/bridge.ts`, `quote-formatter.ts`

**输出文档**: `docs/api-integration.md`

**待办**:
- [ ] 修复 bridge.ts logger 导入 (P0)
- [ ] 添加 nextCursor 分页支持 (P1)
- [ ] 修复 bridge.ts 金额拼接 (P1)
- [ ] isTransactional === true 严格检查 (P1)

---

### [2026-04-14 #002] 架构师 — 核心架构分析

**任务**: 分析项目代码结构，输出核心架构文档，检查是否需要优化

**结论**:
- 项目约 11,000 行 TypeScript，模块化清晰
- 分层架构: UI → Background(消息路由) → Handlers(意图分发) → LiFi Client(API) → Agent/Planner(智能体)
- 状态管理: DialogueState(对话) + TransactionState(交易) + SessionCache(会话) + AgentState(智能体)
- Handler 路由优先级: strategy → invest → portfolio → composite → swap → bridge → withdraw
- 策略引擎: 完整状态机（armed → triggered → step1 → step2 → executed/failed_*）

**架构优化建议**:
- Draft 缓存需按 tab 隔离（当前全局变量可能串联）
- 缺乏交易回执确认（链上 polling）
- 浮点精度损失（应改用 BigInt）
- 仅内存级缓存（应加 chrome.storage.local 二级缓存）
- Planner 步骤数限 6（建议增加到 10）

**影响范围**: 全局架构理解

**输出文档**: `docs/architecture.md`

---

### [2026-04-14 #001] 项目负责人 — 项目总览与团队初始化

**任务**: 拉取 LI.FI guide.md，建立团队，初始化项目文档体系

**结论**:
- 项目定位: Chrome 扩展，自然语言驱动 DeFi 投资，赛道 AI × Earn (Track 2)
- 技术栈: Plasmo + React + wagmi/viem + LI.FI Earn API + Gemini/Qwen LLM
- 团队: 项目负责人 + 架构师 + API专家 + 前端专家 + 开发Agent
- 建立三份核心文档: project-overview.md, architecture.md, api-integration.md

**影响范围**: 项目文档体系建立

**输出文档**: `docs/project-overview.md`

---

## 当前待办汇总

> 从各工作记录的"待办"中汇总，完成后打 ✅ 并注明完成记录编号

### P0 — 立即修复
- [x] `handlers/bridge.ts` logger 未导入 → 运行时崩溃 (来源: #003, 完成: #006)

### P1 — 高优先级
- [ ] `lifi-client.ts` 添加 nextCursor 分页支持 (来源: #003)
- [ ] `handlers/bridge.ts` 金额字符串拼接修复 (来源: #003)
- [ ] `lifi-client.ts` isTransactional === true 严格检查 (来源: #003)
- [x] `lifi-client.ts` fetchWalletBalances 端点 404 — 已更新为 /v1/wallets/{addr}/balances (来源: #004, 完成: #006)
- [ ] LLM amount 字段预拼接问题 — prompt 需明确 amount 为人类可读数值 (来源: #005)
- [ ] `handlers/withdraw.ts` isRedeemable 守卫过严 — yo-protocol 可通过 swap 路径提现但被阻断 (来源: #005)

### P2 — 中优先级
- [ ] `handlers/invest.ts` stablecoin 搜索需客户端二次过滤 tags (来源: #004)
- [ ] Draft 缓存按 tab 隔离 (来源: #002)
- [ ] 交易回执链上确认 (来源: #002)
- [ ] 金额计算改用 BigInt (来源: #002)
- [ ] 添加 chrome.storage.local 二级缓存 (来源: #002)

### P3 — 技术债
- [ ] Token resolution 失败处理改进 (来源: #003)
- [ ] Quote 有效期验证 (来源: #003)
- [ ] 请求重试机制 (来源: #003)
- [ ] 补充 handler 集成测试 (来源: #002)

---

## Agent 工作规范

### 工作前
1. **必读** 本文档（WORKLOG.md）了解最新进展和待办
2. **必读** 与自己领域相关的文档:
   - 架构相关 → `docs/architecture.md`
   - API 相关 → `docs/api-integration.md`
   - 全局了解 → `docs/project-overview.md`
3. 检查"当前待办汇总"中是否有与本次任务相关的已知问题

### 工作后
1. 在"工作记录"区域**最上方**追加一条记录，编号递增
2. 记录格式:
   ```
   ### [日期 #编号] 角色 — 任务标题
   **任务**: 做了什么
   **结论**: 关键发现/结果
   **影响范围**: 修改了哪些文件/模块
   **输出文档**: 更新了哪份文档
   **待办**: 遗留的后续工作（如有）
   ```
3. 如有新的待办项，同步更新"当前待办汇总"
4. 如完成了已有待办项，标记 ✅ 并注明完成记录编号
5. 更新自己负责的文档（architecture.md / api-integration.md / 其他）
