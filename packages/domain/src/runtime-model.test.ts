import { describe, expect, it } from "vitest";
import {
  DASHSCOPE_MODEL_CATALOG,
  DEFAULT_DASHSCOPE_MODEL,
  InvalidModelIdError,
  isCatalogModelId,
  parseSavedModelId,
  resolveRuntimeModel,
} from "./runtime-model.ts";

function catalogIds(): string[] {
  return DASHSCOPE_MODEL_CATALOG.map((entry) => entry.id);
}

describe("DASHSCOPE_MODEL_CATALOG", () => {
  it("includes the required GLM and Kimi ids with always-on thinking", () => {
    const glm = DASHSCOPE_MODEL_CATALOG.find((entry) => entry.id === "ZHIPU/GLM-5.3");
    const kimi = DASHSCOPE_MODEL_CATALOG.find((entry) => entry.id === "kimi-k3");
    expect(glm?.thinking).toBe("always");
    expect(kimi?.thinking).toBe("always");
    expect(catalogIds()).toContain("qwen3.8-max");
    expect(catalogIds()).toContain("qwen3.7-plus");
    expect(catalogIds()).toContain("qwen3-max");
    expect(catalogIds()).toContain("qwen3.8-flash");
    expect(catalogIds()).toContain("qwen-plus");
  });

  it("does not treat hosted glm-5.3 or kimi/kimi-k3 as the same catalog row", () => {
    expect(catalogIds()).not.toContain("glm-5.3");
    expect(catalogIds()).not.toContain("kimi/kimi-k3");
    expect(isCatalogModelId("ZHIPU/GLM-5.3")).toBe(true);
    expect(isCatalogModelId("kimi-k3")).toBe(true);
    expect(isCatalogModelId("glm-5.3")).toBe(false);
    expect(isCatalogModelId("kimi/kimi-k3")).toBe(false);
  });

  it("does not mark required catalog models as lacking function calling", () => {
    const blob = JSON.stringify(DASHSCOPE_MODEL_CATALOG);
    expect(blob).not.toMatch(/不支持\s*FC|function calling 不支持|no function calling/i);
    expect(DASHSCOPE_MODEL_CATALOG.every((entry) => entry.thinking === "hybrid" || entry.thinking === "always")).toBe(
      true,
    );
  });
});

describe("parseSavedModelId", () => {
  it("accepts catalog ids including ZHIPU/GLM-5.3 and kimi-k3", () => {
    expect(parseSavedModelId("ZHIPU/GLM-5.3")).toEqual({ ok: true, modelId: "ZHIPU/GLM-5.3" });
    expect(parseSavedModelId("kimi-k3")).toEqual({ ok: true, modelId: "kimi-k3" });
    expect(parseSavedModelId("qwen3.8-max")).toEqual({ ok: true, modelId: "qwen3.8-max" });
  });

  it("treats empty as clearing the tenant override", () => {
    expect(parseSavedModelId("")).toEqual({ ok: true, modelId: null });
    expect(parseSavedModelId(null)).toEqual({ ok: true, modelId: null });
  });

  it("rejects whitespace, wrong case, and lookalike ids", () => {
    expect(parseSavedModelId(" qwen3.8-max")).toMatchObject({ ok: false, error: "非法模型 ID" });
    expect(parseSavedModelId("Qwen3.8-Max")).toMatchObject({ ok: false, error: "非法模型 ID" });
    expect(parseSavedModelId("glm-5.3")).toMatchObject({ ok: false, error: "非法模型 ID" });
    expect(parseSavedModelId("kimi/kimi-k3")).toMatchObject({ ok: false, error: "非法模型 ID" });
  });
});

describe("resolveRuntimeModel", () => {
  it("uses the tenant id over env, env over the code default, and treats blank as unset", () => {
    expect(
      resolveRuntimeModel({
        tenantModelId: "qwen3.7-plus",
        envModelId: "qwen-plus",
      }),
    ).toMatchObject({ modelId: "qwen3.7-plus", source: "tenant", enableThinking: false });

    expect(
      resolveRuntimeModel({
        tenantModelId: "",
        envModelId: "qwen3.8-flash",
      }),
    ).toMatchObject({ modelId: "qwen3.8-flash", source: "env", enableThinking: false });

    expect(
      resolveRuntimeModel({
        tenantModelId: "   ",
        envModelId: "   ",
      }),
    ).toMatchObject({ modelId: DEFAULT_DASHSCOPE_MODEL, source: "env", enableThinking: false });

    expect(DEFAULT_DASHSCOPE_MODEL).toBe("qwen3.8-max");
  });

  it("lets a reserved chat override beat tenant and env", () => {
    expect(
      resolveRuntimeModel({
        chatModelId: "qwen3.8-flash",
        tenantModelId: "qwen3.7-plus",
        envModelId: "qwen-plus",
      }),
    ).toMatchObject({ modelId: "qwen3.8-flash", source: "chat" });
  });

  it("forces thinking on for always-on models even when the tenant switch is off", () => {
    const glm = resolveRuntimeModel({
      tenantModelId: "ZHIPU/GLM-5.3",
      tenantEnableThinking: false,
      envModelId: "qwen3.8-max",
    });
    expect(glm.enableThinking).toBe(true);
    expect(glm.modelId).toBe("ZHIPU/GLM-5.3");

    const kimi = resolveRuntimeModel({
      tenantModelId: "kimi-k3",
      tenantEnableThinking: false,
      envModelId: "qwen3.8-max",
    });
    expect(kimi.enableThinking).toBe(true);
  });

  it("keeps hybrid thinking off by default and honors an explicit tenant switch", () => {
    expect(
      resolveRuntimeModel({
        tenantModelId: "qwen3.8-max",
        tenantEnableThinking: false,
        envModelId: "qwen-plus",
      }).enableThinking,
    ).toBe(false);
    expect(
      resolveRuntimeModel({
        tenantModelId: "qwen3.8-max",
        tenantEnableThinking: true,
        envModelId: "qwen-plus",
      }).enableThinking,
    ).toBe(true);
  });

  it("fail-closes on a tenant or chat id that is not in the catalog", () => {
    expect(() =>
      resolveRuntimeModel({
        tenantModelId: "glm-5.3",
        envModelId: "qwen3.8-max",
      }),
    ).toThrow(InvalidModelIdError);
    expect(() =>
      resolveRuntimeModel({
        chatModelId: "kimi/kimi-k3",
        tenantModelId: "qwen3.8-max",
        envModelId: "qwen3.8-max",
      }),
    ).toThrow(InvalidModelIdError);
  });

  it("allows an env id that is not yet in the catalog so new official ids can boot", () => {
    expect(
      resolveRuntimeModel({
        tenantModelId: null,
        envModelId: "qwen3.9-max",
      }),
    ).toMatchObject({ modelId: "qwen3.9-max", source: "env", enableThinking: false });
    expect(
      resolveRuntimeModel({
        tenantModelId: null,
        envModelId: "  qwen3.9-max  ",
      }),
    ).toMatchObject({ modelId: "qwen3.9-max", source: "env" });
  });
});
