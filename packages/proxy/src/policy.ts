export interface ProxyConnection {
  id: string;
  allowedHosts: string[];
}

export interface AccessBundle {
  allowedHosts: string[];
  connections: ProxyConnection[];
}

export type ProxyDecision =
  | { action: "inject"; connectionId: string }
  | { action: "forward" }
  | { action: "block" };

export function decide(host: string, bundle: AccessBundle): ProxyDecision {
  const normalized = normalizeHost(host);
  if (!normalized) {
    return { action: "block" };
  }
  for (const connection of bundle.connections) {
    if (connection.allowedHosts.some((pattern) => hostMatches(pattern, normalized))) {
      return { action: "inject", connectionId: connection.id };
    }
  }
  if (bundle.allowedHosts.some((pattern) => hostMatches(pattern, normalized))) {
    return { action: "forward" };
  }
  return { action: "block" };
}

export function parseAllowedHosts(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function normalizeHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(trimmed.slice(colon + 1))) {
    return trimmed.slice(0, colon);
  }
  return trimmed;
}

export function hostMatches(pattern: string, host: string): boolean {
  const p = normalizeHost(pattern);
  const h = normalizeHost(host);
  if (!p || !h) {
    return false;
  }
  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    return h === suffix || h.endsWith(`.${suffix}`);
  }
  return h === p;
}

export function blockedHostMessage(host: string): string {
  return `出站被拦截：不允许访问 ${normalizeHost(host) || host}`;
}
