import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";
import { DeepSeekSettings } from "./settings.ts";

export const deepSeekClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("deepseek"),
  label: "DeepSeek",
  modelFamilies: ["DeepSeek "],
  settingsSchema: DeepSeekSettings,
  icon: {
    viewBox: "0 0 24 24",
    fill: { light: "#4D6BFE", dark: "#7C93FF" },
    paths: [{ d: "M3 5h7a7 7 0 0 1 0 14H3V5zm4 4v6h3a3 3 0 0 0 0-6H7z" }],
  },
});
