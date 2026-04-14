import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type {
  ChannelAccountSnapshot,
  ChannelUiMetaEntry,
  ChannelsStatusSnapshot,
  DiscordStatus,
  GoogleChatStatus,
  IMessageStatus,
  NostrProfile,
  NostrStatus,
  SignalStatus,
  SlackStatus,
  TelegramStatus,
  WhatsAppStatus,
} from "../types.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import { renderDiscordCard } from "./channels.discord.ts";
import { renderGoogleChatCard } from "./channels.googlechat.ts";
import { renderIMessageCard } from "./channels.imessage.ts";
import { renderNostrCard } from "./channels.nostr.ts";
import {
  channelEnabled,
  formatNullableBoolean,
  isChannelCollapsed,
  renderCollapsibleChannelCard,
  renderChannelAccountCount,
  resolveChannelDisplayState,
  toggleChannelCollapsed,
} from "./channels.shared.ts";
import { renderSignalCard } from "./channels.signal.ts";
import { renderSlackCard } from "./channels.slack.ts";
import { renderTelegramCard } from "./channels.telegram.ts";
import type { ChannelKey, ChannelsChannelData, ChannelsProps } from "./channels.types.ts";
import { renderWhatsAppCard } from "./channels.whatsapp.ts";

type JsonSchemaNode = {
  type?: string | string[];
  title?: string;
  properties?: Record<string, JsonSchemaNode>;
};

const PREFERRED_CHANNEL_ORDER = [
  "feishu",
  "qq",
  "qqbot",
  "discord",
  "imessage",
  "telegram",
  "twitter",
  "whatsapp",
  "googlechat",
  "slack",
  "signal",
  "nostr",
] as const;

const CHANNEL_LABEL_FALLBACKS: Record<string, string> = {
  discord: "Discord",
  feishu: "Feishu",
  googlechat: "Google Chat",
  imessage: "iMessage",
  nostr: "Nostr",
  qq: "QQ",
  qqbot: "QQ Bot",
  signal: "Signal",
  slack: "Slack",
  telegram: "Telegram",
  twitter: "Twitter",
  whatsapp: "WhatsApp",
};

export function renderChannels(props: ChannelsProps) {
  const channels = props.snapshot?.channels as Record<string, unknown> | null;
  const whatsapp = (channels?.whatsapp ?? undefined) as WhatsAppStatus | undefined;
  const telegram = (channels?.telegram ?? undefined) as TelegramStatus | undefined;
  const discord = (channels?.discord ?? null) as DiscordStatus | null;
  const googlechat = (channels?.googlechat ?? null) as GoogleChatStatus | null;
  const slack = (channels?.slack ?? null) as SlackStatus | null;
  const signal = (channels?.signal ?? null) as SignalStatus | null;
  const imessage = (channels?.imessage ?? null) as IMessageStatus | null;
  const nostr = (channels?.nostr ?? null) as NostrStatus | null;
  const channelOrder = resolveChannelOrder(props.snapshot, props.configSchema);
  const orderedChannels = channelOrder
    .map((key, index) => ({
      key,
      enabled: channelEnabled(key, props),
      order: index,
    }))
    .toSorted((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      return a.order - b.order;
    });

  return html`
    <section class="grid grid-cols-2">
      ${orderedChannels.map((channel) =>
        renderChannel(channel.key, props, {
          whatsapp,
          telegram,
          discord,
          googlechat,
          slack,
          signal,
          imessage,
          nostr,
          channelAccounts: props.snapshot?.channelAccounts ?? null,
        }),
      )}
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${t("channels.health.title")}</div>
          <div class="card-sub">${t("channels.health.subtitle")}</div>
        </div>
        <div class="muted">
          ${props.lastSuccessAt ? formatRelativeTimestamp(props.lastSuccessAt) : t("common.na")}
        </div>
      </div>
      ${props.lastError
        ? html`<div class="callout danger" style="margin-top: 12px;">${props.lastError}</div>`
        : nothing}
      <pre class="code-block" style="margin-top: 12px;">
${props.snapshot ? JSON.stringify(props.snapshot, null, 2) : t("channels.health.noSnapshotYet")}
      </pre
      >
    </section>
  `;
}

function resolveChannelOrder(
  snapshot: ChannelsStatusSnapshot | null,
  schema: unknown,
): ChannelKey[] {
  const snapshotIds = snapshot?.channelMeta?.length
    ? snapshot.channelMeta.map((entry) => entry.id)
    : snapshot?.channelOrder?.length
      ? snapshot.channelOrder
      : [];
  const schemaIds = resolveSchemaChannelIds(schema);
  const allIds = Array.from(new Set([...snapshotIds, ...schemaIds]));
  if (allIds.length === 0) {
    return [...PREFERRED_CHANNEL_ORDER];
  }
  return allIds.toSorted((left, right) => compareChannelIds(left, right));
}

function renderChannel(key: ChannelKey, props: ChannelsProps, data: ChannelsChannelData) {
  const accountCountLabel = renderChannelAccountCount(key, data.channelAccounts);
  switch (key) {
    case "whatsapp":
      return renderWhatsAppCard({
        props,
        whatsapp: data.whatsapp,
        accountCountLabel,
      });
    case "telegram":
      return renderTelegramCard({
        props,
        telegram: data.telegram,
        telegramAccounts: data.channelAccounts?.telegram ?? [],
        accountCountLabel,
      });
    case "discord":
      return renderDiscordCard({
        props,
        discord: data.discord,
        accountCountLabel,
      });
    case "googlechat":
      return renderGoogleChatCard({
        props,
        googleChat: data.googlechat,
        accountCountLabel,
      });
    case "slack":
      return renderSlackCard({
        props,
        slack: data.slack,
        accountCountLabel,
      });
    case "signal":
      return renderSignalCard({
        props,
        signal: data.signal,
        accountCountLabel,
      });
    case "imessage":
      return renderIMessageCard({
        props,
        imessage: data.imessage,
        accountCountLabel,
      });
    case "nostr": {
      const nostrAccounts = data.channelAccounts?.nostr ?? [];
      const primaryAccount = nostrAccounts[0];
      const accountId = primaryAccount?.accountId ?? "default";
      const profile =
        (primaryAccount as { profile?: NostrProfile | null } | undefined)?.profile ?? null;
      const showForm =
        props.nostrProfileAccountId === accountId ? props.nostrProfileFormState : null;
      const profileFormCallbacks = showForm
        ? {
            onFieldChange: props.onNostrProfileFieldChange,
            onSave: props.onNostrProfileSave,
            onImport: props.onNostrProfileImport,
            onCancel: props.onNostrProfileCancel,
            onToggleAdvanced: props.onNostrProfileToggleAdvanced,
          }
        : null;
      return renderNostrCard({
        props,
        nostr: data.nostr,
        nostrAccounts,
        accountCountLabel,
        profileFormState: showForm,
        profileFormCallbacks,
        onEditProfile: () => props.onNostrProfileEdit(accountId, profile),
      });
    }
    default:
      return renderGenericChannelCard(key, props, data.channelAccounts ?? {});
  }
}

function renderGenericChannelCard(
  key: ChannelKey,
  props: ChannelsProps,
  channelAccounts: Record<string, ChannelAccountSnapshot[]>,
) {
  const label = resolveChannelLabel(props.snapshot, key, props.configSchema);
  const displayState = resolveChannelDisplayState(key, props);
  const lastError =
    typeof displayState.status?.lastError === "string" ? displayState.status.lastError : undefined;
  const accounts = channelAccounts[key] ?? [];
  const accountCountLabel = renderChannelAccountCount(key, channelAccounts);

  return html`
    ${renderCollapsibleChannelCard({
      title: label,
      subtitle: t("channels.generic.subtitle"),
      collapsed: isChannelCollapsed(key, props),
      onToggleCollapsed: toggleChannelCollapsed(key, props),
      body: html`
        ${accountCountLabel}
        ${accounts.length > 0
          ? html`
              <div class="account-card-list">
                ${accounts.map((account) => renderGenericAccount(account))}
              </div>
            `
          : html`
              <div class="status-list" style="margin-top: 16px;">
                <div>
                  <span class="label">${t("common.configured")}</span>
                  <span>${formatNullableBoolean(displayState.configured)}</span>
                </div>
                <div>
                  <span class="label">${t("common.running")}</span>
                  <span>${formatNullableBoolean(displayState.running)}</span>
                </div>
                <div>
                  <span class="label">${t("common.connected")}</span>
                  <span>${formatNullableBoolean(displayState.connected)}</span>
                </div>
              </div>
            `}
        ${lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">${lastError}</div>`
          : nothing}
        ${renderChannelConfigSection({ channelId: key, props })}
      `,
    })}
  `;
}

function resolveChannelMetaMap(
  snapshot: ChannelsStatusSnapshot | null,
): Record<string, ChannelUiMetaEntry> {
  if (!snapshot?.channelMeta?.length) {
    return {};
  }
  return Object.fromEntries(snapshot.channelMeta.map((entry) => [entry.id, entry]));
}

function resolveChannelLabel(
  snapshot: ChannelsStatusSnapshot | null,
  key: string,
  schema?: unknown,
): string {
  const meta = resolveChannelMetaMap(snapshot)[key];
  return (
    meta?.label ??
    snapshot?.channelLabels?.[key] ??
    resolveSchemaChannelLabel(schema, key) ??
    CHANNEL_LABEL_FALLBACKS[key] ??
    key
  );
}

function compareChannelIds(left: string, right: string): number {
  const leftIndex = PREFERRED_CHANNEL_ORDER.indexOf(
    left as (typeof PREFERRED_CHANNEL_ORDER)[number],
  );
  const rightIndex = PREFERRED_CHANNEL_ORDER.indexOf(
    right as (typeof PREFERRED_CHANNEL_ORDER)[number],
  );
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) {
      return 1;
    }
    if (rightIndex === -1) {
      return -1;
    }
    return leftIndex - rightIndex;
  }
  return left.localeCompare(right);
}

function asSchemaNode(value: unknown): JsonSchemaNode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonSchemaNode;
}

function resolveSchemaChannelIds(schema: unknown): string[] {
  const root = asSchemaNode(schema);
  const channels = root?.properties?.channels;
  const channelSchema = asSchemaNode(channels);
  const properties = channelSchema?.properties;
  if (!properties) {
    return [];
  }
  return Object.keys(properties);
}

function resolveSchemaChannelLabel(schema: unknown, key: string): string | null {
  const root = asSchemaNode(schema);
  const channels = asSchemaNode(root?.properties?.channels);
  const node = asSchemaNode(channels?.properties?.[key]);
  const title = typeof node?.title === "string" ? node.title.trim() : "";
  return title || null;
}

const RECENT_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function hasRecentActivity(account: ChannelAccountSnapshot): boolean {
  if (!account.lastInboundAt) {
    return false;
  }
  return Date.now() - account.lastInboundAt < RECENT_ACTIVITY_THRESHOLD_MS;
}

function deriveRunningStatus(account: ChannelAccountSnapshot): string {
  if (account.running) {
    return t("common.yes");
  }
  // If we have recent inbound activity, the channel is effectively running
  if (hasRecentActivity(account)) {
    return t("common.active");
  }
  return t("common.no");
}

function deriveConnectedStatus(account: ChannelAccountSnapshot): string {
  if (account.connected === true) {
    return t("common.yes");
  }
  if (account.connected === false) {
    return t("common.no");
  }
  // If connected is null/undefined but we have recent activity, show as active
  if (hasRecentActivity(account)) {
    return t("common.active");
  }
  return t("common.na");
}

function renderGenericAccount(account: ChannelAccountSnapshot) {
  const runningStatus = deriveRunningStatus(account);
  const connectedStatus = deriveConnectedStatus(account);

  return html`
    <div class="account-card">
      <div class="account-card-header">
        <div class="account-card-title">${account.name || account.accountId}</div>
        <div class="account-card-id">${account.accountId}</div>
      </div>
      <div class="status-list account-card-status">
        <div>
          <span class="label">${t("common.running")}</span>
          <span>${runningStatus}</span>
        </div>
        <div>
          <span class="label">${t("common.configured")}</span>
          <span>${account.configured ? t("common.yes") : t("common.no")}</span>
        </div>
        <div>
          <span class="label">${t("common.connected")}</span>
          <span>${connectedStatus}</span>
        </div>
        <div>
          <span class="label">${t("common.lastInbound")}</span>
          <span
            >${account.lastInboundAt
              ? formatRelativeTimestamp(account.lastInboundAt)
              : t("common.na")}</span
          >
        </div>
        ${account.lastError
          ? html` <div class="account-card-error">${account.lastError}</div> `
          : nothing}
      </div>
    </div>
  `;
}
