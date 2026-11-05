import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as LocalCodexAccounts from "./LocalCodexAccounts.ts";

const jwt = (claims: object) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

const auth = (accountId: string, email: string) =>
  JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      account_id: accountId,
      access_token: "private-access-token",
      refresh_token: "private-refresh-token",
      id_token: jwt({ email, "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }),
    },
  });

it.layer(NodeServices.layer)("LocalCodexAccounts", (it) => {
  describe("discovery", () => {
    it.effect(
      "deduplicates the active login, prefers its monitor profile, and never returns credentials",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const root = yield* fs.makeTempDirectoryScoped();
          yield* fs.makeDirectory(`${root}/.codex`, { recursive: true });
          yield* fs.makeDirectory(
            `${root}/AppData/Roaming/codex-quota-monitor/profiles/one/codex-home`,
            { recursive: true },
          );
          yield* fs.writeFileString(
            `${root}/.codex/auth.json`,
            auth("account-one", "first@example.com"),
          );
          yield* fs.writeFileString(
            `${root}/AppData/Roaming/codex-quota-monitor/profiles/one/codex-home/auth.json`,
            auth("account-one", "first@example.com"),
          );
          const accounts = yield* LocalCodexAccounts.LocalCodexAccounts.use(
            (service) => service.discover,
          ).pipe(
            Effect.provide(LocalCodexAccounts.layer),
            Effect.provideService(HostProcess.HomeDirectory, root),
            Effect.provideService(HostProcess.Platform, "win32"),
            Effect.provideService(HostProcess.Environment, {}),
          );
          expect(accounts.accounts).toHaveLength(1);
          expect(accounts.accounts[0]?.source).toBe("quota-monitor");
          expect(accounts.accounts[0]?.active).toBe(true);
          expect(JSON.stringify(accounts)).not.toContain("private-access-token");
          expect(JSON.stringify(accounts)).not.toContain("private-refresh-token");
        }),
    );
    it.effect("skips malformed and API-key logins without losing valid accounts", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(`${root}/.codex`, { recursive: true });
        yield* fs.writeFileString(`${root}/.codex/auth.json`, "{broken");
        const monitor = `${root}/AppData/Roaming/codex-quota-monitor/profiles`;
        for (const name of ["api", "valid"])
          yield* fs.makeDirectory(`${monitor}/${name}/codex-home`, { recursive: true });
        yield* fs.writeFileString(
          `${monitor}/api/codex-home/auth.json`,
          '{"OPENAI_API_KEY":"secret"}',
        );
        yield* fs.writeFileString(
          `${monitor}/valid/codex-home/auth.json`,
          auth("valid", "valid@example.com"),
        );
        const result = yield* LocalCodexAccounts.LocalCodexAccounts.use(
          (service) => service.discover,
        ).pipe(
          Effect.provide(LocalCodexAccounts.layer),
          Effect.provideService(HostProcess.HomeDirectory, root),
          Effect.provideService(HostProcess.Platform, "win32"),
          Effect.provideService(HostProcess.Environment, {}),
        );
        expect(result.accounts.map((account) => account.email)).toEqual(["valid@example.com"]);
      }),
    );
  });
});
