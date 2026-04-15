/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { OverviewProps } from "./overview.ts";
import { renderOverview } from "./overview.ts";

function createProps(overrides: Partial<OverviewProps> = {}): OverviewProps {
  return {
    connected: false,
    hello: null,
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
    gatewayAuthMode: null,
    lastError: null,
    lastErrorCode: null,
    presenceCount: 0,
    sessionsCount: 0,
    cronEnabled: null,
    cronNext: null,
    lastChannelsRefresh: null,
    warnQueryToken: false,
    usageResult: null,
    sessionsResult: null,
    skillsReport: null,
    cronJobs: [],
    cronStatus: null,
    attentionItems: [],
    eventLog: [],
    overviewLogLines: [],
    showGatewayToken: false,
    showGatewayPassword: false,
    onSettingsChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onSessionKeyChange: vi.fn(),
    onToggleGatewayTokenVisibility: vi.fn(),
    onToggleGatewayPasswordVisibility: vi.fn(),
    onConnect: vi.fn(),
    onRefresh: vi.fn(),
    onOpenGatewayAuthSettings: vi.fn(),
    onNavigate: vi.fn(),
    onRefreshLogs: vi.fn(),
    ...overrides,
  };
}

describe("renderOverview", () => {
  it("shows none auth mode without token input", () => {
    const container = document.createElement("div");
    render(
      renderOverview(
        createProps({
          gatewayAuthMode: "none",
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Mode: none");
    expect(container.textContent).toContain("none");
    expect(container.querySelector('input[placeholder="OPENCLAW_GATEWAY_TOKEN"]')).toBeNull();
  });
});
