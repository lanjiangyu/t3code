import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { readLocalCodexTokens } from "./LocalCodexAuth.ts";

const token = (account: string) =>
  `header.${Buffer.from(JSON.stringify({ exp: 4_000_000_000, "https://api.openai.com/auth": { chatgpt_account_id: account, chatgpt_plan_type: "plus" } })).toString("base64url")}.signature`;

it.layer(NodeServices.layer)("LocalCodexAuth", (it) => {
  it.effect("reads the selected account without replacing the shared CLI login", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${root}/.codex`, { recursive: true });
      yield* fs.makeDirectory(`${root}/other`, { recursive: true });
      const sharedAuth = JSON.stringify({
        tokens: { account_id: "primary", access_token: token("primary") },
      });
      yield* fs.writeFileString(`${root}/.codex/auth.json`, sharedAuth);
      yield* fs.writeFileString(
        `${root}/other/auth.json`,
        JSON.stringify({ tokens: { account_id: "other", access_token: token("other") } }),
      );
      const credentials = yield* readLocalCodexTokens({
        binaryPath: "codex",
        authSourceHome: `${root}/other`,
        authSourceAccountId: "other",
      }).pipe(Effect.provideService(HostProcess.HomeDirectory, root));
      expect(credentials.chatgptAccountId).toBe("other");
      expect(credentials.accessToken).toBe(token("other"));
      expect(yield* fs.readFileString(`${root}/.codex/auth.json`)).toBe(sharedAuth);
    }),
  );
  it.effect("refuses a changed account instead of sending a different account's token", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${root}/other`, { recursive: true });
      yield* fs.writeFileString(
        `${root}/other/auth.json`,
        JSON.stringify({ tokens: { account_id: "changed", access_token: token("changed") } }),
      );
      const result = yield* readLocalCodexTokens({
        binaryPath: "codex",
        authSourceHome: `${root}/other`,
        authSourceAccountId: "expected",
      }).pipe(Effect.provideService(HostProcess.HomeDirectory, root), Effect.result);
      expect(result._tag).toBe("Failure");
      expect(JSON.stringify(result)).not.toContain(token("changed"));
    }),
  );
});
