import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import type { ProviderInstanceEnvironment, ProviderInstanceId } from "@t3tools/contracts";
import type { DeepSeekSettings } from "../settings.ts";

export const deepSeekEnvironment = Effect.fn("DeepSeek.environment")(function* (
  config: DeepSeekSettings,
  instanceId: ProviderInstanceId,
  stateDir: string,
  variables: ProviderInstanceEnvironment | undefined,
  inherited: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const base = { ...inherited };
  // A named instance must never inherit another route's credentials or profile.
  for (const key of Object.keys(base)) {
    if (
      /^(DEEPSEEK_|DSH_(?:HOME|PERMISSION_MODE)$|OPENAI_API_KEY$|ANTHROPIC_AUTH_TOKEN$|ANTHROPIC_API_KEY$|CLAUDE_CODE_OAUTH_TOKEN$)/i.test(
        key,
      )
    )
      delete base[key];
  }
  const environment = yield* mergeProviderInstanceEnvironment(variables, base);
  return {
    ...environment,
    DSH_PERMISSION_MODE: "workspace-write",
    DSH_HOME: config.homePath.trim()
      ? path.resolve(expandHomePath(config.homePath, home))
      : path.join(stateDir, "providers", "deepseek", instanceId),
  };
});
