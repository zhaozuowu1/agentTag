export const DEFAULT_DASHSCOPE_MODEL = "qwen3.8-max";

export type ThinkingMode = "hybrid" | "always";

export type ModelCatalogGroup = "recommended" | "qwen" | "required" | "fallback" | "optional";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  thinking: ThinkingMode;
  group: ModelCatalogGroup;
  groupLabel: string;
}

export const DASHSCOPE_MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: "qwen3.8-max",
    label: "推荐默认（可关思考）",
    thinking: "hybrid",
    group: "recommended",
    groupLabel: "推荐默认",
  },
  {
    id: "qwen3.7-plus",
    label: "官方 Agent 推荐；约 3.8-max 输入价 1/6（≤256k）",
    thinking: "hybrid",
    group: "qwen",
    groupLabel: "千问备选",
  },
  {
    id: "qwen3-max",
    label: "默认不思考；只换字符串也能跑",
    thinking: "hybrid",
    group: "qwen",
    groupLabel: "千问备选",
  },
  {
    id: "qwen3.8-flash",
    label: "同代更快更便宜",
    thinking: "hybrid",
    group: "qwen",
    groupLabel: "千问备选",
  },
  {
    id: "ZHIPU/GLM-5.3",
    label: "智谱直供；指数同档或局部更高；始终思考",
    thinking: "always",
    group: "required",
    groupLabel: "必须",
  },
  {
    id: "kimi-k3",
    label: "百炼托管 Kimi 3；始终思考；输出 100 元/百万",
    thinking: "always",
    group: "required",
    groupLabel: "必须",
  },
  {
    id: "qwen-plus",
    label: "旧版，仅回退 / 对照",
    thinking: "hybrid",
    group: "fallback",
    groupLabel: "回退",
  },
  {
    id: "glm-5.2",
    label: "首页推荐表里的 GLM；可关思考",
    thinking: "hybrid",
    group: "optional",
    groupLabel: "可选",
  },
  {
    id: "kimi-k2.7-code",
    label: "首页推荐表里的 Kimi；仅思考",
    thinking: "always",
    group: "optional",
    groupLabel: "可选",
  },
  {
    id: "qwen3.8-max-0902",
    label: "钉死版本",
    thinking: "hybrid",
    group: "optional",
    groupLabel: "可选",
  },
];

export class InvalidModelIdError extends Error {
  readonly modelId: string;

  constructor(modelId: string) {
    super(`非法模型 ID: ${modelId}`);
    this.name = "InvalidModelIdError";
    this.modelId = modelId;
  }
}

export function isCatalogModelId(id: string): boolean {
  return DASHSCOPE_MODEL_CATALOG.some((entry) => entry.id === id);
}

export function catalogEntry(id: string): ModelCatalogEntry | undefined {
  return DASHSCOPE_MODEL_CATALOG.find((entry) => entry.id === id);
}

export function parseSavedModelId(
  raw: string | null | undefined,
): { ok: true; modelId: string | null } | { ok: false; error: "非法模型 ID" } {
  if (raw == null || raw === "") {
    return { ok: true, modelId: null };
  }
  if (raw !== raw.trim() || !isCatalogModelId(raw)) {
    return { ok: false, error: "非法模型 ID" };
  }
  return { ok: true, modelId: raw };
}

function isUnset(id: string | null | undefined): boolean {
  return id == null || id.trim() === "";
}

export function dashscopeMaxTokens(enableThinking: boolean): number {
  return enableThinking ? 16384 : 8192;
}

export function resolveRuntimeModel(input: {
  chatModelId?: string | null;
  tenantModelId?: string | null;
  envModelId?: string | null;
  chatEnableThinking?: boolean | null;
  tenantEnableThinking?: boolean | null;
  envEnableThinking?: boolean | null;
}): {
  modelId: string;
  source: "chat" | "tenant" | "env";
  enableThinking: boolean;
} {
  let modelId: string;
  let source: "chat" | "tenant" | "env";

  if (!isUnset(input.chatModelId)) {
    const id = input.chatModelId as string;
    if (!isCatalogModelId(id)) {
      throw new InvalidModelIdError(id);
    }
    modelId = id;
    source = "chat";
  } else if (!isUnset(input.tenantModelId)) {
    const id = input.tenantModelId as string;
    if (!isCatalogModelId(id)) {
      throw new InvalidModelIdError(id);
    }
    modelId = id;
    source = "tenant";
  } else if (!isUnset(input.envModelId)) {
    modelId = input.envModelId as string;
    source = "env";
  } else {
    modelId = DEFAULT_DASHSCOPE_MODEL;
    source = "env";
  }

  let enableThinking = false;
  if (input.chatEnableThinking != null) {
    enableThinking = input.chatEnableThinking;
  } else if (input.tenantEnableThinking != null) {
    enableThinking = input.tenantEnableThinking;
  } else if (input.envEnableThinking != null) {
    enableThinking = input.envEnableThinking;
  }

  // 仅思考模型关不掉；租户上为千问保存的「关」不能带到 GLM / Kimi。
  if (catalogEntry(modelId)?.thinking === "always") {
    enableThinking = true;
  }

  return { modelId, source, enableThinking };
}
