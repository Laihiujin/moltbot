import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function runOrThrow(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
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

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const desktopTauriDir = resolve(scriptDir, "..");
  const args = process.argv.slice(2);
  const firstArg = args[0] ?? "";

  const shouldBump = firstArg === "build" && process.env.OPENCLAW_DESKTOP_AUTO_BUMP !== "0";
  if (shouldBump) {
    runOrThrow(process.execPath, [resolve(scriptDir, "bump-desktop-version.mjs")], desktopTauriDir);
  }

  const tauriEntrypoint = resolve(
    desktopTauriDir,
    "node_modules",
    "@tauri-apps",
    "cli",
    "tauri.js",
  );
  runOrThrow(process.execPath, [tauriEntrypoint, ...args], desktopTauriDir);
}

main();
