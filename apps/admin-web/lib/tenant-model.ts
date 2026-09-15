import { parseSavedModelId, type ThinkingMode } from "@agenttag/domain";

export type TenantModelRow = {
  modelId: string | null;
  enableThinking: boolean;
};

export function applyTenantModelPatch(
  row: TenantModelRow,
  patch: { modelId?: string | null; enableThinking?: boolean },
): { ok: true } | { ok: false; error: string } {
  if ("modelId" in patch) {
    const parsed = parseSavedModelId(patch.modelId ?? null);
    if (!parsed.ok) {
      return parsed;
    }
    row.modelId = parsed.modelId;
  }
  if (typeof patch.enableThinking === "boolean") {
    row.enableThinking = patch.enableThinking;
  }
  return { ok: true };
}

/** 从仅思考模型切走时不要把锁定的「开」写到混合模型上。 */
export function thinkingSwitchForSelection(input: {
  previousMode?: ThinkingMode;
  nextMode?: ThinkingMode;
  currentEnableThinking: boolean;
}): boolean {
  if (input.nextMode === "always") {
    return true;
  }
  if (input.previousMode === "always") {
    return false;
  }
  return input.currentEnableThinking;
}
