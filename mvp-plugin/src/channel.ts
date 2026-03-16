import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk";
import type { ChannelMessageActionAdapter, OpenClawConfig, ChannelGatewayContext } from "openclaw/plugin-sdk";
import * as pluginSdk from "openclaw/plugin-sdk";
import { MVPConfigSchema } from "./config-schema.js";
import { TIMClient } from "./tim-client.js";
import { messageLogger } from "./logger.js";
import type { MVPConfig, Logger } from "./types.js";

const inboundStats = {
  received: 0,
  processed: 0,
  failed: 0,
};

const mvpMessageActions: ChannelMessageActionAdapter = {
  listActions: () => ["send"],
  supportsAction: ({ action }: { action: string }) => action === "send",
  extractToolSend: ({ args }: { args: unknown }) =>
    pluginSdk.extractToolSend(args as Record<string, unknown>, "sendMessage"),
  handleAction: async ({
    action,
    params,
    cfg,
  }: {
    action: string;
    params: unknown;
    cfg: OpenClawConfig;
    accountId?: string | null;
    dryRun?: boolean;
  }) => {
    if (action !== "send") {
      throw new Error(`Action ${action} is not supported for MVP TIM channel.`);
    }

    const to = pluginSdk.readStringParam(params as Record<string, unknown>, "to", { required: true });
    const message = pluginSdk.readStringParam(params as Record<string, unknown>, "message", {
      required: true,
      allowEmpty: false,
    });

    const config = getMVPConfig(cfg);
    const timClient = getTIMClient(cfg);

    try {
      await timClient.sendTextMessage(to, message);
      messageLogger.logOutbound(to, message);
      return pluginSdk.jsonResult({
        ok: true,
        to,
        message,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      messageLogger.logError("", to, message, errMsg);
      return pluginSdk.jsonResult({
        ok: false,
        error: errMsg,
        to,
        message,
      });
    }
  },
};

let timClientInstance: TIMClient | null = null;
let mvpConfigInstance: MVPConfig | null = null;

function getTIMClient(cfg: OpenClawConfig): TIMClient {
  if (!timClientInstance) {
    timClientInstance = new TIMClient();
  }
  return timClientInstance;
}

function getMVPConfig(cfg: OpenClawConfig): MVPConfig {
  if (!mvpConfigInstance) {
    const rawConfig = (cfg as Record<string, unknown>)["channels"]
      ? (((cfg as Record<string, unknown>)["channels"] as Record<string, unknown>)["mvp"] ?? {})
      : (cfg ?? {});

    const parseResult = MVPConfigSchema.safeParse(rawConfig);
    if (!parseResult.success) {
      throw new Error(`MVP config validation failed: ${parseResult.error.message}`);
    }
    mvpConfigInstance = parseResult.data;
  }
  return mvpConfigInstance!;
}

export const mvpPlugin = {
  id: "mvp",

  meta: {
    id: "mvp",
    label: "MVP TIM",
    selectionLabel: "MVP (腾讯云IM)",
    docsPath: "/channels/mvp",
    blurb: "MVP 最小版本，通过腾讯云IM与用户通信。",
    aliases: ["mvp", "tencent-im"],
  },

  configSchema: pluginSdk.buildChannelConfigSchema(MVPConfigSchema),

  capabilities: {
    chatTypes: ["direct"] as Array<"direct" | "group">,
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  reload: { configPrefixes: ["channels.mvp"] },

  config: {
    listAccountIds: (_cfg: OpenClawConfig): string[] => {
      return ["default"];
    },
    resolveAccount: (_cfg: OpenClawConfig, _accountId?: string | null) => {
      return {
        accountId: "default",
        config: {},
        enabled: true,
        configured: true,
        name: "MVP TIM",
      };
    },
    defaultAccountId: (): string => "default",
    isConfigured: (_account: unknown): boolean => true,
    describeAccount: (_account: unknown) => ({
      accountId: "default",
      name: "MVP TIM",
      enabled: true,
      configured: true,
    }),
  },

  security: {
    resolveDmPolicy: (_ctx: unknown) => ({
      policy: "open" as const,
      allowFrom: [] as string[],
      policyPath: "channels.mvp.dmPolicy",
      allowFromPath: "channels.mvp.allowFrom",
      approveHint: "MVP TIM channel: open to all users",
      normalizeEntry: (raw: string) => raw.replace(/^(mvp|tim|tencent-im):/i, ""),
    }),
  },

  messaging: {
    normalizeTarget: (raw: string) =>
      raw ? raw.replace(/^(mvp|tim|tencent-im):/i, "") : undefined,
    targetResolver: {
      looksLikeId: (id: string): boolean => /^[\w\-_]+$/.test(id),
      hint: "<user_id>",
    },
  },

  actions: mvpMessageActions,

  outbound: {
    deliveryMode: "direct" as const,
    resolveTarget: ({ to }: { to?: string }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false as const,
          error: new Error("MVP TIM message requires --to <user_id>"),
        };
      }
      const resolved = trimmed.replace(/^(mvp|tim|tencent-im):/i, "");
      return { ok: true as const, to: resolved };
    },
    sendText: async ({ to, text, cfg, log }: { cfg: OpenClawConfig; to: string; text: string; accountId?: string | null; log?: Logger }) => {
      const config = getMVPConfig(cfg);
      const timClient = getTIMClient(cfg);

      try {
        await timClient.sendTextMessage(to, text);
        messageLogger.logOutbound(to, text);
        log?.info?.(`[MVP] Sent message to ${to}: ${text}`);
        return { channel: "mvp-openclaw-plugin", messageId: `mvp-${Date.now()}` };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        messageLogger.logError("", to, text, errMsg);
        log?.error?.(`[MVP] Failed to send message to ${to}: ${errMsg}`);
        throw new Error(errMsg);
      }
    },
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext<any>): Promise<{ stop: () => void }> => {
      const { cfg, log, abortSignal } = ctx;

      const config = getMVPConfig(cfg);
      const timClient = getTIMClient(cfg);

      log?.info?.(`[MVP] Starting MVP TIM channel...`);

      if (abortSignal?.aborted) {
        throw new Error("Aborted before TIM connection");
      }

      await timClient.connect(config.tim_sdk_app_id, config.tim_user_id, config.tim_user_sig, log);

      timClient.onMessage(async (msg) => {
        inboundStats.received++;

        try {
          messageLogger.logInbound(msg.message_id, msg.from_user_id, msg.content.text ?? "");

          // Forward to AI Runtime via ctx.channelRuntime (OpenClaw standard gateway pattern)
          const inboundText = msg.content.text ?? "";
          if (!inboundText) {
            inboundStats.processed++;
            return;
          }

          if (!ctx.channelRuntime) {
            log?.warn?.(`[MVP] channelRuntime not available, skipping AI dispatch for ${msg.from_user_id}`);
            inboundStats.failed++;
            return;
          }

          log?.info?.(`[MVP] Dispatching message to AI runtime for user ${msg.from_user_id}: ${inboundText}`);

          const route = ctx.channelRuntime.routing.resolveAgentRoute({
            cfg,
            channel: "mvp",
            accountId: "default",
            peer: { kind: "direct", id: msg.from_user_id },
          });

          // Core OpenClaw internal dispatch requirement
          const finalizedCtx = ctx.channelRuntime.reply.finalizeInboundContext({
            Body: inboundText,
            BodyForAgent: inboundText,
            CommandBody: inboundText,
            RawBody: inboundText,
            From: `mvp:user:${msg.from_user_id}`,
            To: `mvp:bot:default`,
            SessionKey: route.sessionKey,
            AccountId: "default",
            ChatType: "direct",
            Provider: "mvp",
            Surface: "mvp",
            MessageSid: msg.message_id,
            Timestamp: msg.create_at * 1000,
            OriginatingChannel: "mvp",
            OriginatingTo: msg.from_user_id,
          } as any);

          await dispatchInboundReplyWithBase({
            cfg,
            channel: "mvp",
            accountId: "default",
            route: {
              agentId: route.agentId,
              sessionKey: route.sessionKey,
            },
            storePath: ctx.channelRuntime.session.resolveStorePath(cfg.session?.store, { agentId: route.agentId }),
            ctxPayload: finalizedCtx,
            core: { channel: ctx.channelRuntime } as any,
            deliver: async (payload) => {
              if (payload.text) {
                await timClient.sendTextMessage(msg.from_user_id, payload.text);
                messageLogger.logOutbound(msg.from_user_id, payload.text, msg.message_id);
                log?.info?.(`[MVP] Sent reply to ${msg.from_user_id}: ${payload.text}`);
              }
            },
            onRecordError: (err) => {
              log?.error?.(`[MVP] Inbound session record error: ${err}`);
            },
            onDispatchError: (err, info) => {
              log?.error?.(`[MVP] AI dispatch error (${info.kind}): ${err}`);
            }
          });

          log?.info?.(`[MVP] dispatch complete for ${msg.from_user_id}`);
          inboundStats.processed++;
        } catch (err: unknown) {
          inboundStats.failed++;
          const errMsg = err instanceof Error ? err.message : String(err);
          messageLogger.logError(msg.message_id, msg.from_user_id, msg.content.text ?? "", errMsg);
          log?.error?.(`[MVP] Failed to process message ${msg.message_id}: ${errMsg}`);
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.setStatus({
        ...(ctx.getStatus() as Record<string, unknown>),
        running: true,
        lastStartAt: Date.now(),
        lastError: null,
      } as any);

      log?.info?.(`[MVP] MVP TIM channel started successfully`);

      let stopped = false;
      let resolveStop: () => void;
      
      const stopPromise = new Promise<void>((resolve) => {
        resolveStop = resolve;
      });

      // Listen for abort signal from gateway
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => {
          if (!stopped) {
             void timClient.disconnect();
             resolveStop();
          }
        });
      }

      // Block until stopped
      await stopPromise;
      
      return {
        stop: () => {
          if (stopped) {
            return;
          }
          stopped = true;
          log?.info?.(`[MVP] Stopping MVP TIM channel...`);
          void timClient.disconnect().catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            log?.warn?.(`[MVP] Error during TIM disconnect: ${errMsg}`);
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx.setStatus({
            ...(ctx.getStatus() as Record<string, unknown>),
            running: false,
            lastStopAt: Date.now(),
          } as any);
          log?.info?.(`[MVP] MVP TIM channel stopped`);
          if (resolveStop) resolveStop();
        },
      };
    },
  },

  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastEventAt: null,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (_accounts: unknown[]) => {
      return [];
    },
    buildChannelSummary: ({ snapshot }: { snapshot?: Record<string, unknown> | null }) => ({
      configured: true,
      running: snapshot?.["running"] ?? false,
      lastStartAt: snapshot?.["lastStartAt"] ?? null,
      lastStopAt: snapshot?.["lastStopAt"] ?? null,
      lastError: snapshot?.["lastError"] ?? null,
    }),
    probeAccount: async (_ctx: unknown) => {
      return { ok: true, details: { channel: "mvp-tim" } };
    },
    buildAccountSnapshot: ({
      account,
      runtime,
      snapshot,
    }: {
      account: { accountId: string; name?: string; enabled: boolean; configured: boolean };
      runtime?: Record<string, unknown> | null;
      snapshot?: Record<string, unknown> | null;
      probe?: unknown;
    }) => {
      const running = Boolean(runtime?.["running"] ?? snapshot?.["running"]);
      return {
        accountId: account.accountId,
        name: account.name ?? "MVP TIM",
        enabled: account.enabled,
        configured: account.configured,
        running,
        lastEventAt: running ? Date.now() : (runtime?.["lastEventAt"] ?? snapshot?.["lastEventAt"] ?? null) as number | null,
        lastStartAt: (runtime?.["lastStartAt"] ?? snapshot?.["lastStartAt"] ?? null) as number | null,
        lastStopAt: (runtime?.["lastStopAt"] ?? snapshot?.["lastStopAt"] ?? null) as number | null,
        lastError: (runtime?.["lastError"] ?? snapshot?.["lastError"] ?? null) as string | null,
      };
    },
  },
};
