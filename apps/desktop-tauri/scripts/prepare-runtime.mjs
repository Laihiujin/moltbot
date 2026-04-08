import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

function ensureNodeBinary(desktopTauriSrcTauriDir) {
  const targetBinary = join(desktopTauriSrcTauriDir, "binaries", "node-x86_64-pc-windows-msvc.exe");
  const sourceNodeBinary = process.execPath;
  if (!existsSync(sourceNodeBinary)) {
    throw new Error(`Unable to find Node executable at: ${sourceNodeBinary}`);
  }

  mkdirSync(dirname(targetBinary), { recursive: true });
  cpSync(sourceNodeBinary, targetBinary);
}

function safeRm(path) {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[prepare-runtime] skip delete: ${path} (${message})`);
  }
}

function main() {
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
  const runtimeTemplatesDir = join(runtimeOpenclawDir, "docs", "reference", "templates");
  mkdirSync(runtimeOpenclawDir, { recursive: true });
  safeRm(join(runtimeOpenclawDir, "dist"));
  safeRm(runtimeTemplatesDir);

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
}

main();
