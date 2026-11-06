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

it("creates a native DeepSeek provider with a sensitive key and its selected default model", async () => {
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
    instanceId: expect.stringMatching(/^deepseek_/),
    instance: {
      driver: "deepseek",
      displayName: "DeepSeek",
      enabled: true,
      config: {
        defaultModel: "deepseek-v4-pro",
      },
      environment: [{ name: "DEEPSEEK_API_KEY", value: "sk-test-deepseek", sensitive: true }],
    },
  });
});
