import { useState } from "react";
import {
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { usePersistEnvironmentProviderInstanceMutation } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { SettingsRow } from "./settingsLayout";

export function AddDeepSeekDialog({
  environmentId,
  onClose,
  onCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onCreated?: ((id: ProviderInstanceId) => void) | undefined;
}) {
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const persist = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const [key, setKey] = useState("");
  const [name, setName] = useState("DeepSeek");
  const [model, setModel] = useState("deepseek-flash");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const create = async () => {
    if (
      pending ||
      !key.trim() ||
      !name.trim() ||
      !readEnvironmentScope(environmentId, AuthProvidersManageScope)
    )
      return;
    setPending(true);
    setError(false);
    const id = ProviderInstanceId.make(`deepseek_${randomUUID()}`);
    const environment = [{ name: "DEEPSEEK_API_KEY", value: key.trim(), sensitive: true }];
    const result = await persist({
      operation: "create",
      instanceId: id,
      instance: {
        driver: ProviderDriverKind.make("deepseek"),
        displayName: name.trim(),
        enabled: true,
        environment,
        config: {
          defaultModel: model,
        },
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      setError(true);
      return;
    }
    setKey("");
    onCreated?.(id);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <WizardPopup>
        <WizardHeader
          title="Add DeepSeek"
          description="Use the official DeepSeek Harness with its own account and conversations."
        />
        <WizardPanel>
          <form
            id="add-deepseek"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <SettingsRow
              title="Account name"
              control={
                <Input
                  aria-label="DeepSeek account name"
                  value={name}
                  disabled={pending}
                  onChange={(event) => setName(event.target.value)}
                />
              }
            />
            <SettingsRow
              title="DeepSeek API key"
              description="Stored as a sensitive provider variable on this environment."
              control={
                <Input
                  aria-label="DeepSeek API key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  disabled={pending}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="sk-…"
                />
              }
            />
            <SettingsRow
              title="Default model"
              control={
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={model === "deepseek-flash" ? "default" : "outline"}
                    disabled={pending}
                    aria-pressed={model === "deepseek-flash"}
                    onClick={() => setModel("deepseek-flash")}
                  >
                    Flash
                  </Button>
                  <Button
                    type="button"
                    variant={model === "deepseek-v4-pro" ? "default" : "outline"}
                    disabled={pending}
                    aria-pressed={model === "deepseek-v4-pro"}
                    onClick={() => setModel("deepseek-v4-pro")}
                  >
                    Pro
                  </Button>
                </div>
              }
            />
            <p className="text-xs text-muted-foreground">
              Requires DeepSeek Harness (dsh) on this machine. DeepSeek bills your API account.
            </p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                Could not save the DeepSeek provider. Check your provider permissions and try again.
              </p>
            ) : null}
          </form>
        </WizardPanel>
        <WizardFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="add-deepseek"
            type="submit"
            disabled={!canManage || pending || !key.trim() || !name.trim()}
          >
            {pending ? "Adding…" : "Add DeepSeek"}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
