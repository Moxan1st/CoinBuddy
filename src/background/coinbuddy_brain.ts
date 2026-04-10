// background.js
// 模块 B5: 提供 Chrome Background Service Worker 的调用封装出口
// 这个文件将由 Claude 集成进 Plasmo 的后台进程中

// 引入大脑模块 (在 Plasmo 中可能是 import { CoinBuddyBrain } from "~background/coinbuddy_brain")
// const { CoinBuddyBrain } = require('./coinbuddy_brain.js');

/**
 * 监听来自 Content Script (或者 Popup) 的消息事件
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // 异步处理函数包装
    const handleRequest = async () => {
        try {
            switch(request.action) {
                case "SNIFF_MATCH":
                    await handleSniffMatch(request.payload, sendResponse);
                    break;
                case "USER_ASK":
                    await handleUserAsk(request.payload, sendResponse);
                    break;
                case "BUILD_TRANSACTION":
                    await handleBuildTransaction(request.payload, sendResponse);
                    break;
                default:
                    sendResponse({ status: "error", error: "UNKNOWN_ACTION" });
            }
        } catch (error) {
            console.error("[Background Error]", error);
            sendResponse({ status: "error", error: error.message });
        }
    };

    // 触发异步处理
    handleRequest();
    
    // 返回 true 告诉 Chrome 我们会异步调用 sendResponse
    return true; 
});

/**
 * 处理页面嗅探事件：大发现在！
 */
async function handleSniffMatch(payload, sendResponse) {
    console.log("收到嗅探匹配:", payload.contextText);
    
    // 我们可以在背景里让大脑偷偷分析这笔交易有没有坑
    // const intent = await CoinBuddyBrain.parseIntent(payload.contextText); ...
    
    sendResponse({
        status: "success",
        petState: "alert",
        suggestedReply: `主人！我看到由于有代币激励，这条推文提到的 ${payload.keywords.join(', ')}... 要我帮你买吗？`
    });
}

/**
 * 处理用户主动交互
 */
async function handleUserAsk(payload, sendResponse) {
    // 假设依赖对象已就绪
    // 1. 解析意图
    // const intent = await CoinBuddyBrain.parseIntent(payload.text);
    // 2. 拿数据
    // const vault = await CoinBuddyBrain.fetchOptimalVault(intent.toChainConfig, intent.searchAsset);
    // 3. 生成拟人回复
    // const reply = await CoinBuddyBrain.generateBotReply(vault);
    // 4. 打包 payload (准备工作)
    // const txPayload = await CoinBuddyBrain.buildDepositTransaction(...)
    
    // 返回给前端
    sendResponse({
        status: "success",
        petState: "thinking", // 应该在前台变为 thinking，然后这里返回回复后，前台变为对讲状态
        reply: "经过我仔细的测算...（这里填入实际的智库返回词）",
        transactionPayload: { /* txPayload */ }
    });
}

/**
 * 纯粹的跨链交易体构建接口
 */
async function handleBuildTransaction(payload, sendResponse) {
    // 从前端拿到当前连接的钱包等参数
    // const tx = await CoinBuddyBrain.buildDepositTransaction(...)
    
    sendResponse({
        status: "ready",
        txData: { /* LI.FI 的 transactionRequest */ }
    });
}

console.log("[CoinBuddy Background] Service Worker Activated.");
