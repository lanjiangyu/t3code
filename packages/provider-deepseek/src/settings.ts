import {
  CustomModelSetting,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
  TrimmedString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const DeepSeekSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("dsh"),
    defaultModel: Schema.Literals(["deepseek-flash", "deepseek-v4-pro"]).pipe(
      Schema.withDecodingDefault(Effect.succeed("deepseek-flash")),
      Schema.annotateKey({ title: "Default model" }),
    ),
    homePath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "DeepSeek Harness home",
        description: "Leave empty for a separate home for this provider instance.",
        providerSettingsForm: { placeholder: "Instance-specific DSH_HOME", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  { order: ["binaryPath", "homePath", "defaultModel"] },
);
export type DeepSeekSettings = typeof DeepSeekSettings.Type;
