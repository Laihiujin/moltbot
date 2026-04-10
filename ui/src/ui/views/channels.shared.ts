import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { ChannelAccountSnapshot } from "../types.ts";
import type { ChannelKey, ChannelsProps } from "./channels.types.ts";

type ChannelDisplayState = {
  configured: boolean | null;
  running: boolean | null;
  connected: boolean | null;
  defaultAccount: ChannelAccountSnapshot | null;
  hasAnyActiveAccount: boolean;
  status: Record<string, unknown> | undefined;
};

type ChannelStatusRow = {
  label: string;
  value: unknown;
};

function resolveChannelStatus(
  key: ChannelKey,
  props: ChannelsProps,
): Record<string, unknown> | undefined {
  const channels = props.snapshot?.channels as Record<string, unknown> | null;
  return channels?.[key] as Record<string, unknown> | undefined;
}

export function resolveDefaultChannelAccount(
  key: ChannelKey,
  props: ChannelsProps,
): ChannelAccountSnapshot | null {
  const accounts = props.snapshot?.channelAccounts?.[key] ?? [];
  const defaultAccountId = props.snapshot?.channelDefaultAccountId?.[key];
  return (
    (defaultAccountId
      ? accounts.find((account) => account.accountId === defaultAccountId)
      : undefined) ??
    accounts[0] ??
    null
  );
}

export function resolveChannelDisplayState(
  key: ChannelKey,
  props: ChannelsProps,
): ChannelDisplayState {
  const status = resolveChannelStatus(key, props);
  const accounts = props.snapshot?.channelAccounts?.[key] ?? [];
  const defaultAccount = resolveDefaultChannelAccount(key, props);
  const configured =
    typeof status?.configured === "boolean"
      ? status.configured
      : typeof defaultAccount?.configured === "boolean"
        ? defaultAccount.configured
        : null;
  const running = typeof status?.running === "boolean" ? status.running : null;
  const connected = typeof status?.connected === "boolean" ? status.connected : null;
  const hasAnyActiveAccount = accounts.some(
    (account) => account.configured || account.running || account.connected,
  );

  return {
    configured,
    running,
    connected,
    defaultAccount,
    hasAnyActiveAccount,
    status,
  };
}

export function channelEnabled(key: ChannelKey, props: ChannelsProps) {
  if (!props.snapshot) {
    return false;
  }
  const displayState = resolveChannelDisplayState(key, props);
  return (
    displayState.configured === true ||
    displayState.running === true ||
    displayState.connected === true ||
    displayState.hasAnyActiveAccount
  );
}

export function resolveChannelConfigured(key: ChannelKey, props: ChannelsProps): boolean | null {
  return resolveChannelDisplayState(key, props).configured;
}

export function formatNullableBoolean(value: boolean | null): string {
  if (value == null) {
    return t("common.na");
  }
  return value ? t("common.yes") : t("common.no");
}

export function isChannelCollapsed(key: ChannelKey, props: ChannelsProps): boolean {
  return !props.expandedChannelIds.has(key);
}

export function toggleChannelCollapsed(key: ChannelKey, props: ChannelsProps): () => void {
  return () => props.onToggleChannelExpanded(key);
}

export function renderCollapsibleChannelCard(params: {
  title: string;
  subtitle: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  body: unknown;
}) {
  return html`
    <div class="card channel-card ${params.collapsed ? "channel-card--collapsed" : ""}">
      <button
        type="button"
        class="channel-card__header"
        aria-expanded=${String(!params.collapsed)}
        @click=${params.onToggleCollapsed}
      >
        <div class="channel-card__header-copy">
          <div class="card-title">${params.title}</div>
          <div class="card-sub">${params.subtitle}</div>
        </div>
        <span
          class="collapse-chevron ${params.collapsed ? "collapse-chevron--collapsed" : ""}"
          aria-hidden="true"
        >
          ${icons.chevronDown}
        </span>
      </button>
      ${params.collapsed ? nothing : html`<div class="channel-card__body">${params.body}</div>`}
    </div>
  `;
}

export function renderSingleAccountChannelCard(params: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  title: string;
  subtitle: string;
  accountCountLabel: unknown;
  statusRows: readonly ChannelStatusRow[];
  lastError?: string | null;
  secondaryCallout?: unknown;
  extraContent?: unknown;
  configSection: unknown;
  footer?: unknown;
}) {
  return renderCollapsibleChannelCard({
    title: params.title,
    subtitle: params.subtitle,
    collapsed: params.collapsed,
    onToggleCollapsed: params.onToggleCollapsed,
    body: html`
      ${params.accountCountLabel}

      <div class="status-list" style="margin-top: 16px;">
        ${params.statusRows.map(
          (row) => html`
            <div>
              <span class="label">${row.label}</span>
              <span>${row.value}</span>
            </div>
          `,
        )}
      </div>

      ${params.lastError
        ? html`<div class="callout danger" style="margin-top: 12px;">${params.lastError}</div>`
        : nothing}
      ${params.secondaryCallout ?? nothing} ${params.extraContent ?? nothing}
      ${params.configSection} ${params.footer ?? nothing}
    `,
  });
}

export function getChannelAccountCount(
  key: ChannelKey,
  channelAccounts?: Record<string, ChannelAccountSnapshot[]> | null,
): number {
  return channelAccounts?.[key]?.length ?? 0;
}

export function renderChannelAccountCount(
  key: ChannelKey,
  channelAccounts?: Record<string, ChannelAccountSnapshot[]> | null,
) {
  const count = getChannelAccountCount(key, channelAccounts);
  if (count < 2) {
    return nothing;
  }
  return html`<div class="account-count">Accounts (${count})</div>`;
}
