import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseSemver(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Expected semver-like version (x.y.z), got: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bumpPatchVersion(version) {
  const { major, minor, patch } = parseSemver(version);
  return `${major}.${minor}.${patch + 1}`;
}

function readCargoPackageVersion(cargoTomlRaw) {
  const match = cargoTomlRaw.match(/^\s*\[package\][\s\S]*?^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) {
    throw new Error("Unable to find package version in Cargo.toml");
  }
  return match[1];
}

function replaceCargoPackageVersion(cargoTomlRaw, nextVersion) {
  return cargoTomlRaw.replace(
    /^(\s*\[package\][\s\S]*?^\s*version\s*=\s*")([^"]+)("\s*$)/m,
    `$1${nextVersion}$3`,
  );
}

function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const desktopTauriDir = resolve(scriptDir, "..");
  const srcTauriDir = join(desktopTauriDir, "src-tauri");
  const packagePath = join(desktopTauriDir, "package.json");
  const tauriConfigPath = join(srcTauriDir, "tauri.conf.json");
  const cargoTomlPath = join(srcTauriDir, "Cargo.toml");

  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const cargoTomlRaw = readFileSync(cargoTomlPath, "utf8");

  const currentVersion =
    typeof tauriConfig.version === "string" && tauriConfig.version.trim()
      ? tauriConfig.version.trim()
      : typeof packageJson.version === "string" && packageJson.version.trim()
        ? packageJson.version.trim()
        : readCargoPackageVersion(cargoTomlRaw);

  const nextVersion = bumpPatchVersion(currentVersion);
  const nextCargoToml = replaceCargoPackageVersion(cargoTomlRaw, nextVersion);

  packageJson.version = nextVersion;
  tauriConfig.version = nextVersion;

  writeJsonFile(packagePath, packageJson);
  writeJsonFile(tauriConfigPath, tauriConfig);
  writeFileSync(cargoTomlPath, nextCargoToml);

  console.log(`[desktop-tauri] version ${currentVersion} -> ${nextVersion}`);
}

main();
