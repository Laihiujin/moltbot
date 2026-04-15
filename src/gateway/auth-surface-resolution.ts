import crypto from "node:crypto";
import { readConfigFileSnapshot, replaceConfigFile } from "../config/config.js";
import type { OpenClawConfig } from "../config/types.js";
import { hasConfiguredSecretInput } from "../config/types.secrets.js";
import { trimToUndefined, type ExplicitGatewayAuth } from "./credentials.js";
import { resolveConfiguredSecretInputString } from "./resolve-configured-secret-input-string.js";

type GatewayCredentialPath =
  | "gateway.auth.token"
  | "gateway.auth.password"
  | "gateway.remote.token"
  | "gateway.remote.password";

type ResolvedGatewayCredential = {
  value?: string;
  unresolvedRefReason?: string;
};

async function resolveGatewayCredential(params: {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  diagnostics: string[];
  path: GatewayCredentialPath;
  value: unknown;
}): Promise<ResolvedGatewayCredential> {
  const resolved = await resolveConfiguredSecretInputString({
    config: params.config,
    env: params.env,
    value: params.value,
    path: params.path,
    unresolvedReasonStyle: "detailed",
  });
  if (resolved.unresolvedRefReason) {
    params.diagnostics.push(resolved.unresolvedRefReason);
  }
  return resolved;
}

function withDiagnostics<T extends object>(params: {
  diagnostics: string[];
  result: T;
}): T & { diagnostics?: string[] } {
  return params.diagnostics.length > 0
    ? { ...params.result, diagnostics: params.diagnostics }
    : params.result;
}

function generateGatewayToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

async function persistAutoAcquiredGatewayToken(params: {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
}): Promise<{ token?: string; failureReason?: string; autoTokenAcquired?: boolean }> {
  const snapshot = await readConfigFileSnapshot();
  if (snapshot.exists && !snapshot.valid) {
    return {
      failureReason: "Config is invalid. Run `openclaw doctor` before retrying gateway auth.",
    };
  }

  const sourceConfig =
    snapshot.valid && snapshot.exists ? (snapshot.sourceConfig ?? snapshot.config) : params.config;
  const auth = sourceConfig.gateway?.auth;
  if (auth?.mode === "password" || trimToUndefined(params.env.OPENCLAW_GATEWAY_PASSWORD)) {
    return {
      failureReason: "Missing gateway auth password.",
    };
  }

  const existingToken =
    trimToUndefined(params.env.OPENCLAW_GATEWAY_TOKEN) ??
    trimToUndefined(typeof auth?.token === "string" ? auth.token : undefined);
  if (existingToken) {
    return { token: existingToken };
  }

  const token = generateGatewayToken();
  const nextConfig: OpenClawConfig = {
    ...sourceConfig,
    gateway: {
      ...sourceConfig.gateway,
      auth: {
        ...sourceConfig.gateway?.auth,
        mode: "token",
        token,
        password: undefined,
      },
    },
  };
  try {
    await replaceConfigFile({
      nextConfig,
      ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
    });
    return {
      token,
      autoTokenAcquired: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      failureReason: `Failed to auto-configure a local gateway token: ${message}`,
    };
  }
}

export async function resolveGatewayProbeSurfaceAuth(params: {
  config: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  surface: "local" | "remote";
}): Promise<{ token?: string; password?: string; diagnostics?: string[] }> {
  const env = params.env ?? process.env;
  const diagnostics: string[] = [];
  const authMode = params.config.gateway?.auth?.mode;

  if (params.surface === "remote") {
    const remoteToken = await resolveGatewayCredential({
      config: params.config,
      env,
      diagnostics,
      path: "gateway.remote.token",
      value: params.config.gateway?.remote?.token,
    });
    const remotePassword = remoteToken.value
      ? { value: undefined }
      : await resolveGatewayCredential({
          config: params.config,
          env,
          diagnostics,
          path: "gateway.remote.password",
          value: params.config.gateway?.remote?.password,
        });
    return withDiagnostics({
      diagnostics,
      result: { token: remoteToken.value, password: remotePassword.value },
    });
  }

  if (authMode === "none" || authMode === "trusted-proxy") {
    return {};
  }

  const envToken = trimToUndefined(env.OPENCLAW_GATEWAY_TOKEN);
  const envPassword = trimToUndefined(env.OPENCLAW_GATEWAY_PASSWORD);

  if (authMode === "token") {
    const token = await resolveGatewayCredential({
      config: params.config,
      env,
      diagnostics,
      path: "gateway.auth.token",
      value: params.config.gateway?.auth?.token,
    });
    return token.value
      ? withDiagnostics({ diagnostics, result: { token: token.value } })
      : envToken
        ? { token: envToken }
        : withDiagnostics({ diagnostics, result: {} });
  }

  if (authMode === "password") {
    const password = await resolveGatewayCredential({
      config: params.config,
      env,
      diagnostics,
      path: "gateway.auth.password",
      value: params.config.gateway?.auth?.password,
    });
    return password.value
      ? withDiagnostics({ diagnostics, result: { password: password.value } })
      : envPassword
        ? { password: envPassword }
        : withDiagnostics({ diagnostics, result: {} });
  }

  const token = await resolveGatewayCredential({
    config: params.config,
    env,
    diagnostics,
    path: "gateway.auth.token",
    value: params.config.gateway?.auth?.token,
  });
  if (token.value) {
    return withDiagnostics({ diagnostics, result: { token: token.value } });
  }
  if (envToken) {
    return { token: envToken };
  }
  if (envPassword) {
    return withDiagnostics({ diagnostics, result: { password: envPassword } });
  }
  const password = await resolveGatewayCredential({
    config: params.config,
    env,
    diagnostics,
    path: "gateway.auth.password",
    value: params.config.gateway?.auth?.password,
  });
  return withDiagnostics({
    diagnostics,
    result: { token: token.value, password: password.value },
  });
}

export async function resolveGatewayInteractiveSurfaceAuth(params: {
  config: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  explicitAuth?: ExplicitGatewayAuth;
  surface: "local" | "remote";
}): Promise<{
  token?: string;
  password?: string;
  failureReason?: string;
  autoTokenAcquired?: boolean;
}> {
  const env = params.env ?? process.env;
  const diagnostics: string[] = [];
  const explicitToken = trimToUndefined(params.explicitAuth?.token);
  const explicitPassword = trimToUndefined(params.explicitAuth?.password);
  const envToken = trimToUndefined(env.OPENCLAW_GATEWAY_TOKEN);
  const envPassword = trimToUndefined(env.OPENCLAW_GATEWAY_PASSWORD);

  if (params.surface === "remote") {
    const remoteToken = explicitToken
      ? { value: explicitToken }
      : await resolveGatewayCredential({
          config: params.config,
          env,
          diagnostics,
          path: "gateway.remote.token",
          value: params.config.gateway?.remote?.token,
        });
    const remotePassword =
      explicitPassword || envPassword
        ? { value: explicitPassword ?? envPassword }
        : await resolveGatewayCredential({
            config: params.config,
            env,
            diagnostics,
            path: "gateway.remote.password",
            value: params.config.gateway?.remote?.password,
          });
    const token = explicitToken ?? remoteToken.value;
    const password = explicitPassword ?? envPassword ?? remotePassword.value;
    return token || password
      ? { token, password }
      : {
          failureReason:
            remoteToken.unresolvedRefReason ??
            remotePassword.unresolvedRefReason ??
            "Missing gateway auth credentials.",
        };
  }

  const authMode = params.config.gateway?.auth?.mode;
  if (authMode === "none" || authMode === "trusted-proxy") {
    return {
      token: explicitToken ?? envToken,
      password: explicitPassword ?? envPassword,
    };
  }

  const hasConfiguredToken = hasConfiguredSecretInput(
    params.config.gateway?.auth?.token,
    params.config.secrets?.defaults,
  );
  const hasConfiguredPassword = hasConfiguredSecretInput(
    params.config.gateway?.auth?.password,
    params.config.secrets?.defaults,
  );

  const resolveToken = async (opts?: { allowAutoCreate?: boolean }) => {
    const localToken = explicitToken
      ? { value: explicitToken }
      : await resolveGatewayCredential({
          config: params.config,
          env,
          diagnostics,
          path: "gateway.auth.token",
          value: params.config.gateway?.auth?.token,
        });
    const token = explicitToken ?? localToken.value ?? envToken;
    if (!token && !localToken.unresolvedRefReason && opts?.allowAutoCreate) {
      const autoToken = await persistAutoAcquiredGatewayToken({
        config: params.config,
        env,
      });
      return {
        token: autoToken.token,
        failureReason: autoToken.failureReason,
        autoTokenAcquired: autoToken.autoTokenAcquired,
      };
    }
    return {
      token,
      failureReason: token
        ? undefined
        : (localToken.unresolvedRefReason ?? "Missing gateway auth token."),
      autoTokenAcquired: false,
    };
  };

  const resolvePassword = async () => {
    const localPassword =
      explicitPassword || envPassword
        ? { value: explicitPassword ?? envPassword }
        : await resolveGatewayCredential({
            config: params.config,
            env,
            diagnostics,
            path: "gateway.auth.password",
            value: params.config.gateway?.auth?.password,
          });
    const password = explicitPassword ?? envPassword ?? localPassword.value;
    return {
      password,
      failureReason: password
        ? undefined
        : (localPassword.unresolvedRefReason ?? "Missing gateway auth password."),
    };
  };

  if (authMode === "password") {
    const password = await resolvePassword();
    return {
      token: explicitToken ?? envToken,
      password: password.password,
      failureReason: password.failureReason,
    };
  }

  if (authMode === "token") {
    const token = await resolveToken({ allowAutoCreate: true });
    return {
      token: token.token,
      password: explicitPassword ?? envPassword,
      failureReason: token.failureReason,
      autoTokenAcquired: token.autoTokenAcquired,
    };
  }

  const shouldUsePassword =
    Boolean(explicitPassword ?? envPassword) || (hasConfiguredPassword && !hasConfiguredToken);
  if (shouldUsePassword) {
    const password = await resolvePassword();
    return {
      token: explicitToken ?? envToken,
      password: password.password,
      failureReason: password.failureReason,
    };
  }

  const token = await resolveToken({ allowAutoCreate: !hasConfiguredToken });
  return {
    token: token.token,
    password: explicitPassword ?? envPassword,
    failureReason: token.failureReason,
    autoTokenAcquired: token.autoTokenAcquired,
  };
}
