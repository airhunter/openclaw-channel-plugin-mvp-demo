import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { mvpPlugin } from "./src/channel.js";

export default {
  id: "mvp-openclaw-plugin",
  name: "MVP TIM",
  description: "MVP 最小版本，通过腾讯云IM与用户通信。",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    api.registerChannel({ plugin: mvpPlugin });
  },
};
