# CoinBuddy - 产品需求文档 (PRD)

## 1. 产品愿景与目标 (Vision & Goals)

**项目名称：** CoinBuddy
**产品形态：** Chrome 浏览器插件
**主要定位：** 长驻在用户浏览页面的“悬浮小宠物”，一个专注于 DeFi 收益（Yield）的智能语音/文本管家。
**口号 (Tagline)：** 你的浏览器 DeFi 养收益“电子宠物”。 (Business in the front, yield in the back.)
**黑客松目标：** 冲击 **Track 2 (AI × Earn)** 和 **Track 3 (DeFi UX Challenge)** 奖项。

**核心解决痛点：**
1. 发现机会的割裂感：用户在 X (Twitter) 等社交平台看到 yield 机会，需要经历繁琐的步骤（找官网、切链、Swap、存款）。
2. 信息差与风险忽视：用户只看高 APY，忽略了背后的无常损失（il-risk）、奖励占比（Reward APY）和历史波动。
3. Web3 的入门高墙：新用户极其讨厌保存 12 位助记词和复杂的钱包概念。

## 2. 目标用户 (Target Audience)

*   **Crypto Degen (经常刷推特的用户)：** 希望碎片化时间抓取 APY 机会，但又懒得进行多步操作的重度 DeFi 玩家。
*   **DeFi / Web2 新手：** 想要理财但没有加密基础的用户（直接用指纹 / Passkey 建钱包入场）。

## 3. 核心使用场景 (User Scenarios)

### 场景 A：上下文主动提议（Context-Aware Sniffing - 重点核心体验）
1. 用户漫无目的地刷 Twitter，刷到一条推文：“Morpho 的 USDC 池子今天年化抽风到 15% 了，速冲！”
2. 右下角的 CoinBuddy 在本地静默嗅探到了匹配关键词 `Morpho`, `USDC`, `15%`。
3. 它头上冒出一个显眼的惊叹号 **❗**。用户好奇点击，它弹框说：
   “**主人！推文提到的 Morpho 15% 收益里有 10% 是临时激励金（Reward APY）。如果你求稳，我帮你挑了同协议里 8% 的纯稳定币池。想要我直接把你闲置的闲钱存进去吗？**”
4. 用户顺势点击“确认执行”。
5. **极简签名流程：** 屏幕弹出 Coinbase Smart Wallet 面板，用户**直接使用设备的指纹 / FaceID (Passkey)** 解锁并一键确认交易（免去传统 MetaMask 的助记词步骤）。
6. 后台执行完毕，宠物撒花庆祝。

### 场景 B：主动询问与执行
用户在任意页面唤醒宠物，打字："帮我找个最稳妥的地方存点钱"。宠物拉取推荐列表后提示按下指纹购买。

## 4. 核心功能需求 (Feature Requirements)

### 4.1 UI 与交互 (前端宠物体态)
**视觉状态机：**
*   `闲置状态 (Idle)`: 悬浮在右下角，微动待机。
*   `警觉状态 (Alert)`: 侦测到嗅探关键词，跳跃并展示交互提示。
*   `聆听分析 (Thinking)`: 对话期间调大模型 API 时，显示思考动画。
*   `执行状态 (Working)`: 钱包签名/交易执行中时，在原地跑动并展示跨链/Swap进度。
*   `庆祝状态 (Done)`: 撒花庆祝。

### 4.2 网页嗅探系统 (Content Script Sniffer)
*   监听当前屏幕可视文本。
*   正则轻量筛选协议（Aave, Morpho）、资产（ETH, USDC）与关键词（APY）进行本地状态联动，拒绝侵入式修改用户页面。

### 4.3 AI 解析与集成 (RAG 增强)
*   将嗅探信息或用户意图，配合 `earn.li.fi/v1/earn/vaults` 筛选的数据，喂入 Gemini 大模型生成专业的投顾建议（必须附带风险解读 tags 拆分）。

### 4.4 交易闭环与无感钱包 (Smart Wallet) 
*   确认后调用 `GET li.quest/v1/quote` 生成跨链合并数据 payload。
*   调用 **Coinbase Smart Wallet**，用户无需有助记词，直接使用 Passkey 授权交易。

## 5. 项目技术栈规划 (Tech Stack)

*   **框架：** Plasmo + React + Tailwind CSS。
*   **交互动画：** Lottie SVG 或 CSS 帧动画。
*   **钱包交互：** 最新的 **Wagmi v2 + Coinbase Smart Wallet SDK**（抛弃 window.ethereum），实现原生的去中心化账户抽象 (Passkeys)。
*   **后端/AI：** Background Script 调用 Gemini API 获取意图。
*   **核心外部依赖：** LI.FI Earn Data API 与 Composer API。

## 6. 黑客松演讲/演示加分点 (USPs for Pitch)

1.  **“所见即所得”的伴随式理财：** 没有独立的 APP，它跟用户一起刷社区网络。
2.  **不随大流的理性投顾：** 利用 LI.FI 返回元数据拆分真实收益源，比粗暴展示的高效能更好抵御无常损失。
3.  **零门槛的极客体验 (The Real Mullet UX)：** 采用账户抽象 (Coinbase Smart Wallet)，将注册、登入和交易全部缩短为“按一下指纹”(Passkey)，直接让评委会心惊艳。

## 7. 开发里程碑 (Milestones - 5 Days)
1. **Day 1:** Plasmo 起步，完成 Content Script 宠物注入与状态机。
2. **Day 2:** 跑通后台 Gemini 与 LI.FI 链路，完成 Twitter 页面嗅探并与宠物联动。
3. **Day 3:** 重点对接 **Wagmi v2 与 Coinbase Smart Wallet**。
4. **Day 4:** 联调全链路：嗅探 -> 生成 AI 话术 -> 触发指纹验证 -> Composer 自动打包。
5. **Day 5:** UI/UX 重构美化动画，撰写资料并在推特上录制 Demo。

---

## 8. 当前进度 (截至 2026-04-09)

### 已完成
- Plasmo 脚手架搭建，dev/build 均可正常运行
- Lottie 呼吸动画宠物悬浮在页面右下角
- 4 种 CSS 动画状态机（Idle / Alert / Thinking / Done + confetti）
- 对话交互框（用户输入 + 机器人回复 + 交易确认按钮）
- DOM 嗅探器（关键词检测 + 滚动监听 + 防抖）
- Background Service Worker 消息路由
- Brain 智能中枢 TS 化，LI.FI Earn API 真实调用验证通过
- Wagmi v2 + Coinbase Smart Wallet (Passkey) 集成
- **已在 X (Twitter) 页面实测通过**：宠物渲染、聊天交互、LI.FI 数据返回均正常

### 待完成
- 接入真实 Gemini API（当前 `parseIntent()` 为 Mock）
- Passkey 签名端到端测试（需 HTTPS）
- 正式图标替换
- Demo 视频录制
