/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import {
  channelEnabled,
  resolveChannelConfigured,
  resolveChannelDisplayState,
} from "./channels.shared.ts";
import { renderChannels } from "./channels.ts";
import type { ChannelsProps } from "./channels.types.ts";

function createProps(snapshot: ChannelsProps["snapshot"]): ChannelsProps {
  return {
    connected: true,
    loading: false,
    snapshot,
    expandedChannelIds: new Set(),
    lastError: null,
    lastSuccessAt: null,
    whatsappMessage: null,
    whatsappQrDataUrl: null,
    whatsappConnected: null,
    whatsappBusy: false,
    configSchema: null,
    configSchemaLoading: false,
    configForm: null,
    configUiHints: {},
    configSaving: false,
    configFormDirty: false,
    nostrProfileFormState: null,
    nostrProfileAccountId: null,
    onRefresh: () => {},
    onToggleChannelExpanded: () => {},
    onWhatsAppStart: () => {},
    onWhatsAppWait: () => {},
    onWhatsAppLogout: () => {},
    onConfigPatch: () => {},
    onConfigSave: () => {},
    onConfigReload: () => {},
    onNostrProfileEdit: () => {},
    onNostrProfileCancel: () => {},
    onNostrProfileFieldChange: () => {},
    onNostrProfileSave: () => {},
    onNostrProfileImport: () => {},
    onNostrProfileToggleAdvanced: () => {},
  };
}

describe("channel display selectors", () => {
  it("returns the channel summary configured flag when present", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["discord"],
      channelLabels: { discord: "Discord" },
      channels: { discord: { configured: false } },
      channelAccounts: {
        discord: [{ accountId: "discord-main", configured: true }],
      },
      channelDefaultAccountId: { discord: "discord-main" },
    });

    expect(resolveChannelConfigured("discord", props)).toBe(false);
    expect(resolveChannelDisplayState("discord", props).configured).toBe(false);
  });

  it("falls back to the default account when the channel summary omits configured", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["discord"],
      channelLabels: { discord: "Discord" },
      channels: { discord: { running: true } },
      channelAccounts: {
        discord: [
          { accountId: "default", configured: false },
          { accountId: "discord-main", configured: true },
        ],
      },
      channelDefaultAccountId: { discord: "discord-main" },
    });

    const displayState = resolveChannelDisplayState("discord", props);

    expect(resolveChannelConfigured("discord", props)).toBe(true);
    expect(displayState.defaultAccount?.accountId).toBe("discord-main");
    expect(channelEnabled("discord", props)).toBe(true);
  });

  it("falls back to the first account when no default account id is available", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["slack"],
      channelLabels: { slack: "Slack" },
      channels: { slack: { running: true } },
      channelAccounts: {
        slack: [{ accountId: "workspace-a", configured: true }],
      },
      channelDefaultAccountId: {},
    });

    const displayState = resolveChannelDisplayState("slack", props);

    expect(resolveChannelConfigured("slack", props)).toBe(true);
    expect(displayState.defaultAccount?.accountId).toBe("workspace-a");
  });

  it("keeps disabled channels hidden when neither summary nor accounts are active", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["signal"],
      channelLabels: { signal: "Signal" },
      channels: { signal: {} },
      channelAccounts: {
        signal: [{ accountId: "default", configured: false, running: false, connected: false }],
      },
      channelDefaultAccountId: { signal: "default" },
    });

    const displayState = resolveChannelDisplayState("signal", props);

    expect(displayState.configured).toBe(false);
    expect(displayState.running).toBeNull();
    expect(displayState.connected).toBeNull();
    expect(channelEnabled("signal", props)).toBe(false);
  });
});

describe("channel cards", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders channels collapsed by default", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["discord"],
      channelLabels: { discord: "Discord" },
      channels: { discord: { configured: true, running: true } },
      channelAccounts: {},
      channelDefaultAccountId: {},
    });
    const container = document.createElement("div");

    render(renderChannels(props), container);

    const card = container.querySelector(".channel-card");
    expect(card?.classList.contains("channel-card--collapsed")).toBe(true);
    expect(container.querySelector(".channel-card__body")).toBeNull();
  });

  it("toggles a single channel open without affecting others", () => {
    let expanded = new Set<string>();
    const container = document.createElement("div");
    const baseProps = createProps({
      ts: Date.now(),
      channelOrder: ["discord", "whatsapp"],
      channelLabels: { discord: "Discord", whatsapp: "WhatsApp" },
      channels: {
        discord: { configured: true, running: true },
        whatsapp: { configured: false, running: false },
      },
      channelAccounts: {},
      channelDefaultAccountId: {},
    });
    const renderWithState = () =>
      render(
        renderChannels({
          ...baseProps,
          expandedChannelIds: expanded,
          onToggleChannelExpanded: (channelId) => {
            const next = new Set(expanded);
            if (next.has(channelId)) {
              next.delete(channelId);
            } else {
              next.add(channelId);
            }
            expanded = next;
          },
        }),
        container,
      );

    renderWithState();

    const headers = container.querySelectorAll<HTMLButtonElement>(".channel-card__header");
    headers[0]?.click();
    renderWithState();

    const cards = container.querySelectorAll(".channel-card");
    expect(cards[0]?.classList.contains("channel-card--collapsed")).toBe(false);
    expect(cards[1]?.classList.contains("channel-card--collapsed")).toBe(true);
    expect(cards[0]?.querySelector(".channel-card__body")).not.toBeNull();
    expect(cards[1]?.querySelector(".channel-card__body")).toBeNull();
  });

  it("surfaces schema-defined channels even when the health snapshot only includes configured ones", () => {
    const props = {
      ...createProps({
        ts: Date.now(),
        channelOrder: ["feishu"],
        channelLabels: { feishu: "Feishu" },
        channels: {
          feishu: { configured: true, running: true },
        },
        channelAccounts: {},
        channelDefaultAccountId: {},
      }),
      configSchema: {
        type: "object",
        properties: {
          channels: {
            type: "object",
            properties: {
              feishu: { type: "object", title: "Feishu" },
              qqbot: { type: "object", title: "QQ Bot" },
              discord: { type: "object", title: "Discord" },
              imessage: { type: "object", title: "iMessage" },
              telegram: { type: "object", title: "Telegram" },
              twitter: { type: "object", title: "Twitter" },
            },
          },
        },
      },
    } satisfies ChannelsProps;
    const container = document.createElement("div");

    render(renderChannels(props), container);

    expect(container.textContent).toContain("QQ Bot");
    expect(container.textContent).toContain("Discord");
    expect(container.textContent).toContain("iMessage");
    expect(container.textContent).toContain("Telegram");
    expect(container.textContent).toContain("Twitter");
  });
});
