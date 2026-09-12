const INPUT_USD_PER_MILLION = 3;
const OUTPUT_USD_PER_MILLION = 15;

export function tokensToUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_USD_PER_MILLION + (outputTokens / 1_000_000) * OUTPUT_USD_PER_MILLION;
}

export function canStartSession(usedUsd: number, limitUsd: number | null): boolean {
  if (limitUsd == null) {
    return true;
  }
  if (limitUsd <= 0) {
    return false;
  }
  return usedUsd < limitUsd;
}
