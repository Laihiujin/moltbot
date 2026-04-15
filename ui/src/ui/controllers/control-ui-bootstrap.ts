import {
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  type ControlUiBootstrapConfig,
  type ControlUiEmbedSandboxMode,
} from "../../../../src/gateway/control-ui-contract.js";
import { normalizeAssistantIdentity } from "../assistant-identity.ts";
import { normalizeBasePath } from "../navigation.ts";
import type { UiSettings } from "../storage.ts";

export type ControlUiBootstrapState = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  gatewayAuthMode?: "none" | "token" | "password" | "trusted-proxy" | null;
  settings?: UiSettings;
  password?: string;
  applySettings?: (next: UiSettings) => void;
  localMediaPreviewRoots: string[];
  embedSandboxMode: ControlUiEmbedSandboxMode;
  allowExternalEmbedUrls: boolean;
};

type TauriBootstrapAccess = {
  gateway_url?: string;
  auth_mode?: "none" | "token" | "password" | "trusted-proxy" | null;
  token?: string | null;
  password?: string | null;
};

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: TauriInvoke;
    };
  }
}

function resolveTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") {
    return null;
  }
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === "function" ? invoke : null;
}

function isTauriDesktopHost(): boolean {
  if (typeof location === "undefined") {
    return false;
  }
  return location.hostname === "tauri.localhost";
}

function generateGatewayToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizeGatewayAuthMode(
  value: unknown,
): "none" | "token" | "password" | "trusted-proxy" | null {
  if (
    value === "none" ||
    value === "token" ||
    value === "password" ||
    value === "trusted-proxy"
  ) {
    return value;
  }
  return null;
}

function applyBootstrapGatewayAuth(
  state: ControlUiBootstrapState,
  params: {
    gatewayUrl?: string;
    authMode?: "none" | "token" | "password" | "trusted-proxy" | null;
    token?: string | null;
    password?: string | null;
  },
) {
  const gatewayUrl =
    typeof params.gatewayUrl === "string" && params.gatewayUrl.trim()
      ? params.gatewayUrl.trim()
      : state.settings?.gatewayUrl;
  const token = typeof params.token === "string" ? params.token : "";
  const password = typeof params.password === "string" ? params.password : "";
  if (state.settings && gatewayUrl) {
    const nextSettings = { ...state.settings, gatewayUrl, token };
    if (typeof state.applySettings === "function") {
      state.applySettings(nextSettings);
    } else {
      state.settings = nextSettings;
    }
  }
  if (typeof state.password === "string") {
    state.password = password;
  }
  if ("gatewayAuthMode" in state) {
    state.gatewayAuthMode = params.authMode ?? state.gatewayAuthMode ?? null;
  }
}

async function loadDesktopGatewayBootstrap(state: ControlUiBootstrapState) {
  if (!isTauriDesktopHost()) {
    return;
  }
  const invoke = resolveTauriInvoke();
  if (!invoke) {
    return;
  }
  try {
    let result = (await invoke("bootstrap_gateway_access")) as TauriBootstrapAccess;
    const gatewayUrl =
      typeof result.gateway_url === "string" && result.gateway_url.trim()
        ? result.gateway_url.trim()
        : "ws://127.0.0.1:18789";
    const authMode = normalizeGatewayAuthMode(result.auth_mode);
    let token = typeof result.token === "string" ? result.token : "";
    const password = typeof result.password === "string" ? result.password : "";
    if (authMode !== "none" && authMode !== "password" && authMode !== "trusted-proxy" && !token) {
      const autoToken = generateGatewayToken();
      await invoke("write_config", {
        json: JSON.stringify({
          gateway: {
            auth: {
              mode: "token",
              token: autoToken,
            },
          },
        }),
      });
      result = (await invoke("bootstrap_gateway_access")) as TauriBootstrapAccess;
      token =
        typeof result.token === "string" && result.token.trim() ? result.token : autoToken;
    }
    applyBootstrapGatewayAuth(state, { gatewayUrl, authMode, token, password });
  } catch {
    // Ignore desktop bootstrap failures and fall back to the normal login gate.
  }
}

export async function loadControlUiBootstrapConfig(state: ControlUiBootstrapState) {
  if (typeof window === "undefined") {
    return;
  }
  await loadDesktopGatewayBootstrap(state);
  if (typeof fetch !== "function") {
    return;
  }

  const basePath = normalizeBasePath(state.basePath ?? "");
  const url = basePath
    ? `${basePath}${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`
    : CONTROL_UI_BOOTSTRAP_CONFIG_PATH;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) {
      return;
    }
    const parsed = (await res.json()) as ControlUiBootstrapConfig;
    applyBootstrapGatewayAuth(state, {
      authMode: normalizeGatewayAuthMode(parsed.authMode),
      token: parsed.token ?? null,
      password: parsed.password ?? null,
    });
    const normalized = normalizeAssistantIdentity({
      agentId: parsed.assistantAgentId ?? null,
      name: parsed.assistantName,
      avatar: parsed.assistantAvatar ?? null,
    });
    state.assistantName = normalized.name;
    state.assistantAvatar = normalized.avatar;
    state.assistantAgentId = normalized.agentId ?? null;
    state.serverVersion = parsed.serverVersion ?? null;
    state.localMediaPreviewRoots = Array.isArray(parsed.localMediaPreviewRoots)
      ? parsed.localMediaPreviewRoots.filter((value): value is string => typeof value === "string")
      : [];
    state.embedSandboxMode =
      parsed.embedSandbox === "trusted"
        ? "trusted"
        : parsed.embedSandbox === "strict"
          ? "strict"
          : "scripts";
    state.allowExternalEmbedUrls = parsed.allowExternalEmbedUrls === true;
  } catch {
    // Ignore bootstrap failures; UI will update identity after connecting.
  }
}
