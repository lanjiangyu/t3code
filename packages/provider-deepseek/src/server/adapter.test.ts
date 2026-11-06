import { expect, it } from "@effect/vitest";
import { resolveDeepSeekModel } from "./adapter.ts";

it("maps a model to the advertised official route without selecting another account's route", () => {
  const official = JSON.stringify(["deepseek-official", "deepseek-flash"]);
  const other = JSON.stringify(["other-account", "deepseek-flash"]);
  expect(resolveDeepSeekModel("deepseek-flash", [other, official], official)).toBe(official);
  expect(resolveDeepSeekModel("deepseek-flash", [other], other)).toBeUndefined();
  expect(resolveDeepSeekModel("missing", [official], official)).toBeUndefined();
  expect(resolveDeepSeekModel("default", [official], official)).toBe(official);
  const legacyFlash = JSON.stringify(["deepseek-official", "deepseek-v4-flash"]);
  expect(resolveDeepSeekModel("deepseek-flash", [legacyFlash], legacyFlash)).toBe(legacyFlash);
});
