/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import { renderLoginGate } from "./login-gate.ts";

function createState(overrides: Partial<AppViewState> = {}): AppViewState {
  return {
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
      locale: "en",
    },
    password: "",
    loginShowGatewayToken: false,
    loginShowGatewayPassword: false,
    gatewayBootstrapBusy: false,
    tab: "overview",
    onboarding: false,
    basePath: "",
    connected: false,
    theme: "claw",
    themeMode: "system",
    themeResolved: "dark",
    themeOrder: ["claw"],
    hello: null,
    lastError: null,
    lastErrorCode: null,
    eventLog: [],
    assistantName: "Assistant",
    assistantAvatar: null,
    assistantAgentId: null,
    sessionKey: "main",
    applySettings: vi.fn(),
    connect: vi.fn(),
    setTab: vi.fn(),
    ...overrides,
  } as unknown as AppViewState;
}

describe("renderLoginGate", () => {
  it("shows a bootstrap message instead of the manual form while desktop access is preparing", () => {
    const container = document.createElement("div");
    render(
      renderLoginGate(
        createState({
          gatewayBootstrapBusy: true,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Preparing local gateway access");
    expect(container.querySelector('input[placeholder="OPENCLAW_GATEWAY_TOKEN"]')).toBeNull();
  });

  it("hides the password input by default", () => {
    const container = document.createElement("div");
    render(renderLoginGate(createState()), container);

    expect(container.textContent).not.toContain("Password");
    expect(container.textContent).not.toContain("密码");
    expect(container.querySelector('input[placeholder="OPENCLAW_GATEWAY_TOKEN"]')).not.toBeNull();
  });

  it("shows the password input after a password auth error", () => {
    const container = document.createElement("div");
    render(
      renderLoginGate(
        createState({
          lastError: "disconnected (4008): connect failed",
          lastErrorCode: "AUTH_PASSWORD_MISSING",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Password");
  });
});
