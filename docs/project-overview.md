# CoinBuddy 项目总览

> **维护者**: 项目负责人 | **更新日期**: 2026-04-14
> **所有人处理后续任务前必读此文档**
> **工作前还须阅读**: [`docs/WORKLOG.md`](WORKLOG.md) — 公共工作进展区

---

## 1. 项目定位

**CoinBuddy** — 你的 DeFi 伙伴宠物。

一个 Chrome 扩展，让用户通过自然语言对话完成 DeFi 投资操作。核心理念："Business in the front, yield in the back"（DeFi Mullet）。用户只需说"存 500 USDC 到最高收益的金库"，CoinBuddy 自动完成搜索、比较、构建交易、跨链桥接等所有复杂操作。

**赛道**: DeFi Mullet Hackathon #1 — AI × Earn（Track 2）

**技术栈**: Plasmo + React + wagmi/viem + LI.FI Earn API + Gemini/Qwen LLM

---

## 2. 核心能力

| 能力 | 描述 | API 依赖 |
|------|------|---------|
| 🔍 智能搜索 | 自然语言搜索最优 Vault（按链/资产/APY/TVL） | Earn Data API |
| 💰 一键投资 | 选择 Vault → 自动构建交易 → 一键签名 | Composer |
| 🌉 跨链投资 | 任意链任意代币 → 目标 Vault（自动 swap+bridge+deposit） | Composer |
| 📊 持仓管理 | 查看所有 DeFi 持仓及收益 | Earn Data API |
| 🏧 提现 + 跨链 | 从 Vault 提现并跨链回主链（两步协调） | Composer |
| 🤖 自动策略 | 价格触发自动交易（如 BTC<70000 时买入并存入 Vault） | Composer |
| 🔄 代币交换 | 链内 Swap | Composer |
| 📋 多步计划 | LLM 自动分解复杂请求为多步执行计划 | 全部 |

---

## 3. 团队分工

| 角色 | 职责 | 输出文档 |
|------|------|---------|
| **项目负责人** | 总体协调、任务分配、进度跟踪 | `docs/project-overview.md`（本文档） |
| **架构师 Agent** | 代码结构分析、架构优化、模块设计 | `docs/architecture.md` |
| **API 专家 Agent** | API 集成审查、问题发现、覆盖率检查 | `docs/api-integration.md` |
| **前端专家 Agent** | UI/UX 实现、组件开发 | 待派任务时输出 |
| **开发 Agent** | Bug 修复、功能实现 | 按任务输出 |

---

## 4. 当前状态与已知问题

### 4.1 需立即修复（P0）

| # | 问题 | 文件 | 影响 |
|---|------|------|------|
| 1 | bridge.ts 中 logger 未导入 | handlers/bridge.ts:94,96 | 运行时崩溃 |

### 4.2 高优先级修复（P1）

| # | 问题 | 影响 |
|---|------|------|
| 2 | Vault 列表分页未实现 nextCursor | 只能看首页结果，672+ vaults 无法遍历 |
| 3 | bridge.ts 金额字符串拼接风险 | 可能生成错误交易金额 |
| 4 | isTransactional 检查不严格 | 可能操作不可交易的 vault |

### 4.3 架构层面建议

- Draft 缓存需要按 tab 隔离防止串联
- 添加交易回执确认（链上 polling）
- 金额计算改用 BigInt 避免精度丢失
- 添加二级缓存（chrome.storage.local）

---

## 5. 项目文件结构

```
coinbuddy/
├── src/
│   ├── background/          # Service Worker 核心
│   │   ├── index.ts         # 主入口 + 消息路由
│   │   ├── brain.ts         # Facade 聚合
│   │   ├── lifi-client.ts   # LI.FI API
│   │   ├── llm-client.ts    # LLM 调用
│   │   ├── handlers/        # 意图处理器 (7个)
│   │   ├── planner/         # 多步计划引擎
│   │   └── agent/           # ReAct 智能体
│   ├── strategy/            # 自动化策略引擎
│   ├── components/          # React UI 组件
│   ├── contents/            # Content Scripts
│   ├── hooks/               # React Hooks
│   ├── lib/                 # 工具库
│   ├── types/               # 类型定义
│   └── popup.tsx            # Popup 入口
├── docs/                    # 项目文档（本目录）
├── landing/                 # Landing Page
├── public/                  # 静态资源
└── package.json             # Plasmo 扩展配置
```

---

## 6. 关键命令

```bash
pnpm dev          # 启动开发服务器
pnpm build        # 构建扩展
pnpm test         # 运行测试
pnpm package      # 打包发布
```

---

## 7. 必读文档清单

处理任何后续任务前，请按顺序阅读：

1. **本文档** (`docs/project-overview.md`) — 项目全貌
2. **架构文档** (`docs/architecture.md`) — 代码结构与数据流
3. **API 集成文档** (`docs/api-integration.md`) — API 调用详情与已知问题
4. **LI.FI 官方 Guide** — 外部文档，API 行为以实际响应为准

---

## 8. 工作规范

1. **修改代码前**先读对应模块的文档和源码
2. **API 调用**以 `lifi-client.ts` 为唯一出口，不直接在 handler 中 fetch
3. **新增 handler**需要在 `handlers/index.ts` 的 orderedHandlers 中注册
4. **金额计算**注意 decimals（USDC=6, ETH=18），用原始单位（最小单位）
5. **测试**在修改后运行 `pnpm test` 确保不回归
6. **两个 base URL 不能混用**: earn.li.fi (数据) vs li.quest (交易)
