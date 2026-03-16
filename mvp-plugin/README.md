# MVP OpenClaw Channel Plugin

最小可用的OpenClaw channel plugin，通过腾讯云IM（TIM）与用户通信。

## 功能特性

- ✅ TIM消息接收和发送
- ✅ 消息转发给AI Runtime
- ✅ AI回复通过TIM发送
- ✅ 消息日志记录（logs/messages.log）
- ✅ 简单的配置管理

## 目录结构

```
mvp-plugin/
├── package.json
├── tsconfig.json
├── openclaw.plugin.json
├── index.ts
├── src/
│   ├── channel.ts
│   ├── config-schema.ts
│   ├── tim-client.ts
│   ├── logger.ts
│   └── types.ts
└── logs/
    └── messages.log
```

## 安装依赖

```bash
cd /Users/wuwenjie/Documents/IdeaProjects/supra/mvp-plugin
npm install
```

## 配置

在OpenClaw配置文件中添加以下配置：

```yaml
channels:
  mvp:
    accounts:
      default:
        enabled: true
        tim_sdk_app_id: 1600131366
        tim_user_id: "openclaw_bot"
        tim_user_sig: "eJwtzMEKgjAYhuH..."
        debug: false
```

### 配置说明

- `tim_sdk_app_id`: 腾讯云IM应用ID
- `tim_user_id`: TIM用户ID（OpenClaw bot）
- `tim_user_sig`: TIM用户签名（UserSig）
- `debug`: 是否启用调试日志（可选，默认false）

## 使用方法

1. **启动OpenClaw**
   ```bash
   openclaw start
   ```

2. **加载plugin**
   ```bash
   openclaw plugin install ./mvp-plugin
   ```

3. **测试消息流程**
   - 用户通过TIM发送消息给 `openclaw_bot`
   - Plugin接收消息
   - AI生成回复
   - Plugin发送回复给用户

## 消息日志

所有消息都会记录到 `logs/messages.log` 文件中：

```
2026-03-14 16:30:45 | IN  | user1 | Hello, how are you? | received | MSG_1710447045_12345
2026-03-14 16:30:46 | OUT | user1 | I'm doing well, thank you! | sent | MSG_1710447045_12345
```

## MVP限制

- ❌ SecretKey暴露在配置中（安全风险）
- ❌ 无App Backend集成
- ❌ 无心跳和状态监控
- ❌ 无健康数据查询
- ❌ 只支持文本消息
- ❌ 只支持单聊

## 后续扩展

MVP验证成功后，可以逐步添加：
1. App Backend集成（安全、审计）
2. 健康数据查询（AI工具）
3. 心跳和状态监控
4. 消息去重和系统消息处理
5. 媒体消息支持

## 开发

### 类型检查

```bash
npm run type-check
```

### 调试

启用调试模式：

```yaml
channels:
  mvp:
    accounts:
      default:
        debug: true
```

查看日志文件：

```bash
tail -f logs/messages.log
```
