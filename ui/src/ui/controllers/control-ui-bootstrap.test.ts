/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { CONTROL_UI_BOOTSTRAP_CONFIG_PATH } from "../../../../src/gateway/control-ui-contract.js";
import { loadControlUiBootstrapConfig } from "./control-ui-bootstrap.ts";
import type { UiSettings } from "../storage.ts";

describe("loadControlUiBootstrapConfig", () => {
  it("loads assistant identity from the bootstrap endpoint", async () => {
    const applySettings = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        basePath: "/openclaw",
        assistantName: "Ops",
        assistantAvatar: "O",
        authMode: "token",
        token: "bootstrap-token",
        password: "bootstrap-password",
        assistantAgentId: "main",
        serverVersion: "2026.3.7",
        localMediaPreviewRoots: ["/tmp/openclaw"],
        embedSandbox: "scripts",
        allowExternalEmbedUrls: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const settings: UiSettings = {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 220,
      navGroupsCollapsed: {},
      borderRadius: 50,
    };

    const state = {
      basePath: "/openclaw",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      gatewayAuthMode: null,
      localMediaPreviewRoots: [],
      embedSandboxMode: "scripts" as const,
      allowExternalEmbedUrls: false,
      serverVersion: null,
      settings,
      password: "",
      applySettings,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(state.assistantName).toBe("Ops");
    expect(state.assistantAvatar).toBe("O");
    expect(applySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: "ws://127.0.0.1:18789",
        token: "bootstrap-token",
      }),
    );
    expect(state.password).toBe("bootstrap-password");
    expect(state.gatewayAuthMode).toBe("token");
    expect(state.assistantAgentId).toBe("main");
    expect(state.serverVersion).toBe("2026.3.7");
    expect(state.localMediaPreviewRoots).toEqual(["/tmp/openclaw"]);
    expect(state.embedSandboxMode).toBe("scripts");
    expect(state.allowExternalEmbedUrls).toBe(true);

    vi.unstubAllGlobals();
  });

  it("ignores failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state = {
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      gatewayAuthMode: null,
      localMediaPreviewRoots: [],
      embedSandboxMode: "scripts" as const,
      allowExternalEmbedUrls: false,
      serverVersion: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock).toHaveBeenCalledWith(
      CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
      expect.objectContaining({ method: "GET" }),
    );
    expect(state.assistantName).toBe("Assistant");
    expect(state.embedSandboxMode).toBe("scripts");
    expect(state.allowExternalEmbedUrls).toBe(false);

    vi.unstubAllGlobals();
  });

  it("normalizes trailing slash basePath for bootstrap fetch path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state = {
      basePath: "/openclaw/",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      gatewayAuthMode: null,
      localMediaPreviewRoots: [],
      embedSandboxMode: "scripts" as const,
      allowExternalEmbedUrls: false,
      serverVersion: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`,
      expect.objectContaining({ method: "GET" }),
    );

    vi.unstubAllGlobals();
  });

  it("does not rewrite none auth mode into token during desktop bootstrap", async () => {
    const originalLocation = globalThis.location;
    vi.stubGlobal("location", new URL("https://tauri.localhost/"));
    const invoke = vi.fn(async (command: string) => {
      if (command === "bootstrap_gateway_access") {
        return {
          gateway_url: "ws://127.0.0.1:18789",
          auth_mode: "none",
          token: null,
          password: null,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    window.__TAURI_INTERNALS__ = { invoke };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      }) as unknown as typeof fetch,
    );

    const state = {
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      gatewayAuthMode: null,
      localMediaPreviewRoots: [],
      embedSandboxMode: "scripts" as const,
      allowExternalEmbedUrls: false,
      serverVersion: null,
      settings: {
        gatewayUrl: "ws://127.0.0.1:18789",
        token: "",
        sessionKey: "main",
        lastActiveSessionKey: "main",
        theme: "claw",
        themeMode: "system",
        chatFocusMode: false,
        chatShowThinking: true,
        chatShowToolCalls: true,
        splitRatio: 0.6,
        navCollapsed: false,
        navWidth: 220,
        navGroupsCollapsed: {},
        borderRadius: 50,
      } satisfies UiSettings,
      password: "",
    };

    await loadControlUiBootstrapConfig(state);

    expect(state.gatewayAuthMode).toBe("none");
    expect(state.settings.token).toBe("");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith("write_config", expect.anything());

    delete window.__TAURI_INTERNALS__;
    vi.stubGlobal("location", originalLocation);
    vi.unstubAllGlobals();
  });
});
