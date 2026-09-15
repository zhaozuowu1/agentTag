import { parseSavedModelId } from "@agenttag/domain";

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
