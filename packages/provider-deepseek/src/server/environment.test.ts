import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ProviderInstanceId } from "@t3tools/contracts";
import { DeepSeekSettings } from "../settings.ts";
import { deepSeekEnvironment } from "./environment.ts";

const config = Schema.decodeSync(DeepSeekSettings)({});
it.layer(NodeServices.layer)("DeepSeek environment", (it) => {
  it.effect(
    "isolates account credentials and session homes while preserving the machine proxy",
    () =>
      Effect.gen(function* () {
        const inherited = {
          DEEPSEEK_API_KEY: "another-account",
          DSH_HOME: "/shared",
          DSH_PERMISSION_MODE: "danger-full-access",
          DSH_TELEMETRY_DISABLED: "1",
          HTTPS_PROXY: "http://localhost:8080",
          ANTHROPIC_AUTH_TOKEN: "claude-token",
        };
        const variables = [
          { name: "DEEPSEEK_API_KEY", value: "selected-account", sensitive: true },
        ];
        const first = yield* deepSeekEnvironment(
          config,
          ProviderInstanceId.make("deepseek_work"),
          "/sandbox",
          variables,
          inherited,
        );
        const second = yield* deepSeekEnvironment(
          config,
          ProviderInstanceId.make("deepseek_personal"),
          "/sandbox",
          undefined,
          inherited,
        );
        expect(first.DEEPSEEK_API_KEY).toBe("selected-account");
        expect(second.DEEPSEEK_API_KEY).toBeUndefined();
        expect(first.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
        expect(first.HTTPS_PROXY).toBe(inherited.HTTPS_PROXY);
        expect(first.DSH_HOME).not.toBe(second.DSH_HOME);
        expect(first.DSH_PERMISSION_MODE).toBe("workspace-write");
        expect(first.DSH_TELEMETRY_DISABLED).toBe("1");
        expect(inherited.DEEPSEEK_API_KEY).toBe("another-account");
      }),
  );
});
