import type { TIMInboundMessage, Logger } from "./types.js";

export class TIMClient {
  private connected = false;
  private messageHandlers: ((msg: TIMInboundMessage) => Promise<void>)[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdk: any = null;

  async connect(
    sdkAppId: number,
    userId: string,
    userSig: string,
    log?: Logger,
  ): Promise<void> {
    log?.info?.(`[TIMClient] Connecting: sdkAppId=${sdkAppId}, userId=${userId}`);

    // Dynamically import to avoid hard dependency at load time
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let TencentCloudChat: any;
    try {
      const mod = await import("@tencentcloud/chat");
      TencentCloudChat = mod.default ?? mod;
    } catch {
      log?.warn?.("[TIMClient] @tencentcloud/chat not installed — running in stub mode");
      this.connected = true;
      return;
    }

    this.sdk = TencentCloudChat.create({ SDKAppID: sdkAppId });

    // Register MESSAGE_RECEIVED listener BEFORE login
    this.sdk.on(TencentCloudChat.EVENT.MESSAGE_RECEIVED, (event: { data: unknown[] }) => {
      for (const rawMsg of event.data) {
        const parsed = TIMClient.parseMessage(rawMsg);
        if (parsed) {
          for (const handler of this.messageHandlers) {
            void handler(parsed).catch((err: unknown) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              log?.error?.(`[TIMClient] Message handler error: ${errMsg}`);
            });
          }
        }
      }
    });

    // Handle SDK ready/login success
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutId: NodeJS.Timeout | null = null;
      
      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        try {
          this.sdk?.off?.(TencentCloudChat.EVENT.SDK_READY, onSdkReady);
          this.sdk?.off?.(TencentCloudChat.EVENT.SDK_NOT_READY, onSdkNotReady);
        } catch {
          // ignore listener cleanup errors
        }
        fn();
      };

      timeoutId = setTimeout(() => {
        log?.error?.(`[TIMClient] Login timeout after 120s. SDK state: ${this.sdk ? "initialized" : "not initialized"}`);
        finish(() => reject(new Error("TIM login timeout")));
      }, 120_000);

      const onSdkReady = () => {
        log?.info?.("[TIMClient] SDK_READY event received");
        finish(resolve);
      };

      const onSdkNotReady = (err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.error?.(`[TIMClient] SDK_NOT_READY event: ${errMsg}`);
        finish(() => reject(new Error(`TIM SDK not ready: ${errMsg}`)));
      };

      this.sdk.on(TencentCloudChat.EVENT.SDK_READY, onSdkReady);
      this.sdk.on(TencentCloudChat.EVENT.SDK_NOT_READY, onSdkNotReady);

      log?.info?.("[TIMClient] Calling login...");
      // Some runtimes do not emit SDK_READY reliably; use login() resolution as success as well.
      void Promise.resolve(this.sdk.login({ userID: userId, userSig }))
        .then(() => {
          log?.info?.("[TIMClient] login() resolved");
          finish(resolve);
        })
        .catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          log?.error?.(`[TIMClient] login() rejected: ${errMsg}`);
          finish(() => reject(new Error(`TIM login failed: ${errMsg}`)));
        });
    });

    this.connected = true;
    log?.info?.(`[TIMClient] Connected successfully as ${userId}`);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    if (this.sdk) {
      try {
        await this.sdk.logout();
      } catch {
        // ignore logout errors during shutdown
      }
      this.sdk = null;
    }
    this.connected = false;
    this.messageHandlers = [];
  }

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: (msg: TIMInboundMessage) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  async sendTextMessage(toUserId: string, text: string): Promise<void> {
    if (!this.connected) {
      throw new Error("TIMClient is not connected");
    }
    if (!this.sdk) {
      // Stub mode — skip actual send
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const TencentCloudChat = (this.sdk as any).TencentCloudChat || (this.sdk.constructor as any);
    const message = this.sdk.createTextMessage({
      to: toUserId,
      conversationType: TencentCloudChat?.TYPES?.CONV_C2C ?? "C2C",
      payload: {
        text: text,
      },
    });
    await this.sdk.sendMessage(message);
  }

  static parseMessage(rawMsg: unknown): TIMInboundMessage | null {
    if (!rawMsg || typeof rawMsg !== "object") {
      console.log("[MVP] parseMessage failed: rawMsg is empty or not an object", rawMsg);
      return null;
    }

    const msg = rawMsg as Record<string, unknown>;

    try {
      const from = (msg.from ?? msg.From_Account ?? msg.fromAccount) as string | undefined;
      const to = (msg.to ?? msg.To_Account ?? msg.toAccount) as string | undefined;
      const msgSeq = String(msg.sequence ?? msg.MsgSeq ?? msg.msgSeq ?? "");
      const createTime = (msg.time ?? msg.MsgTime ?? msg.clientTime ?? 0) as number;

      if (!from || !to) {
        console.log("[MVP] parseMessage failed: missing from or to", { from, to, msg });
        return null;
      }

      // 调试：打印完整的原始消息结构
      console.log(`[MVP] Received raw message from ${from}:`, JSON.stringify(msg, null, 2));

      // TimDemo 发送的是普通文本消息（TIMTextElem），而不是我们预期的 CustomMessage。
      // 普通文本消息结构:
      // msg.payload = { text: "hello" }
      // 或者 msg.elements = [{ type: 'TIMTextElem', content: { text: "hello" } }]
      // 我们需要兼容解析它，而不仅仅是解析 custom message.

      let textContent = "";
      let msgTypeNum: 0 | 1 | 2 | 3 = 0;

      // 尝试解析作为普通文本消息 (TIMTextElem)
      const elements = msg.elements as Array<{ type: string; content?: { text?: string } }> | undefined;
      if (elements && Array.isArray(elements) && elements.length > 0) {
        const textElem = elements.find(e => e.type === 'TIMTextElem');
        if (textElem && textElem.content && textElem.content.text) {
          textContent = textElem.content.text;
        }
      } 
      // 尝试解析作为普通 payload.text
      else if (msg.payload && typeof msg.payload === 'object') {
        const payload = msg.payload as Record<string, unknown>;
        if (payload.text && typeof payload.text === 'string') {
          textContent = payload.text;
        }
      }

      if (textContent) {
        // 如果成功解析出普通文本消息
        const conversationId = (msg.conversationID ?? `C2C_${from}`) as string;
        const messageId = (msg.ID ?? `MSG_${createTime}_${msgSeq}`) as string;

        console.log(`[MVP] Successfully parsed plain text message from ${from}: ${textContent}`);
        return {
          conversation_id: conversationId,
          message_id: messageId,
          msg_seq: msgSeq,
          from_user_id: from,
          to_user_id: to,
          msg_type: msgTypeNum,
          content: { text: textContent },
          create_at: createTime,
          raw_payload: rawMsg,
        };
      }

      // 如果不是普通文本消息，继续原来的 CustomMessage 解析逻辑
      const msgBody = msg.payload as Record<string, unknown> | undefined;
      if (!msgBody) {
        console.log("[MVP] parseMessage failed: no payload and no plain text found");
        return null;
      }

      const dataStr = (msgBody["Data"] ?? msgBody["data"]) as string | undefined;
      if (!dataStr) {
         console.log("[MVP] parseMessage failed: payload missing data field (not a custom message)");
         return null;
      }

      let outerPayload: Record<string, unknown>;
      try {
        outerPayload = JSON.parse(dataStr) as Record<string, unknown>;
      } catch {
        console.log("[MVP] parseMessage failed: data field is not valid JSON", dataStr);
        return null;
      }

      const rawMsgType = outerPayload["msg_type"] ?? outerPayload["msgType"];
      msgTypeNum = parseInt(String(rawMsgType ?? "0"), 10) as 0 | 1 | 2 | 3;

      if (outerPayload["msg_type"] === "sys") {
        console.log("[MVP] parseMessage skipping system message");
        return null;
      }

      if (![0, 1, 2, 3].includes(msgTypeNum)) {
         console.log("[MVP] parseMessage failed: unsupported msgTypeNum", msgTypeNum);
         return null;
      }

      const innerContentStr = outerPayload["content"] as string | undefined;
      let innerContent: Record<string, unknown> = {};
      if (innerContentStr) {
        try {
          innerContent = JSON.parse(innerContentStr) as Record<string, unknown>;
        } catch {
          innerContent = { msg: innerContentStr };
        }
      }

      const text = innerContent["msg"] as string | undefined;

      const conversationId =
        (outerPayload["conversation_id"] as string | undefined) ??
        (innerContent["im_conversation_id"] as string | undefined) ??
        (msg.conversationID as string | undefined) ??
        `C2C_${from}`;

      const messageId =
        (outerPayload["message_id"] as string | undefined) ??
        (msg.ID as string | undefined) ??
        `MSG_${createTime}_${msgSeq}`;

      console.log(`[MVP] Successfully parsed custom message from ${from}: ${text}`);
      return {
        conversation_id: conversationId,
        message_id: messageId,
        msg_seq: msgSeq,
        from_user_id: from,
        to_user_id: to,
        msg_type: msgTypeNum,
        content: { text },
        create_at: createTime,
        raw_payload: rawMsg,
      };
    } catch (err) {
      console.log("[MVP] parseMessage exception:", err);
      return null;
    }
  }
}
