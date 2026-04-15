import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSchemaResponse, ConfigSnapshot, ConfigUiHints } from "../types.ts";
import type { JsonSchema } from "../views/config-form.shared.ts";
import { coerceFormValues } from "./config/form-coerce.ts";
import {
  cloneConfigObject,
  removePathValue,
  serializeConfigForm,
  setPathValue,
} from "./config/form-utils.ts";

export type ConfigState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  applySessionKey: string;
  configLoading: boolean;
  configRaw: string;
  configRawOriginal: string;
  configValid: boolean | null;
  configIssues: unknown[];
  configSaving: boolean;
  configApplying: boolean;
  updateRunning: boolean;
  configSnapshot: ConfigSnapshot | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  configFormDirty: boolean;
  configFormMode: "form" | "raw";
  configSearchQuery: string;
  configActiveSection: string | null;
  configActiveSubsection: string | null;
  lastError: string | null;
};

type LoadConfigSchemaOptions = {
  sections?: string[];
};

const configSchemaCache = new Map<string, ConfigSchemaResponse>();
const configSchemaRequestCache = new Map<string, Promise<ConfigSchemaResponse>>();

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUnsupportedSectionsError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error && typeof error.message === "string"
        ? error.message
        : "";
  return (
    message.includes("config.schema") &&
    message.includes("sections") &&
    message.includes("unexpected property")
  );
}

function mergeConfigSchemaResponses(entries: ConfigSchemaResponse[]): ConfigSchemaResponse {
  if (entries.length === 0) {
    return {
      schema: {},
      uiHints: {},
      version: "",
      generatedAt: "",
    };
  }
  if (entries.length === 1) {
    return entries[0];
  }

  const rootSchema = entries
    .map((entry) => entry.schema)
    .find((schema) => isSchemaObject(schema) && isSchemaObject(schema.properties));
  if (!isSchemaObject(rootSchema) || !isSchemaObject(rootSchema.properties)) {
    return entries[0];
  }

  const mergedProperties: Record<string, unknown> = {};
  const mergedRequired = new Set<string>();
  const mergedHints: ConfigUiHints = {};

  for (const entry of entries) {
    const schema = entry.schema;
    if (isSchemaObject(schema) && isSchemaObject(schema.properties)) {
      Object.assign(mergedProperties, schema.properties);
      const required = Array.isArray(schema.required)
        ? schema.required.filter((item): item is string => typeof item === "string")
        : [];
      for (const key of required) {
        mergedRequired.add(key);
      }
    }
    Object.assign(mergedHints, entry.uiHints ?? {});
  }

  return {
    ...entries[0],
    schema: {
      ...rootSchema,
      properties: mergedProperties,
      ...(mergedRequired.size > 0 ? { required: Array.from(mergedRequired) } : {}),
    },
    uiHints: mergedHints,
  };
}

async function requestConfigSchema(
  client: GatewayBrowserClient,
  options?: LoadConfigSchemaOptions,
): Promise<ConfigSchemaResponse> {
  const sections = Array.from(
    new Set(options?.sections?.map((entry) => entry.trim()).filter(Boolean) ?? []),
  );
  try {
    return await client.request<ConfigSchemaResponse>(
      "config.schema",
      sections.length ? { sections } : {},
    );
  } catch (error) {
    if (sections.length > 0 && isUnsupportedSectionsError(error)) {
      return client.request<ConfigSchemaResponse>("config.schema", {});
    }
    if (sections.length <= 1) {
      throw error;
    }
    let perSection: ConfigSchemaResponse[];
    try {
      perSection = await Promise.all(
        sections.map((section) =>
          client.request<ConfigSchemaResponse>("config.schema", {
            sections: [section],
          }),
        ),
      );
    } catch (perSectionError) {
      if (isUnsupportedSectionsError(perSectionError)) {
        return client.request<ConfigSchemaResponse>("config.schema", {});
      }
      throw perSectionError;
    }
    return mergeConfigSchemaResponses(perSection);
  }
}

function buildConfigSchemaCacheKey(options?: LoadConfigSchemaOptions): string {
  const sections = Array.from(
    new Set(options?.sections?.map((entry) => entry.trim()).filter(Boolean) ?? []),
  ).toSorted((a, b) => a.localeCompare(b));
  return sections.length > 0 ? `sections:${sections.join(",")}` : "full";
}

export async function loadConfig(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configLoading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<ConfigSnapshot>("config.get", {});
    applyConfigSnapshot(state, res);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configLoading = false;
  }
}

export async function loadConfigSchema(state: ConfigState, options?: LoadConfigSchemaOptions) {
  if (!state.client || !state.connected) {
    return;
  }
  const cacheKey = buildConfigSchemaCacheKey(options);
  const cached = configSchemaCache.get(cacheKey);
  if (cached) {
    applyConfigSchema(state, cached);
    return;
  }

  const pending = configSchemaRequestCache.get(cacheKey);
  if (pending) {
    state.configSchemaLoading = true;
    try {
      applyConfigSchema(state, await pending);
    } catch (err) {
      state.lastError = String(err);
    } finally {
      state.configSchemaLoading = false;
    }
    return;
  }

  state.configSchemaLoading = true;
  const requestPromise = requestConfigSchema(state.client, options);
  configSchemaRequestCache.set(cacheKey, requestPromise);
  try {
    const res = await requestPromise;
    configSchemaCache.set(cacheKey, res);
    applyConfigSchema(state, res);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    configSchemaRequestCache.delete(cacheKey);
    state.configSchemaLoading = false;
  }
}

export function applyConfigSchema(state: ConfigState, res: ConfigSchemaResponse) {
  state.configSchema = res.schema ?? null;
  state.configUiHints = res.uiHints ?? {};
  state.configSchemaVersion = res.version ?? null;
}

export function applyConfigSnapshot(state: ConfigState, snapshot: ConfigSnapshot) {
  state.configSnapshot = snapshot;
  const rawAvailable = typeof snapshot.raw === "string";
  if (!rawAvailable && state.configFormMode === "raw") {
    state.configFormMode = "form";
  }
  const rawFromSnapshot: string =
    typeof snapshot.raw === "string"
      ? snapshot.raw
      : snapshot.config && typeof snapshot.config === "object"
        ? serializeConfigForm(snapshot.config)
        : state.configRaw;
  if (!state.configFormDirty || state.configFormMode === "raw") {
    state.configRaw = rawFromSnapshot;
  } else if (state.configForm) {
    state.configRaw = serializeConfigForm(state.configForm);
  } else {
    state.configRaw = rawFromSnapshot;
  }
  state.configValid = typeof snapshot.valid === "boolean" ? snapshot.valid : null;
  state.configIssues = Array.isArray(snapshot.issues) ? snapshot.issues : [];

  if (!state.configFormDirty) {
    state.configForm = cloneConfigObject(snapshot.config ?? {});
    state.configFormOriginal = cloneConfigObject(snapshot.config ?? {});
    state.configRawOriginal = rawFromSnapshot;
  }
}

function asJsonSchema(value: unknown): JsonSchema | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonSchema;
}

/**
 * Serialize the form state for submission to `config.set` / `config.apply`.
 *
 * HTML `<input>` elements produce string `.value` properties, so numeric and
 * boolean config fields can leak into `configForm` as strings.  We coerce
 * them back to their schema-defined types before JSON serialization so the
 * gateway's Zod validation always sees correctly typed values.
 */
function serializeFormForSubmit(state: ConfigState): string {
  if (state.configFormMode === "raw" && typeof state.configSnapshot?.raw !== "string") {
    throw new Error("Raw config editing is unavailable for this snapshot. Switch to Form mode.");
  }
  if (state.configFormMode !== "form" || !state.configForm) {
    return state.configRaw;
  }
  const schema = asJsonSchema(state.configSchema);
  const form = schema
    ? (coerceFormValues(state.configForm, schema) as Record<string, unknown>)
    : state.configForm;
  return serializeConfigForm(form);
}

type ConfigSubmitMethod = "config.set" | "config.apply";
type ConfigSubmitBusyKey = "configSaving" | "configApplying";

async function submitConfigChange(
  state: ConfigState,
  method: ConfigSubmitMethod,
  busyKey: ConfigSubmitBusyKey,
  extraParams: Record<string, unknown> = {},
) {
  if (!state.client || !state.connected) {
    return;
  }
  state[busyKey] = true;
  state.lastError = null;
  try {
    const raw = serializeFormForSubmit(state);
    const baseHash = state.configSnapshot?.hash;
    if (!baseHash) {
      state.lastError = "Config hash missing; reload and retry.";
      return;
    }
    await state.client.request(method, { raw, baseHash, ...extraParams });
    state.configFormDirty = false;
    await loadConfig(state);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state[busyKey] = false;
  }
}

export async function saveConfig(state: ConfigState) {
  await submitConfigChange(state, "config.set", "configSaving");
}

export async function applyConfig(state: ConfigState) {
  await submitConfigChange(state, "config.apply", "configApplying", {
    sessionKey: state.applySessionKey,
  });
}

export async function runUpdate(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.updateRunning = true;
  state.lastError = null;
  try {
    const res = await state.client.request<{
      ok?: boolean;
      result?: { status?: string; reason?: string };
    }>("update.run", {
      sessionKey: state.applySessionKey,
    });
    if (res && res.ok === false) {
      const status = res.result?.status ?? "error";
      const reason = res.result?.reason ?? "Update failed.";
      state.lastError = `Update ${status}: ${reason}`;
    }
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.updateRunning = false;
  }
}

function mutateConfigForm(state: ConfigState, mutate: (draft: Record<string, unknown>) => void) {
  const base = cloneConfigObject(state.configForm ?? state.configSnapshot?.config ?? {});
  mutate(base);
  state.configForm = base;
  state.configFormDirty = true;
  if (state.configFormMode === "form") {
    state.configRaw = serializeConfigForm(base);
  }
}

export function updateConfigFormValue(
  state: ConfigState,
  path: Array<string | number>,
  value: unknown,
) {
  mutateConfigForm(state, (draft) => setPathValue(draft, path, value));
}

export function removeConfigFormValue(state: ConfigState, path: Array<string | number>) {
  mutateConfigForm(state, (draft) => removePathValue(draft, path));
}

export function findAgentConfigEntryIndex(
  config: Record<string, unknown> | null,
  agentId: string,
): number {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return -1;
  }
  const list = (config as { agents?: { list?: unknown[] } } | null)?.agents?.list;
  if (!Array.isArray(list)) {
    return -1;
  }
  return list.findIndex(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      "id" in entry &&
      (entry as { id?: string }).id === normalizedAgentId,
  );
}

export function ensureAgentConfigEntry(state: ConfigState, agentId: string): number {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return -1;
  }
  const source =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const existingIndex = findAgentConfigEntryIndex(source, normalizedAgentId);
  if (existingIndex >= 0) {
    return existingIndex;
  }
  const list = (source as { agents?: { list?: unknown[] } } | null)?.agents?.list;
  const nextIndex = Array.isArray(list) ? list.length : 0;
  updateConfigFormValue(state, ["agents", "list", nextIndex, "id"], normalizedAgentId);
  return nextIndex;
}

export async function openConfigFile(state: ConfigState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("config.openFile", {});
  } catch {
    const path = state.configSnapshot?.path;
    if (path) {
      try {
        await navigator.clipboard.writeText(path);
      } catch {
        // ignore
      }
    }
  }
}
