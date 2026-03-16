# Channel Plugin MVP Demo

本项目是一个用于演示如何为 [OpenClaw](https://github.com/openclaw/openclaw) 构建最小可行产品 (MVP) 渠道插件 (Channel Plugin) 的完整示例。通过集成腾讯云 IM (TIM)，实现用户终端与 OpenClaw AI 运行时的实时通信。

## 🎯 用途

本示例旨在展示：
1. 如何开发一个自定义的 OpenClaw Channel Plugin。
2. 如何使用第三方即时通讯云服务（腾讯云 IM）作为消息传输通道。
3. 如何在前端（用户侧）和后端（AI 侧）之间建立基于第三方 IM 的双向通信。

## 🏗️ 架构

项目由两个主要部分组成：

1. **`TimDemo/` (用户前端)**
   - 包含简单的 HTML/JS 前端页面，模拟真实用户。
   - 使用 `@tencentcloud/chat` SDK 连接到腾讯云 IM。
   - 允许用户登录并向 AI Bot 发送消息，同时接收 AI 的回复。

2. **`mvp-plugin/` (OpenClaw 插件)**
   - 作为一个标准的 OpenClaw Channel 插件运行。
   - 扮演 AI Bot 的角色，监听来自腾讯云 IM 的用户消息。
   - 将接收到的消息转发给 OpenClaw AI 运行时进行处理。
   - 接收 AI 运行时的回复，并通过腾讯云 IM 发送回给对应用户。

## 🚀 如何使用

### 1. 准备工作

您需要拥有腾讯云 IM 的 AppID 以及对应的用户账号（一个作为普通用户，一个作为 Bot）和生成的 UserSig。

### 2. 打开用户前端 (TimDemo)

前端是一个纯静态页面，无需安装任何依赖或启动本地服务，直接在浏览器中打开即可：
- 文件路径：`TimDemo/demo-esm.html`

在页面中填入普通用户的 ID 和对应的 UserSig 进行登录。

### 3. 安装与构建插件 (mvp-plugin)

首先将 `mvp-plugin` 目录上传或放置到您的服务器上。

进入插件目录并安装依赖、编译代码：

```bash
cd mvp-plugin
npm install
npm run build
```

在插件目录下，执行安装命令：

```bash
openclaw plugin install .
```

### 4. 配置并重启 OpenClaw

配置您的 `openclaw.json` 文件，在 `channels` 中添加如下配置：

```json
  "channels": {
    "mvp": {
      "enabled": true,
      "tim_sdk_app_id": 1234567890,
      "tim_user_id": "您的Bot账号ID",
      "tim_user_sig": "Bot的UserSig，可在腾讯后台工具生成",
      "debug": false
    }
  }
```
*注：`tim_sdk_app_id` 为您的腾讯云IM_AppID,是数字，不需要加引号。*

保存配置后，重启 OpenClaw 服务：

```bash
openclaw gateway restart
```

## ✅ 验证流程

1. **前端登录**：在浏览器中直接打开 `TimDemo/demo-esm.html` 文件，输入普通用户的 ID 和 UserSig，点击登录并确保连接成功。
2. **发送消息**：在页面中，向配置为 Bot 的 `tim_user_id`（例如 `openclaw_bot`）发送一条测试消息（如 "Hello"）。
3. **查看回复**：前端页面应能实时接收到并显示 AI Bot 的回复内容。
4. **检查日志**：
   - 使用命令 `openclaw logs --follow` 实时查看 OpenClaw 日志，确认消息被正确接收并交由 AI 处理。
   - 检查 `/tmp/openclaw` 目录下的日志文件，验证消息的收发记录。

## 🧠 插件原理解析

OpenClaw 作为一个 AI 运行时框架，通过 **Channel Plugin（渠道插件）** 与外部各个聊天平台（如微信、钉钉、企业微信、腾讯云IM等）进行对接。本 MVP 插件实现了这样一个双向通信的适配器，核心工作原理如下：

1. **生命周期管理**：插件实现了 OpenClaw 定义的 `ChannelPlugin` 接口。在 OpenClaw 启动加载插件时，会触发插件的初始化和启动生命周期，进行必要的资源分配。
2. **建立第三方连接**：启动时，插件利用配置（`openclaw.json`）中的 `tim_sdk_app_id`、`tim_user_id` 和 `tim_user_sig` 初始化腾讯云 IM 客户端，并以 Bot 的身份登录到腾讯云 IM 服务器。
3. **消息的接收与转换（Inbound）**：
   - 插件底层监听腾讯云 IM 的新消息事件。
   - 当用户（前端页面）发送消息给 Bot 账号时，插件捕获该消息，并将其从 TIM 格式转换为 OpenClaw 内部的标准消息对象（包括提取文本内容、发送者 ID 等），然后传递给 OpenClaw 核心进行 AI 处理。
4. **消息的发送（Outbound）**：
   - OpenClaw 内部的大模型/工作流处理完毕后，生成回复，并将标准回复对象传回给该插件。
   - 插件将回复内容重新封装成腾讯云 IM 要求的文本消息格式，通过 TIM 客户端发送回给指定的用户。

通过这种“适配器”机制，OpenClaw 可以解耦底层通信协议，无缝接入任何第三方消息渠道。

## 📝 目录结构简述

- `TimDemo/`
  - `demo-esm.html` - 前端静态演示页面（基于 ESModule），包含简单的聊天界面和腾讯云 IM 登录/收发消息逻辑。直接在浏览器打开即可。
- `mvp-plugin/`
  - `package.json` - 插件的 Node.js 依赖配置及构建脚本。其中 `openclaw` 字段声明了插件作为 Channel 的扩展点。
  - `openclaw.plugin.json` - OpenClaw 插件元数据描述文件，声明插件 ID、支持的 Channel 名称及配置 Schema 等信息。
  - `index.ts` - 插件入口文件，负责注册和暴露 Channel Plugin。
  - `src/` - 插件核心源代码目录
    - `channel.ts` - 核心逻辑：实现了 OpenClaw `ChannelPlugin` 接口，负责插件启停、连接 OpenClaw 与 TIM 的消息收发链路。
    - `tim-client.ts` - 封装了腾讯云 IM SDK 操作，包括登录、监听消息事件、发送消息等底层逻辑。
    - `config-schema.ts` - 定义并校验了插件在 `openclaw.json` 中的配置项结构。
    - `logger.ts` - 简单的日志记录封装工具。
    - `types.ts` - 相关的 TypeScript 类型定义文件。
