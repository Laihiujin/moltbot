import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as tar from "tar";

const BUNDLED_RUNTIME_ENTRIES = ["package.json", "dist", "node_modules", "docs"];
const FORBIDDEN_RUNTIME_STATE_ENTRIES = [
  ".openclaw",
  "openclaw.json",
  "models.json",
  "secrets.json",
  "channel-bindings.json",
  "bindings.json",
];

function runOrThrow(command, args, cwd, useShell = false) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: useShell,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${command} ${args.join(" ")}), exit code ${result.status ?? "null"}`,
    );
  }
}

function resolveTauriSidecarBinaryName() {
  if (process.platform === "win32" && process.arch === "x64") {
    return "node-x86_64-pc-windows-msvc.exe";
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "node-aarch64-apple-darwin";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "node-x86_64-apple-darwin";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "node-x86_64-unknown-linux-gnu";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "node-aarch64-unknown-linux-gnu";
  }
  throw new Error(`Unsupported desktop bundle host: ${process.platform}/${process.arch}`);
}

function ensureNodeBinary(desktopTauriSrcTauriDir) {
  const binariesDir = join(desktopTauriSrcTauriDir, "binaries");
  const targetBinary = join(desktopTauriSrcTauriDir, "binaries", resolveTauriSidecarBinaryName());
  const sourceNodeBinary = process.execPath;
  if (!existsSync(sourceNodeBinary)) {
    throw new Error(`Unable to find Node executable at: ${sourceNodeBinary}`);
  }

  mkdirSync(dirname(targetBinary), { recursive: true });
  for (const entry of readdirSync(binariesDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.startsWith("gateway-") || entry.name.startsWith("node-")) {
      safeRm(join(binariesDir, entry.name));
    }
  }
  cpSync(sourceNodeBinary, targetBinary);
  if (process.platform !== "win32") {
    chmodSync(targetBinary, 0o755);
  }
}

function assertNoBundledUserState(runtimeOpenclawDir) {
  for (const name of FORBIDDEN_RUNTIME_STATE_ENTRIES) {
    const path = join(runtimeOpenclawDir, name);
    if (existsSync(path)) {
      throw new Error(`Refusing to bundle local runtime state into installer: ${path}`);
    }
  }
}

function safeRm(path) {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[prepare-runtime] skip delete: ${path} (${message})`);
  }
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const desktopTauriDir = resolve(scriptDir, "..");
  const desktopTauriSrcTauriDir = resolve(desktopTauriDir, "src-tauri");
  const repoRoot = resolve(desktopTauriDir, "..", "..");

  const distDir = join(repoRoot, "dist");
  if (!existsSync(distDir)) {
    throw new Error(`Missing dist directory: ${distDir}. Run 'pnpm build' first.`);
  }

  ensureNodeBinary(desktopTauriSrcTauriDir);

  const runtimeRoot = join(desktopTauriSrcTauriDir, "runtime");
  const runtimeOpenclawDir = join(runtimeRoot, "openclaw");
  const runtimeArchivePath = join(runtimeRoot, "openclaw-runtime.tar.gz");
  const runtimeTemplatesDir = join(runtimeOpenclawDir, "docs", "reference", "templates");

  mkdirSync(runtimeOpenclawDir, { recursive: true });
  safeRm(join(runtimeOpenclawDir, "dist"));
  safeRm(runtimeTemplatesDir);
  safeRm(join(runtimeOpenclawDir, "node_modules"));
  safeRm(join(runtimeOpenclawDir, "package-lock.json"));
  safeRm(runtimeArchivePath);

  cpSync(join(repoRoot, "package.json"), join(runtimeOpenclawDir, "package.json"));
  cpSync(distDir, join(runtimeOpenclawDir, "dist"), { recursive: true });
  cpSync(
    join(repoRoot, "docs", "reference", "templates"),
    runtimeTemplatesDir,
    { recursive: true },
  );

  if (process.platform === "win32") {
    runOrThrow(
      "npm install --omit=dev --ignore-scripts --no-audit --no-fund",
      [],
      runtimeOpenclawDir,
      true,
    );
  } else {
    runOrThrow(
      "npm",
      ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      runtimeOpenclawDir,
    );
  }

  assertNoBundledUserState(runtimeOpenclawDir);

  await tar.c(
    {
      cwd: runtimeOpenclawDir,
      file: runtimeArchivePath,
      gzip: true,
      portable: true,
    },
    BUNDLED_RUNTIME_ENTRIES,
  );
}

await main();
