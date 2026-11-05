import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { LocalCodexAuthFile, readCodexTokenClaims } from "./LocalCodexAccounts.ts";

type LocalAuthSettings = {
  readonly binaryPath: string;
  readonly authSourceHome?: string | undefined;
  readonly authSourceAccountId?: string | undefined;
};
const decodeAuthFile = Schema.decodeOption(Schema.fromJsonString(LocalCodexAuthFile));

export class LocalCodexAuthError extends Schema.TaggedError<LocalCodexAuthError>()(
  "LocalCodexAuthError",
  { reason: Schema.Literals(["missing", "account-changed", "refresh-failed"]) },
) {
  override get message() {
    return this.reason === "account-changed"
      ? "The local Codex account changed. Import the intended account again."
      : "The local Codex account needs to be signed in again in its original account manager.";
  }
}

const readHome = Effect.fn("LocalCodexAuth.readHome")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, "auth.json");
  const stat = yield* fs.stat(file).pipe(Effect.option);
  if (stat._tag === "None" || Number(stat.value.size) > 131_072) return undefined;
  const raw = yield* fs.readFileString(file).pipe(Effect.option);
  if (raw._tag === "None") return undefined;
  const value = decodeAuthFile(raw.value);
  return value._tag === "Some" ? value.value.tokens : undefined;
});

const refreshHome = Effect.fn("LocalCodexAuth.refreshHome")(function* (
  binary: string,
  home: string,
  environment: NodeJS.ProcessEnv,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = yield* resolveSpawnCommand(binary, ["app-server"], {
    env: environment,
    extendEnv: true,
  });
  const process = yield* spawner.spawn(
    ChildProcess.make(command.command, command.args, {
      env: { ...environment, CODEX_HOME: home },
      extendEnv: true,
      shell: command.shell,
      forceKillAfter: "1 second",
    }),
  );
  const context = yield* Layer.build(CodexClient.layerChildProcess(process));
  const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
    Effect.provide(context),
  );
  yield* client.request("initialize", { clientInfo: { name: "t3-code-local-auth", version: "1" } });
  yield* client.notify("initialized", undefined);
  yield* client.request("account/read", { refreshToken: true });
});

export const readLocalCodexTokens = Effect.fn("LocalCodexAuth.readTokens")(function* (
  settings: LocalAuthSettings,
  environment: NodeJS.ProcessEnv = process.env,
  forceRefresh = false,
) {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const source = path.resolve(expandHomePath(settings.authSourceHome || "~/.codex", home));
  let tokens = yield* readHome(source);
  if (!tokens) return yield* new LocalCodexAuthError({ reason: "missing" });
  const expected = settings.authSourceAccountId || tokens.account_id;
  if (tokens.account_id !== expected)
    return yield* new LocalCodexAuthError({ reason: "account-changed" });
  let refreshDirectory = source;
  const globalHome = path.join(home, ".codex");
  const global = source === globalHome ? undefined : yield* readHome(globalHome);
  const expiry = (value: { readonly access_token: string }) =>
    readCodexTokenClaims(value.access_token)?.exp ?? 0;
  // The monitor can retain an older copy of the currently active CLI login.
  if (global?.account_id === expected && expiry(global) > expiry(tokens)) {
    tokens = global;
    refreshDirectory = globalHome;
  }
  if (forceRefresh || expiry(tokens) * 1000 <= (yield* Clock.currentTimeMillis) + 60_000) {
    yield* refreshHome(settings.binaryPath, refreshDirectory, environment).pipe(
      Effect.scoped,
      Effect.timeout("8 seconds"),
      Effect.mapError(() => new LocalCodexAuthError({ reason: "refresh-failed" })),
    );
    const refreshed = yield* readHome(refreshDirectory);
    if (!refreshed) return yield* new LocalCodexAuthError({ reason: "missing" });
    if (refreshed.account_id !== expected)
      return yield* new LocalCodexAuthError({ reason: "account-changed" });
    if (expiry(refreshed) * 1000 <= (yield* Clock.currentTimeMillis))
      return yield* new LocalCodexAuthError({ reason: "refresh-failed" });
    tokens = refreshed;
  }
  const claims = readCodexTokenClaims(tokens.access_token);
  return {
    accessToken: tokens.access_token,
    chatgptAccountId: expected,
    chatgptPlanType: claims?.["https://api.openai.com/auth"]?.chatgpt_plan_type ?? null,
  };
});

export const makeLocalCodexAuthenticator = Effect.fn("LocalCodexAuth.makeAuthenticator")(function* (
  settings: LocalAuthSettings,
  environment: NodeJS.ProcessEnv,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const credentials = (forceRefresh = false, accountId = settings.authSourceAccountId) =>
    readLocalCodexTokens(
      { ...settings, authSourceAccountId: accountId },
      environment,
      forceRefresh,
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.mapError(
        (error) =>
          new CodexErrors.CodexAppServerRequestError({ code: -32001, errorMessage: error.message }),
      ),
    );
  return Effect.fn("LocalCodexAuth.authenticate")(function* (
    client: CodexClient.CodexAppServerClient["Service"],
  ) {
    const initial = yield* credentials();
    yield* client.handleServerRequest("account/chatgptAuthTokens/refresh", (request) => {
      if (request.previousAccountId && request.previousAccountId !== initial.chatgptAccountId) {
        return Effect.fail(
          new CodexErrors.CodexAppServerRequestError({
            code: -32001,
            errorMessage: "The requested Codex account changed.",
          }),
        );
      }
      return credentials(true, initial.chatgptAccountId);
    });
    yield* client.request("account/login/start", { type: "chatgptAuthTokens", ...initial });
  });
});
