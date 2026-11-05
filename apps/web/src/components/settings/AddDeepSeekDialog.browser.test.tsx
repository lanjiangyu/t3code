import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";

const setup = vi.hoisted(() => ({
  persist: vi.fn(async (_input: unknown) => ({ _tag: "Success" as const })),
}));

vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  usePersistEnvironmentProviderInstanceMutation: (() => setup.persist) as never,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));

import { AddDeepSeekDialog } from "./AddDeepSeekDialog";

it("creates a separate Claude runtime with a sensitive DeepSeek key and no subscription token", async () => {
  setup.persist.mockClear();
  const onClose = vi.fn();
  await using screen = await render(
    <AddDeepSeekDialog environmentId={EnvironmentId.make("local")} onClose={onClose} />,
  );
  await userEvent.type(screen.getByLabelText("DeepSeek API key"), "sk-test-deepseek");
  await userEvent.click(screen.getByRole("button", { name: "Pro", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Add DeepSeek", exact: true }));
  await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(setup.persist).toHaveBeenCalledExactlyOnceWith({
    operation: "create",
    instanceId: expect.stringMatching(/^claude_deepseek_/),
    instance: {
      driver: "claudeAgent",
      displayName: "DeepSeek",
      enabled: true,
      config: {
        homePath: expect.stringMatching(/^~\/.t3-deepseek\/claude_deepseek_/),
        customModels: ["deepseek-flash", "deepseek-v4-pro"],
      },
      environment: expect.arrayContaining([
        {
          name: "ANTHROPIC_BASE_URL",
          value: "https://api.deepseek.com/anthropic",
          sensitive: false,
        },
        { name: "ANTHROPIC_AUTH_TOKEN", value: "sk-test-deepseek", sensitive: true },
        { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "", sensitive: false },
        { name: "ANTHROPIC_MODEL", value: "deepseek-v4-pro", sensitive: false },
      ]),
    },
  });
});
