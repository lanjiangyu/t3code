import type { LocalCodexAccount, LocalCodexAccountsResult } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const Claims = Schema.Struct({
  email: Schema.optionalKey(Schema.String),
  exp: Schema.optionalKey(Schema.Number),
  "https://api.openai.com/auth": Schema.optionalKey(
    Schema.Struct({
      chatgpt_plan_type: Schema.optionalKey(Schema.String),
      chatgpt_account_id: Schema.optionalKey(Schema.String),
    }),
  ),
});
const decodeClaims = Schema.decodeUnknownSync(Claims);

export function readCodexTokenClaims(token: string): typeof Claims.Type | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const text = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const json: unknown = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(text, (c) => c.charCodeAt(0))),
    );
    return decodeClaims(json);
  } catch {
    return undefined;
  }
}

export const LocalCodexAuthFile = Schema.Struct({
  tokens: Schema.Struct({
    account_id: Schema.String,
    access_token: Schema.String,
    id_token: Schema.optionalKey(Schema.String),
  }),
});

export class LocalCodexAccounts extends Context.Service<
  LocalCodexAccounts,
  { readonly discover: Effect.Effect<LocalCodexAccountsResult> }
>()("t3/provider/LocalCodexAccounts") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const sharedHomePath = path.resolve(environment.CODEX_HOME || path.join(home, ".codex"));
  const applicationData =
    platform === "win32"
      ? environment.APPDATA || path.join(home, "AppData", "Roaming")
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support")
        : environment.XDG_CONFIG_HOME || path.join(home, ".config");
  const profiles = path.join(applicationData, "codex-quota-monitor", "profiles");
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(LocalCodexAuthFile));

  const readAccount = Effect.fn("LocalCodexAccounts.readAccount")(function* (
    homePath: string,
    source: LocalCodexAccount["source"],
  ) {
    const authPath = path.join(homePath, "auth.json");
    const stat = yield* fs.stat(authPath).pipe(Effect.option);
    if (stat._tag === "None" || Number(stat.value.size) > 131_072) return undefined;
    const contents = yield* fs.readFileString(authPath).pipe(Effect.option);
    if (contents._tag === "None") return undefined;
    const auth = decode(contents.value);
    if (auth._tag === "None" || !auth.value.tokens.account_id.trim()) return undefined;
    const claims = readCodexTokenClaims(
      auth.value.tokens.id_token || auth.value.tokens.access_token,
    );
    return {
      accountId: auth.value.tokens.account_id,
      email: claims?.email || "",
      planType: claims?.["https://api.openai.com/auth"]?.chatgpt_plan_type || null,
      homePath,
      source,
      active: false,
    } satisfies LocalCodexAccount;
  });

  const discover = Effect.fn("LocalCodexAccounts.discover")(function* () {
    const active = yield* readAccount(sharedHomePath, "codex");
    const accounts = new Map<string, LocalCodexAccount>();
    if (active) accounts.set(active.accountId, { ...active, active: true });
    const entries = yield* fs
      .readDirectory(profiles)
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    for (const name of entries.sort()) {
      const profilePath = path.resolve(profiles, name, "codex-home");
      if (!profilePath.startsWith(profiles + path.sep)) continue;
      const account = yield* readAccount(profilePath, "quota-monitor");
      if (!account) continue;
      const previous = accounts.get(account.accountId);
      // Monitor-owned homes remain stable when the user switches the global CLI login.
      if (!previous || previous.source === "codex") {
        accounts.set(account.accountId, {
          ...account,
          active: active?.accountId === account.accountId,
        });
      }
    }
    return { accounts: [...accounts.values()], sharedHomePath };
  });
  return LocalCodexAccounts.of({ discover: discover() });
});

export const layer = Layer.effect(LocalCodexAccounts, make);
