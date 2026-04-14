# CoinBuddy ReAct Agent 实施计划

## 目标

把当前的 `单次意图分类 -> 固定 handler` 架构，演进为 `轻量入口路由 -> ReAct agent runtime -> tool registry -> execution guard`。

目标结果：

- 简单请求仍可走低成本直达路径
- 复杂请求改为多步推理执行，不再要求 LLM 一次性输出完美 JSON
- 现有 `sanitizeIntent` 类补丁逐步退出主流程
- 已接入的 LI.FI / portfolio / quote / vault 查询能力全部收敛成 agent tools

---

## 一、当前代码基线

### 1. 真实请求入口

- 主入口：[src/background/index.ts](src/background/index.ts:753)
- 当前主链路：
  - `analyzeIntent(userText, conversationHistory)`
  - 简单意图走 `routeIntent`
  - 复杂意图走 `needs_plan -> generatePlan -> executePlan`

### 2. 已存在的 planner 雏形

- 计划生成：[src/background/planner/agent-planner.ts](src/background/planner/agent-planner.ts:47)
- 步骤执行：[src/background/planner/step-executor.ts](src/background/planner/step-executor.ts:171)
- 动作注册：[src/background/planner/action-registry.ts](src/background/planner/action-registry.ts:350)

这套实现已经证明：

- 现有 API 能力可以被统一包装成动作
- 复杂请求已经能局部绕过单次分类
- 但仍然依赖“一次生成完整 plan JSON”，本质上还不是 ReAct

### 3. 已接入且可复用的底层能力

在 [src/background/lifi-client.ts](src/background/lifi-client.ts:92) 到 [src/background/lifi-client.ts](src/background/lifi-client.ts:394) 已具备：

- `fetchOptimalVault`
- `fetchVaultComparison`
- `fetchVaultDetail`
- `checkBalance`
- `getERC20Balance`
- `buildDepositTransaction`
- `buildSwapTransaction`
- `buildBridgeTransaction`
- `buildWithdrawTransaction`
- `fetchPortfolio`
- `fetchTokenPrice`

结论：底层能力基本够支撑 ReAct，不需要先补一套新 API。

---

## 二、为什么当前 needs_plan 还不够

当前 `needs_plan` 路径的问题不是“不能多步”，而是“多步仍然是静态计划”。

### 当前模式

1. classifier 判断是复杂请求
2. planner 一次性输出完整 plan JSON
3. executor 线性执行
4. 中途只支持很弱的条件和确认暂停

### 这会带来的问题

- 仍然要求模型第一次就把动作序列、依赖、参数都写对
- tool observation 不能自然反哺下一步决策
- 一旦 planner 参数错了，只能整体失败
- 条件表达能力被限制在 whitelist 字段
- `withdraw -> bridge`、`compare -> choose -> deposit` 这类场景会继续诱发专门状态机

所以本次改造重点是：**把“先产出完整计划”改成“边看 observation 边决定下一步”**。

---

## 三、目标架构

目标结构如下：

1. `Intent Gate`
2. `Tool Registry`
3. `ReAct Runtime`
4. `Execution Guard`

### 1. Intent Gate

职责：只做轻路由，不做重结构化。

输出建议收敛成三类：

- `chat`
- `simple`
- `agent`

说明：

- `simple` 仍走现有 handler，覆盖低成本单步请求
- `agent` 进入 ReAct loop
- 旧的 `needs_plan` 可以短期保留，但内部语义改成 `agent`

### 2. Tool Registry

职责：把现有动作包装成标准工具，供 agent 调用。

建议统一接口：

```ts
export interface AgentTool<Input = unknown, Output = unknown> {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  safety: {
    readOnly: boolean
    requiresWallet?: boolean
    buildsTransaction?: boolean
    requiresConfirm?: boolean
  }
  run: (input: Input, ctx: AgentRuntimeContext) => Promise<Output>
}
```

### 3. ReAct Runtime

职责：运行 Thought / Action / Observation 循环。

循环模式：

1. 给模型系统提示、对话历史、可用工具、当前 scratchpad
2. 模型返回：
   - `tool_call`
   - 或 `final_answer`
3. runtime 执行 tool
4. 将 observation 追加到 scratchpad
5. 继续下一轮直到结束

### 4. Execution Guard

职责：把安全规则从 prompt 挪到 runtime。

必须在 runtime 强制执行：

- 没钱包不允许执行需要钱包的 tool
- `build_*` 类动作必须经过确认闸门
- 限制最大步数
- 限制工具调用次数
- 对失败 observation 做结构化回传，而不是直接崩流程

---

## 四、建议的目录与文件改造

### 新增文件

- `src/background/agent/types.ts`
- `src/background/agent/tool-registry.ts`
- `src/background/agent/runtime.ts`
- `src/background/agent/prompts.ts`
- `src/background/agent/state.ts`
- `src/background/agent/runtime.test.ts`
- `src/background/agent/tool-registry.test.ts`

### 修改文件

- `src/background/index.ts`
- `src/background/llm-client.ts`
- `src/background/handlers/index.ts`
- `src/background/planner/action-registry.ts`
- `src/types/intent.ts`
- `src/types/index.ts`

### 短期保留，后续下线

- `src/background/planner/agent-planner.ts`
- `src/background/planner/step-executor.ts`

---

## 五、Tool 设计

建议先把现有 action-registry 迁成 tool-registry，而不是推倒重来。

### 第一批必须具备的 tools

#### 1. `search_vaults`

当前问题：

- 现在更像 `search_best_vault`
- 只回单个 winner，不利于 agent 比较和纠错

建议输入：

```ts
{
  chainIds?: number[]
  asset?: string
  sortBy?: "apy" | "tvl"
  limit?: number
  tags?: string
}
```

建议输出：

```ts
{
  vaults: Vault[]
  count: number
  bestVault: Vault | null
}
```

实现策略：

- 内部优先调用 `fetchVaultComparison`
- 如果用户明确是“best”，由 tool 内部排序后返回
- 不再区分 `search_vaults` / `compare_vaults` 的职责边界过细问题

#### 2. `get_vault_detail`

保留现状，输出标准化：

```ts
{
  vault: Vault | null
  found: boolean
  isRedeemable?: boolean
}
```

#### 3. `fetch_portfolio`

输出建议补上可供 agent 使用的摘要：

```ts
{
  positions: PortfolioPositionSummary[]
  count: number
}
```

#### 4. `check_balance`

当前必须增强。

建议输入：

```ts
{
  chainId: number
  token: string
  requiredAmount?: string
  estimatedGasWei?: string
}
```

建议输出：

```ts
{
  sufficient: boolean
  balance: string
  nativeBalance: string
  requiredAmount: string
}
```

#### 5. `build_deposit`

保留，但 tool 输出必须标准化：

```ts
{
  txPayload: Record<string, unknown> | null
  ready: boolean
}
```

#### 6. `build_swap`

同上。

#### 7. `build_bridge`

同上，并保留 quote summary。

#### 8. `build_withdraw`

同上，并保留 quote summary。

#### 9. `fetch_price`

保留。

#### 10. `reply_user`

建议不要作为核心工具长期保留。

原因：

- ReAct runtime 最终回答本身就能由主模型输出
- 单独的 `reply_user` 会让系统多一层 LLM 嵌套调用

短期可以保留兼容，长期建议删掉。

### 第二批可选 tools

- `build_composable_batch`
- `resolve_token_address`
- `resolve_chain`
- `resolve_vault_from_context`

其中 `build_composable_batch` 很重要，适合让 agent 在识别到 `swap + deposit` 时直接选高级工具。

---

## 六、Agent Runtime 设计

### 1. State 定义

建议新增：

```ts
export interface AgentStepRecord {
  thought?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  observation?: Record<string, unknown>
  error?: string
}

export interface AgentRunState {
  userText: string
  lang: "zh" | "en"
  steps: AgentStepRecord[]
  pendingConfirmation?: {
    toolName: string
    toolInput: Record<string, unknown>
  } | null
  finalReply?: string
  transactionPayload?: Record<string, unknown> | null
}
```

### 2. 模型输出协议

不要再让模型输出整份 plan。

每一轮只允许输出一种结构：

```json
{"type":"tool_call","tool":"search_vaults","input":{"chainIds":[8453],"asset":"USDC"}}
```

或

```json
{"type":"final_answer","reply":"..."}
```

可选支持：

```json
{"type":"ask_user","reply":"..."}
```

### 3. Runtime Loop

建议伪代码：

```ts
for (let i = 0; i < MAX_STEPS; i++) {
  const decision = await agentThink(...)

  if (decision.type === "final_answer") break
  if (decision.type === "ask_user") break

  const tool = getTool(decision.tool)
  const guard = validateToolCall(tool, decision.input, ctx)

  if (!guard.ok) {
    appendObservation({ error: guard.error })
    continue
  }

  if (tool.safety.requiresConfirm) {
    persistPendingConfirmation(...)
    return previewToUser(...)
  }

  const observation = await tool.run(decision.input, ctx)
  appendObservation(observation)
}
```

### 4. 安全规则

必须 runtime 硬编码：

- `MAX_STEPS = 6` 或 `8`
- 单轮只允许一次 tool call
- 禁止调用不存在的 tool
- `build_*` 类动作默认 `requiresConfirm`
- 钱包未连接时，返回结构化错误 observation，而不是执行

---

## 七、入口改造方案

### 当前入口问题

入口对 `IntentResult` 依赖太重，[src/types/intent.ts](src/types/intent.ts:8) 承担了过多结构化负担。

### 改造建议

#### Phase 1

保留 `IntentResult`，但新增：

```ts
type IntentResult["type"] += "agent"
```

并把原 `needs_plan` 逐步改成 `agent`。

#### Phase 2

`analyzeIntent` 只返回：

- `chat`
- `simple_intent`
- `agent`

其中 `simple_intent` 可选带少量参数，避免再维护大型 JSON schema。

### index.ts 改造点

在 [src/background/index.ts](src/background/index.ts:976) 附近：

- 删除 `generatePlan/executePlan` 主接入
- 改为 `runAgentLoop`
- `confirm` 时恢复 pending tool call，而不是恢复 pending plan

---

## 八、现有状态机怎么迁

### 1. `pendingDepositDraft`

短期保留。

用途：

- UI 列表选择
- 用户二次确认
- 兼容旧 handler

但不要再让它主导复杂控制流。复杂请求由 agent memory 主导。

### 2. `pendingBridgeAfterWithdraw`

应逐步删除。

原因：

- 它是典型的专用两步状态机
- ReAct 天然可以把 `withdraw observation -> bridge action` 表达出来

短期兼容策略：

- 旧 `withdraw_bridge` handler 先保留
- 新 agent path 不再依赖该状态

### 3. compare selection / selectionProtocol

短期保留为 UI 辅助上下文。

长期建议：

- 让 agent 能从 `pendingDepositDraft.vaultChoices` 中引用候选
- 提供一个 context tool 或 runtime 注入 memory，而不是靠 regex 补丁

---

## 九、分阶段实施

## Phase 0：收口现状

目标：先把 planner/action 的已有成果收编成可迁移资产。

任务：

- 把 `action-registry.ts` 抽象改名为 `tool-registry.ts`
- 给每个 tool 增加 `description`、`inputSchema`、`safety`
- 统一输出 observation 结构

验收：

- 现有 tests 全过
- 不改用户路径

## Phase 1：接入 ReAct runtime

目标：让 `needs_plan` 请求不再走静态 plan，而是走 tool loop。

任务：

- 新增 `runtime.ts`
- 新增 agent prompt
- `index.ts` 接入 `runAgentLoop`
- `confirm` 逻辑切换到恢复 pending tool call

验收：

- `find best USDC vault on Base then deposit 1 USDC`
- `compare vaults and pick the best`
- `withdraw then bridge`

## Phase 2：迁移复杂业务分支

目标：把最脏的多步 handler 特例迁入 agent。

优先迁移：

- `withdraw_bridge`
- `compare -> vault detail -> invest`
- `swap -> deposit`

验收：

- 这些路径不再依赖专门 handler 状态机

## Phase 3：收缩 classifier 和 sanitizeIntent

目标：把“复杂结构化”从 classifier 移除。

任务：

- 缩短 `ROUTER_SYSTEM_PROMPT`
- 去掉大部分参数 auto-fix
- 只保留简单单步请求的轻提取

验收：

- `sanitizeIntent` 不再参与复杂请求主链路

## Phase 4：清理旧 planner

目标：删除冗余实现。

任务：

- 下线 `agent-planner.ts`
- 下线 `step-executor.ts`
- 移除 `needs_plan` 类型

---

## 十、测试计划

### 1. Tool Contract Tests

覆盖：

- 每个 tool 输入校验
- tool 输出结构
- 钱包缺失时的错误 observation

### 2. Runtime Tests

覆盖：

- 正常工具循环
- tool 失败后自我修正
- 达到最大步数
- 需要确认时暂停和恢复

### 3. Prompt/Scenario Tests

建议最少覆盖这些中文英文样例：

- `put 1 USDC in best vault on Base`
- `find the best vault and deposit into it`
- `compare Base USDC vaults, pick the highest APY one`
- `withdraw from my vault and bridge to Arbitrum`
- `if APY is below 4%, don't deposit`

### 4. 回归测试

必须验证原简单路径不回退：

- 单步 `swap`
- 单步 `bridge`
- 单步 `portfolio`
- 单步 `vault detail`

---

## 十一、风险与控制

### 风险 1：模型在 loop 中乱调用 build 类工具

控制：

- runtime safety guard
- `requiresConfirm`
- 工具白名单

### 风险 2：tool output 太松散，模型难以稳定消费

控制：

- 统一 observation schema
- 不把原始大对象直接裸回，保留摘要字段

### 风险 3：复杂请求迁移后影响简单路径时延

控制：

- 入口做 `simple` / `agent` 分流
- simple path 不进入 agent runtime

### 风险 4：多轮 agent 使状态管理更乱

控制：

- 单独定义 `AgentRunState`
- 不复用零散 pending 变量做主状态

---

## 十二、推荐的第一轮最小可交付

如果只做一轮最小 MVP，我建议范围严格控制为：

1. 新建 `tool-registry`
2. 新建 `runtime`
3. 只把 `needs_plan` 请求切到 ReAct
4. 只支持这些 tools：
   - `search_vaults`
   - `get_vault_detail`
   - `check_balance`
   - `build_deposit`
   - `build_withdraw`
   - `build_bridge`
   - `fetch_portfolio`
5. 保留旧 handler 全量兜底

这样就能先吃掉你最关心的问题：

- “找最好的 vault 然后存 1 USDC”
- “先取出再桥接”
- “先看结果再决定下一步”

同时风险最可控。

---

## 十三、实施顺序建议

建议按下面顺序做，不要并行大改：

1. 标准化 tool registry
2. 实现 runtime loop
3. 接入 `index.ts`
4. 跑通 `best vault then deposit`
5. 跑通 `withdraw then bridge`
6. 收缩旧 planner
7. 再清理 `sanitizeIntent`

---

## 十四、明确结论

### 1. 现有 API 能力是否足够给 ReAct agent 调用

足够做第一版，而且底层已经基本齐全。

### 2. 当前 needs_plan 是否已经等于 ReAct

不是。它是“静态多步计划”，不是“动态思考-行动循环”。

### 3. 是否建议基于 ReAct 重构

建议，而且应该基于现有 planner/action 成果平滑迁移，不要从零推翻。

### 4. 改造重点在哪

重点不在新增 API，而在：

- runtime loop
- tool schema 标准化
- 安全确认闸门
- classifier 降级

