import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { AcpProviderCapabilitiesV2, makeAcpAdapterV2 } from "@t3tools/provider-acp/server/adapter";
import {
  collectSessionConfigOptionValues,
  findModelConfigOption,
} from "@t3tools/provider-acp/server/runtimeModel";
import * as AcpErrors from "effect-acp/errors";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import { ProviderDriverKind, type ProviderInstanceId } from "@t3tools/contracts";
import type { DeepSeekSettings } from "../settings.ts";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import { makeAcpNativeLoggerFactory } from "@t3tools/provider-acp/server/nativeLogging";

export const DEEPSEEK_DRIVER = ProviderDriverKind.make("deepseek");
const decodeRoute = Schema.decodeOption(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
);

export function resolveDeepSeekModel(
  requested: string,
  advertised: ReadonlyArray<string>,
  current: string | undefined,
) {
  if (requested === "default") return current;
  if (advertised.includes(requested)) return requested;
  const matches = advertised.filter((value) => {
    const route = decodeRoute(value);
    return (
      route._tag === "Some" &&
      route.value[0] === "deepseek-official" &&
      (route.value[1] === requested ||
        (requested === "deepseek-flash" && route.value[1] === "deepseek-v4-flash"))
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export const makeDeepSeekAdapter = Effect.fn("DeepSeek.makeAdapter")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  readonly settings: DeepSeekSettings;
  readonly environment: NodeJS.ProcessEnv;
}) {
  const selfInvocation = yield* resolveSelfInvocation();
  const loggers = yield* ProviderEventLoggers.ProviderEventLoggers;
  const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
  return yield* makeAcpAdapterV2({
    instanceId: input.instanceId,
    selfInvocation,
    nativeLogging: (threadId) =>
      makeNativeLogger({ nativeEventLogger: loggers.native, provider: DEEPSEEK_DRIVER, threadId }),
    flavor: {
      driver: DEEPSEEK_DRIVER,
      runtimeHarness: "deepseek",
      mcpOverHttp: true,
      capabilities: {
        ...AcpProviderCapabilitiesV2,
        threads: { ...AcpProviderCapabilitiesV2.threads, canRollbackThread: false },
        turns: { ...AcpProviderCapabilitiesV2.turns, supportsSteeringByInterruptRestart: false },
        planning: {
          ...AcpProviderCapabilitiesV2.planning,
          emitsPlanUpdated: false,
          emitsTodoList: false,
          supportsStructuredQuestions: false,
        },
        tools: { ...AcpProviderCapabilitiesV2.tools, supportsMcpTools: true },
        checkpointing: {
          ...AcpProviderCapabilitiesV2.checkpointing,
          providerCanRollbackConversation: false,
          providerRollbackReturnsSnapshot: false,
        },
      },
      permissionDisposition: () => "ask",
      makeRuntime: Effect.fn("DeepSeek.makeRuntime")(function* ({
        runtimePolicy,
        processEnvironment,
        ...options
      }) {
        if (!input.environment.DEEPSEEK_API_KEY?.trim())
          return yield* new AcpErrors.AcpRequestError({
            code: -32001,
            errorMessage: "Set DEEPSEEK_API_KEY in this DeepSeek provider's environment variables.",
          });
        const context = yield* Layer.build(
          AcpSessionRuntime.layer({
            ...options,
            resumeMethod: "resume",
            cancelBehavior: "wait-for-prompt",
            spawn: {
              command: input.settings.binaryPath,
              args: ["--profile", "acp"],
              cwd: options.cwd,
              env: {
                ...input.environment,
                ...processEnvironment,
                DSH_HOME: input.environment.DSH_HOME,
                DSH_PERMISSION_MODE:
                  typeof runtimePolicy.sandboxPolicy === "object" &&
                  runtimePolicy.sandboxPolicy !== null &&
                  "type" in runtimePolicy.sandboxPolicy &&
                  runtimePolicy.sandboxPolicy.type === "readOnly"
                    ? "read-only"
                    : "workspace-write",
              },
            },
          }),
        );
        return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
          Effect.provide(context),
        );
      }),
      applyModelSelection: Effect.fn("DeepSeek.applyModelSelection")(function* ({
        runtime,
        modelSelection,
      }) {
        const option = findModelConfigOption(yield* runtime.getConfigOptions);
        const requested =
          modelSelection.model === "default" ? input.settings.defaultModel : modelSelection.model;
        const model = resolveDeepSeekModel(
          requested,
          option ? collectSessionConfigOptionValues(option) : [],
          option?.currentValue,
        );
        if (model === undefined || option === undefined)
          return yield* new AcpErrors.AcpRequestError({
            code: -32602,
            errorMessage: "The selected DeepSeek model is not available in this Harness profile.",
          });
        if (model !== option.currentValue) yield* runtime.setConfigOption(option.id, model);
        return model;
      }),
    },
  });
});
