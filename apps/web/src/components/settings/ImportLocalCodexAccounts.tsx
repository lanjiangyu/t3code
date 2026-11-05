import { useState } from "react";
import {
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
  type LocalCodexAccountsResult,
} from "@t3tools/contracts";
import {
  useEnvironmentSettings,
  usePersistEnvironmentProviderInstanceMutation,
} from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { RedactedSensitiveText } from "./RedactedSensitiveText";

export function ImportLocalCodexAccounts({
  environmentId,
  onImported,
}: {
  readonly environmentId: EnvironmentId;
  readonly onImported: () => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const discover = useAtomCommand(
    serverEnvironment.discoverLocalCodexAccounts,
    "Find local Codex accounts",
  );
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, "Refresh account usage");
  const persist = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const [result, setResult] = useState<LocalCodexAccountsResult | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const imported = new Set(
    Object.values(settings.providerInstances ?? {}).flatMap((instance) => {
      const config = instance.config as { authSourceAccountId?: string } | undefined;
      return config?.authSourceAccountId ? [config.authSourceAccountId] : [];
    }),
  );

  const find = async () => {
    if (pending || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setPending(true);
    setMessage(null);
    const response = await discover({ environmentId, input: {} });
    if (response._tag === "Success") {
      setResult(response.value);
      setSelected(
        new Set(
          response.value.accounts
            .filter((account) => !imported.has(account.accountId))
            .map((account) => account.accountId),
        ),
      );
    }
    setPending(false);
  };

  const importAccounts = async () => {
    if (!result || pending || !readEnvironmentScope(environmentId, AuthProvidersManageScope))
      return;
    setPending(true);
    setMessage(null);
    for (const account of result.accounts) {
      if (!selected.has(account.accountId) || imported.has(account.accountId)) continue;
      const defaultInstance = settings.providerInstances?.[ProviderInstanceId.make("codex")];
      const defaultConfig = defaultInstance?.config as
        | { setupMode?: string; homePath?: string; shadowHomePath?: string }
        | undefined;
      const canUseDefault =
        account.active &&
        defaultConfig?.setupMode !== "managed" &&
        !defaultConfig?.shadowHomePath &&
        (!defaultConfig?.homePath ||
          defaultConfig.homePath === "~/.codex" ||
          defaultConfig.homePath === result.sharedHomePath);
      const instanceId = ProviderInstanceId.make(
        canUseDefault ? "codex" : `codex_local_${randomUUID()}`,
      );
      const saved = await persist({
        operation: canUseDefault ? "upsert" : "create",
        instanceId,
        instance: {
          ...(canUseDefault ? defaultInstance : {}),
          driver: ProviderDriverKind.make("codex"),
          displayName: `Codex · ${account.email || account.planType || "Local account"}`,
          enabled: true,
          config: {
            ...(canUseDefault ? defaultConfig : {}),
            setupMode: "existing",
            homePath: result.sharedHomePath,
            shadowHomePath: "",
            authSourceHome: account.homePath,
            authSourceAccountId: account.accountId,
          },
        },
      });
      if (saved._tag === "Failure") {
        setMessage(
          "Could not import this account. Previously imported accounts are kept; scan again to retry.",
        );
        setPending(false);
        return;
      }
      await refresh({ environmentId, input: { instanceId, fresh: true } });
    }
    setPending(false);
    onImported();
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Find saved Codex CLI and Codex Quota Monitor accounts on this environment's machine. Each
        account keeps its own login and usage limits while sharing conversations.
      </p>
      <div>
        <Button variant="outline" disabled={!canManage || pending} onClick={() => void find()}>
          {pending ? "Working…" : result ? "Scan again" : "Find local accounts"}
        </Button>
      </div>
      {result && result.accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No saved subscription logins found. Sign in with Codex CLI or your quota monitor on this
          machine, then scan again.
        </p>
      ) : null}
      {result?.accounts.map((account) => (
        <div key={account.accountId} className="flex items-start gap-3 rounded-lg border p-3">
          <Checkbox
            aria-label={`Import ${account.email || account.accountId}`}
            checked={imported.has(account.accountId) || selected.has(account.accountId)}
            disabled={pending || imported.has(account.accountId)}
            onCheckedChange={(checked) =>
              setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(account.accountId);
                else next.delete(account.accountId);
                return next;
              })
            }
          />
          <span className="grid min-w-0 gap-1 text-sm">
            <span>
              {account.email ? (
                <RedactedSensitiveText
                  value={account.email}
                  ariaLabel="Toggle account email visibility"
                  revealTooltip="Show email"
                  hideTooltip="Hide email"
                />
              ) : (
                "Codex account"
              )}
              {account.active ? " · Current CLI account" : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {account.planType || "Subscription"} ·{" "}
              {account.source === "quota-monitor" ? "Codex Quota Monitor" : "Codex CLI"}
              {imported.has(account.accountId) ? " · Already imported" : ""}
            </span>
          </span>
        </div>
      ))}
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      {result && selected.size > 0 ? (
        <div>
          <Button disabled={pending || !canManage} onClick={() => void importAccounts()}>
            {pending
              ? "Importing…"
              : `Import ${selected.size} account${selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Saved logins can be expired. Provider settings show whether sign-in is needed and display
        each account's live usage after import. No credentials are uploaded to GitHub or included in
        installers.
      </p>
    </div>
  );
}
