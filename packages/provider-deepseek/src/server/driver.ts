import { DeepSeekSettings } from "../settings.ts";
import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type { ProviderDriver, ProviderInstance } from "@t3tools/provider-core/server/driver";
import { defaultProviderContinuationIdentity } from "@t3tools/provider-core/server/driver";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import { makeManualOnlyProviderMaintenanceCapabilities } from "@t3tools/provider-core/server/maintenanceResolver";
import {
  buildServerProvider,
  providerModelsFromSettings,
  spawnAndCollect,
  type ProviderProbeResult,
} from "@t3tools/provider-core/server/snapshotProbe";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";
import { createModelCapabilities } from "@t3tools/shared/model";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { DEEPSEEK_DRIVER, makeDeepSeekAdapter } from "./adapter.ts";
import { deepSeekEnvironment } from "./environment.ts";

const decode = Schema.decodeSync(DeepSeekSettings);
const capabilities = createModelCapabilities({ optionDescriptors: [] });
const maintenance = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DEEPSEEK_DRIVER,
  packageName: "@deepseek-ai/dsh",
});
const textGeneration: ProviderTextGeneration = (() => {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: "DeepSeek Harness ACP does not provide application text generation.",
      }),
    );
  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateReviewGuide: () => unsupported("generateReviewGuide"),
  };
})();

const snapshotOf = Effect.fn("DeepSeek.snapshot")(function* (
  settings: DeepSeekSettings,
  probe: ProviderProbeResult,
) {
  const provider = buildServerProvider({
    driver: DEEPSEEK_DRIVER,
    presentation: {
      displayName: "DeepSeek",
      showInteractionModeToggle: false,
      supportedRuntimeModes: ["approval-required"],
    },
    enabled: settings.enabled,
    checkedAt: DateTime.formatIso(yield* DateTime.now),
    models: providerModelsFromSettings(
      [
        {
          slug: "default",
          name: "Default (DeepSeek Harness)",
          isCustom: false,
          isDefault: true,
          capabilities,
        },
        { slug: "deepseek-flash", name: "DeepSeek Flash", isCustom: false, capabilities },
        { slug: "deepseek-v4-pro", name: "DeepSeek V4 Pro", isCustom: false, capabilities },
      ],
      settings.customModels,
      capabilities,
    ),
    probe,
  });
  return { ...provider, supportsTextGeneration: false };
});

export type DeepSeekDriverEnv =
  | Effect.Services<ReturnType<typeof makeDeepSeekAdapter>>
  | ProviderHost.ProviderHost
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner;

export const DeepSeekDriver: ProviderDriver<DeepSeekSettings, DeepSeekDriverEnv> = {
  driverKind: DEEPSEEK_DRIVER,
  metadata: { displayName: "DeepSeek", supportsMultipleInstances: true },
  configSchema: DeepSeekSettings,
  defaultConfig: () => decode({}),
  create: Effect.fn("DeepSeekDriver.create")(function* (input) {
    const host = yield* ProviderHost.ProviderHost;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const settings = {
      ...input.config,
      enabled: input.enabled,
      binaryPath: expandHomePath(input.config.binaryPath, yield* HostProcess.HomeDirectory),
    };
    const environment = yield* deepSeekEnvironment(
      settings,
      input.instanceId,
      host.paths.stateDir,
      input.environment,
      yield* HostProcess.Environment,
    );
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DEEPSEEK_DRIVER,
      instanceId: input.instanceId,
    });
    const stamp = withInstanceIdentity({
      instanceId: input.instanceId,
      driverKind: DEEPSEEK_DRIVER,
      displayName: input.displayName,
      accentColor: input.accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const source = yield* makeProviderSnapshotSettingsSource(settings);
    const check = Effect.gen(function* () {
      if (!settings.enabled)
        return yield* snapshotOf(settings, {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
        });
      const command = yield* resolveSpawnCommand(settings.binaryPath, ["--version"], {
        env: environment,
        extendEnv: true,
      });
      const result = yield* spawnAndCollect(
        settings.binaryPath,
        ChildProcess.make(command.command, command.args, {
          env: environment,
          shell: command.shell,
        }),
      );
      return yield* snapshotOf(settings, {
        installed: result.code === 0,
        version: result.stdout.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1] ?? null,
        status: result.code === 0 ? "ready" : "error",
        auth: { status: environment.DEEPSEEK_API_KEY?.trim() ? "unknown" : "unauthenticated" },
        message: environment.DEEPSEEK_API_KEY?.trim()
          ? "API key configured; it is verified when a turn runs."
          : "Set DEEPSEEK_API_KEY in this provider's environment variables.",
      });
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.catch(() =>
        snapshotOf(settings, {
          installed: false,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message:
            "Install DeepSeek Harness (npm install -g @deepseek-ai/dsh), or check its binary path.",
        }),
      ),
      Effect.map(stamp),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<DeepSeekSettings>>({
      resolveMaintenance: () => Effect.succeed(maintenance),
      getSettings: source.getSettings,
      streamSettings: source.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: ({ provider }) =>
        snapshotOf(provider, {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
        }).pipe(Effect.map(stamp)),
      checkProvider: check,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DEEPSEEK_DRIVER,
            instanceId: input.instanceId,
            detail: "Could not prepare the DeepSeek provider.",
            cause,
          }),
      ),
    );
    const orchestrationAdapter = yield* makeDeepSeekAdapter({
      instanceId: input.instanceId,
      settings,
      environment,
    });
    return {
      instanceId: input.instanceId,
      driverKind: DEEPSEEK_DRIVER,
      continuationIdentity,
      displayName: input.displayName,
      accentColor: input.accentColor,
      enabled: input.enabled,
      snapshot,
      orchestrationAdapter,
      textGeneration,
    } satisfies ProviderInstance;
  }),
};
