import { describe, expect, it } from "vitest";
import { decide, parseAllowedHosts, type AccessBundle } from "./policy.ts";

const empty: AccessBundle = { allowedHosts: [], connections: [] };

describe("decide", () => {
  it("injects credentials when the host matches a connection allowlist", () => {
    const bundle: AccessBundle = {
      allowedHosts: ["example.com"],
      connections: [{ id: "conn_gh", allowedHosts: ["api.github.com"] }],
    };
    expect(decide("api.github.com", bundle)).toEqual({ action: "inject", connectionId: "conn_gh" });
    expect(decide("API.GitHub.com:443", bundle)).toEqual({ action: "inject", connectionId: "conn_gh" });
  });

  it("forwards without credentials when the host is on the bundle allowlist only", () => {
    const bundle: AccessBundle = {
      allowedHosts: ["pypi.org", "*.pythonhosted.org"],
      connections: [{ id: "conn_gh", allowedHosts: ["api.github.com"] }],
    };
    expect(decide("pypi.org", bundle)).toEqual({ action: "forward" });
    expect(decide("files.pythonhosted.org", bundle)).toEqual({ action: "forward" });
  });

  it("blocks any other host", () => {
    expect(decide("evil.example", empty)).toEqual({ action: "block" });
    expect(decide("api.github.com", { allowedHosts: ["pypi.org"], connections: [] })).toEqual({ action: "block" });
  });

  it("prefers connection inject over a matching bundle allowlist", () => {
    const bundle: AccessBundle = {
      allowedHosts: ["api.github.com"],
      connections: [{ id: "conn_gh", allowedHosts: ["api.github.com"] }],
    };
    expect(decide("api.github.com", bundle)).toEqual({ action: "inject", connectionId: "conn_gh" });
  });
});

describe("parseAllowedHosts", () => {
  it("splits a comma-separated env value and ignores blanks", () => {
    expect(parseAllowedHosts("pypi.org, files.pythonhosted.org ,")).toEqual([
      "pypi.org",
      "files.pythonhosted.org",
    ]);
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts("")).toEqual([]);
  });
});
