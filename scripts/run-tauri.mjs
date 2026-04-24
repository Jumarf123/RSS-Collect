import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const tauriBinary = process.platform === "win32"
  ? path.resolve("node_modules", ".bin", "tauri.cmd")
  : path.resolve("node_modules", ".bin", "tauri");

const environment = { ...process.env };
const extraLibDir = process.platform === "win32" ? findLegacyLibDir() : null;

if (extraLibDir) {
  environment.LIB = environment.LIB ? `${extraLibDir};${environment.LIB}` : extraLibDir;
}

const command = process.platform === "win32" ? `"${tauriBinary}"` : tauriBinary;

const child = spawn(command, process.argv.slice(2), {
  stdio: "inherit",
  env: environment,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

function findLegacyLibDir() {
  const roots = [
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC",
  ];

  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }

    const versions = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .sort()
      .reverse();

    for (const versionDir of versions) {
      const candidate = path.join(versionDir, "lib", "onecore", "x64");
      if (existsSync(path.join(candidate, "legacy_stdio_definitions.lib"))) {
        return candidate;
      }
    }
  }

  return null;
}
