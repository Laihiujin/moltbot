import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import {
  collectChannelSchemaMetadata,
  collectPluginSchemaMetadata,
} from "./channel-config-metadata.js";
import { loadConfig, readConfigFileSnapshot } from "./config.js";
import type { OpenClawConfig } from "./config.js";
import { buildConfigSchema, type ConfigSchemaResponse } from "./schema.js";
import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";

function loadManifestRegistry(
  config: OpenClawConfig,
  options?: {
    cache?: boolean;
    env?: NodeJS.ProcessEnv;
  },
) {
  const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
  return loadPluginManifestRegistry({
    config,
    cache: options?.cache,
    env: options?.env,
    workspaceDir,
  });
}

let cachedGatewayRuntimeSchema:
  | {
      config: OpenClawConfig;
      registry: PluginManifestRegistry;
      schema: ConfigSchemaResponse;
    }
  | null = null;

export function loadGatewayRuntimeConfigSchema(): ConfigSchemaResponse {
  const config = loadConfig();
  const registry = loadManifestRegistry(config, { cache: true });
  if (cachedGatewayRuntimeSchema?.config === config && cachedGatewayRuntimeSchema.registry === registry) {
    return cachedGatewayRuntimeSchema.schema;
  }
  const schema = buildConfigSchema({
    plugins: collectPluginSchemaMetadata(registry),
    channels: collectChannelSchemaMetadata(registry),
  });
  cachedGatewayRuntimeSchema = {
    config,
    registry,
    schema,
  };
  return schema;
}

export async function readBestEffortRuntimeConfigSchema(): Promise<ConfigSchemaResponse> {
  const snapshot = await readConfigFileSnapshot();
  const config = snapshot.valid ? snapshot.config : { plugins: { enabled: true } };
  const registry = loadManifestRegistry(config, { cache: false });
  return buildConfigSchema({
    plugins: snapshot.valid ? collectPluginSchemaMetadata(registry) : [],
    channels: collectChannelSchemaMetadata(registry),
  });
}
