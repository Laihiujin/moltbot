/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { CONTROL_UI_BOOTSTRAP_CONFIG_PATH } from "../../../../src/gateway/control-ui-contract.js";
import { loadControlUiBootstrapConfig } from "./control-ui-bootstrap.ts";
import type { UiSettings } from "../storage.ts";

describe("loadControlUiBootstrapConfig", () => {
  it("loads assistant identity from the bootstrap endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        basePath: "/openclaw",
        assistantName: "Ops",
        assistantAvatar: "O",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const state = {
      basePath: "/openclaw",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(state.assistantName).toBe("Ops");
    expect(state.assistantAvatar).toBe("O");
    expect(state.assistantAgentId).toBeNull();
    expect(state.serverVersion).toBeNull();

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
      serverVersion: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock).toHaveBeenCalledWith(
      CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
      expect.objectContaining({ method: "GET" }),
    );
    expect(state.assistantName).toBe("Assistant");
    expect(state.assistantAgentId).toBeNull();
    expect(state.serverVersion).toBeNull();

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
      serverVersion: null,
    };

    await loadControlUiBootstrapConfig(state);

    expect(fetchMock).toHaveBeenCalledWith(
      `/openclaw${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(state.assistantAgentId).toBeNull();
    expect(state.serverVersion).toBeNull();

    vi.unstubAllGlobals();
  });

  it("bootstraps the local gateway from Tauri before web fetches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    const applySettings = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("location", {
      protocol: "http:",
      host: "tauri.localhost",
      hostname: "tauri.localhost",
      pathname: "/",
    } as Location);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: vi.fn().mockResolvedValue({
          gateway_url: "ws://127.0.0.1:18789",
          token: "desktop-token",
        }),
      },
      configurable: true,
      writable: true,
    });

    const settings: UiSettings = {
      gatewayUrl: "ws://tauri.localhost",
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
      basePath: "",
      assistantName: "Assistant",
      assistantAvatar: null,
      assistantAgentId: null,
      serverVersion: null,
      settings,
      applySettings,
    };

    await loadControlUiBootstrapConfig(state);

    expect(window.__TAURI_INTERNALS__?.invoke).toHaveBeenCalledWith("bootstrap_gateway_access");
    expect(applySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: "ws://127.0.0.1:18789",
        token: "desktop-token",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
