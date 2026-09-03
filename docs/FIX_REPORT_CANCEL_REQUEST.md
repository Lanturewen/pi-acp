# `pi-acp` 会话卡死问题分析与修复报告

## 1. 问题背景与现场现象

在 Zed 编辑器中使用 Agent 面板执行审查指令（如 `20260903_h207_pipeline_review.md 进行final gate`）时，发生如下异常：
1. **界面卡死**：面板顺序执行完 3 次本地文件的 `read` 操作后，停留在加载指示器（`⠂`），无限期转圈，不再产生任何输出。
2. **刹车失灵**：用户尝试点击界面上的停止/取消按钮时，界面毫无反应，无法正常终止挂起的任务，只能强行关闭或重开窗口。

---

## 2. 根因剖析（结合日志与代码）

通过排查 `~/.pi/agent/sessions/` 会话日志、Zed 运行日志（`~/Library/Logs/Zed/Zed.log`）及源码，确认是由**两个独立问题叠加**导致：

### 核心原因 1：大模型上游 API 请求静默挂起（网络层假死）
- 前 3 次 `read` 为本地磁盘读取，几毫秒内完成。
- 第 4 步将读取的 3 个规范文档（累计超 8 万字符、1.6 万 tokens）一次性组装为大 Payload，通过本地代理（`127.0.0.1:7897`）向 Google Antigravity 服务发起 SSE 流式请求。
- 传输途中发生静默断流（TCP Half-open / Silent Stall），服务端没有及时回包，也没有发送 FIN/RST 中断包；而客户端流式读取缺乏超时断开机制，导致底层请求无限期挂起。

### 核心原因 2：Zed 取消协议不匹配（刹车失灵）
在 `Zed.log` 中捕获到明确报错：
```text
WARN agent stderr: Error handling notification {
  method: '$/cancel_request',
  params: { requestId: '...' }
}
code: -32601, message: "Method not found: $/cancel_request"
```
- **协议方言冲突**：Zed 触发取消时，发送的是通用 LSP 风格的通知 `$/cancel_request`（携带请求 ID）；而官方 ACP 协议标准定义的取消命令是 `session/cancel`（携带会话 ID）。
- **结果**：`pi-acp` 原版没有注册 `$/cancel_request`，直接以 `-32601 Method not found` 拒绝。导致用户在前端点击 Stop 时，取消信号根本没有传达到底层 `pi` 引擎，无法终止卡住的 HTTP 请求。

---

## 3. 完成的修复工作

针对上述问题，在 `~/.local/src/pi-acp` 源码中构建了**三层防御修复体系**，并补充了全套测试：

### 改动 1：流管道层协议拦截与改写 (`src/index.ts`)
- 在数据流入口维护 `requestId -> sessionId` 状态映射表。
- 当监听到 Zed 发出的 `$/cancel_request` 时，**自动将其翻译改写为标准的 ACP `session/cancel` 通知**，直接接入官方标准取消逻辑，消除协议方言差异。

### 改动 2：适配器接口注册与兜底 (`src/acp/agent.ts`)
- 实现了 ACP SDK 的 `extNotification` 与 `extMethod` 扩展接口，主动声明接管 `$/cancel_request`，彻底消除了控制台 `-32601` 报错。
- 提供模糊匹配兜底：若特定 `requestId` 映射未命中，自动检索并取消当前正在 active 执行中的会话。

### 改动 3：会话层 3 秒防假死强制结算 (`src/acp/session.ts`)
- 为 `session.cancel()` 增加了 `proc.abort()` 的异常捕获保护。
- 新增 **3 秒超时强制兜底机制**：若底层进程或网络库因极端阻塞无法产生结算事件，3 秒后强制完成结算并向 Zed 上报 `cancelled`，确保前端绝对能停下并恢复输入。

### 改动 4：自动化与测试保障
- 新增了专项组件测试用例（`test/component/cancel-request.test.ts`），项目全套 **106 项测试全部通过（PASS）**。
- 在 `package.json` 中配置了 `"prepare": "npm run build"`，支持通过 Git 链接安装时自动构建。

---

## 4. 多电脑同步与维护指南

已将全套修复代码推送至个人 GitHub 仓库：**`https://github.com/Lanturewen/pi-acp.git`**。

### A. 在其他电脑上安装或覆盖
在新电脑或已有旧版 `pi-acp` 的电脑上，直接运行以下单行命令即可全局覆盖升级：
```bash
npm install -g --force https://github.com/Lanturewen/pi-acp.git
```
*(npm 会自动拉取源码、自动执行编译，并将修复后的 `pi-acp` 命令软链至全局 PATH)*

### B. 以后如何同步原作者（上游 upstream）的更新
本地仓库已配置 `origin`（个人仓库）和 `upstream`（原作者仓库）。当原作者发布新版本时，在当前电脑执行标准三步即可完成同步：

```bash
cd ~/.local/src/pi-acp

# 1. 拉取原作者的最新代码
git fetch upstream

# 2. 将原作者更新合并进你的 main 分支（保留个人修复）
git merge upstream/main

# 3. 运行测试验证并推送到个人 GitHub
npm test && npm run build
git push origin main
```
推送后，在其他电脑上再次执行 `npm install -g --force https://github.com/Lanturewen/pi-acp.git` 即可全设备同步。
