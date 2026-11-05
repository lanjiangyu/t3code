import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LocalCodexAccount = Schema.Struct({
  accountId: TrimmedNonEmptyString,
  email: Schema.String,
  planType: Schema.NullOr(Schema.String),
  homePath: TrimmedNonEmptyString,
  source: Schema.Literals(["codex", "quota-monitor"]),
  active: Schema.Boolean,
});
export type LocalCodexAccount = typeof LocalCodexAccount.Type;

export const LocalCodexAccountsResult = Schema.Struct({
  accounts: Schema.Array(LocalCodexAccount),
  sharedHomePath: TrimmedNonEmptyString,
});
export type LocalCodexAccountsResult = typeof LocalCodexAccountsResult.Type;
