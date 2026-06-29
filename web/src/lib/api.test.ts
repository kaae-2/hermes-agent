import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("dashboard API auth", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("window", {});
    delete window.__HERMES_SESSION_TOKEN__;
    window.__HERMES_AUTH_REQUIRED__ = true;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete window.__HERMES_SESSION_TOKEN__;
    delete window.__HERMES_AUTH_REQUIRED__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts OAuth login in gated dashboard mode without requiring the legacy session token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        session_id: "sid-1",
        flow: "device_code",
        user_code: "ABCD-EFGH",
        verification_url: "https://auth.openai.com/codex/device",
        expires_in: 900,
        poll_interval: 5,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.startOAuthLogin("openai-codex")).resolves.toMatchObject({
      session_id: "sid-1",
      flow: "device_code",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/providers/oauth/openai-codex/start");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).has("X-Hermes-Session-Token")).toBe(false);
  });

  it("still sends the injected legacy session token in loopback dashboard mode", async () => {
    window.__HERMES_AUTH_REQUIRED__ = false;
    window.__HERMES_SESSION_TOKEN__ = "legacy-token";
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.revealEnvVar("OPENAI_API_KEY")).resolves.toEqual({ ok: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("X-Hermes-Session-Token")).toBe("legacy-token");
  });
});
