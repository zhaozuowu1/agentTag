import { describe, expect, it } from "vitest";
import { parseSavedModelId, resolveRuntimeModel } from "@agenttag/domain";
import { applyTenantModelPatch, thinkingSwitchForSelection, type TenantModelRow } from "./tenant-model.ts";

describe("applyTenantModelPatch", () => {
  it("rejects illegal ids without mutating the stored row", () => {
    const row: TenantModelRow = { modelId: "qwen3.8-max", enableThinking: false };
    expect(applyTenantModelPatch(row, { modelId: "glm-5.3" })).toEqual({ ok: false, error: "非法模型 ID" });
    expect(applyTenantModelPatch(row, { modelId: "kimi/kimi-k3" })).toEqual({ ok: false, error: "非法模型 ID" });
    expect(row).toEqual({ modelId: "qwen3.8-max", enableThinking: false });
  });

  it("saves catalog ids so the next resolve reads them without a restart", () => {
    const row: TenantModelRow = { modelId: null, enableThinking: false };
    expect(applyTenantModelPatch(row, { modelId: "ZHIPU/GLM-5.3" })).toEqual({ ok: true });
    expect(row.modelId).toBe("ZHIPU/GLM-5.3");
    expect(
      resolveRuntimeModel({
        tenantModelId: row.modelId,
        tenantEnableThinking: row.enableThinking,
        envModelId: "qwen-plus",
      }),
    ).toMatchObject({ modelId: "ZHIPU/GLM-5.3", source: "tenant", enableThinking: true });

    expect(applyTenantModelPatch(row, { modelId: "kimi-k3", enableThinking: false })).toEqual({ ok: true });
    expect(
      resolveRuntimeModel({
        tenantModelId: row.modelId,
        tenantEnableThinking: row.enableThinking,
        envModelId: "qwen-plus",
      }),
    ).toMatchObject({ modelId: "kimi-k3", source: "tenant", enableThinking: true });
  });

  it("allows clearing the tenant model so env is used again", () => {
    const row: TenantModelRow = { modelId: "qwen3.7-plus", enableThinking: false };
    expect(applyTenantModelPatch(row, { modelId: "" })).toEqual({ ok: true });
    expect(row.modelId).toBeNull();
    expect(
      resolveRuntimeModel({
        tenantModelId: row.modelId,
        envModelId: "qwen3.8-max",
      }),
    ).toMatchObject({ modelId: "qwen3.8-max", source: "env" });
  });
});

describe("thinkingSwitchForSelection", () => {
  it("does not keep locked-on thinking after leaving an always-on model", () => {
    expect(
      thinkingSwitchForSelection({
        previousMode: "always",
        nextMode: "hybrid",
        currentEnableThinking: true,
      }),
    ).toBe(false);
    expect(
      thinkingSwitchForSelection({
        previousMode: "always",
        nextMode: undefined,
        currentEnableThinking: true,
      }),
    ).toBe(false);
  });

  it("locks thinking on when selecting an always-on model", () => {
    expect(
      thinkingSwitchForSelection({
        previousMode: "hybrid",
        nextMode: "always",
        currentEnableThinking: false,
      }),
    ).toBe(true);
  });

  it("keeps a hybrid admin toggle when staying on hybrid models", () => {
    expect(
      thinkingSwitchForSelection({
        previousMode: "hybrid",
        nextMode: "hybrid",
        currentEnableThinking: true,
      }),
    ).toBe(true);
  });
});

describe("parseSavedModelId", () => {
  it("is the same fail-close helper the admin PATCH uses", () => {
    expect(parseSavedModelId("not-a-model")).toMatchObject({ ok: false, error: "非法模型 ID" });
  });
});
