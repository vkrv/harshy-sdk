#!/usr/bin/env node
/**
 * Runs Kotlin JUnit via packages/native/android-unit (android-host sources).
 * Requires JDK 17+ and Android SDK (ANDROID_HOME or android-unit/local.properties).
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const unitDir = join(root, "android-unit");
const gradlew = join(unitDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");

if (!existsSync(gradlew)) {
  console.error("Missing android-unit/gradlew — native Android tests cannot run.");
  process.exit(1);
}

const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (process.platform === "darwin"
    ? `${process.env.HOME}/Library/Android/sdk`
    : `${process.env.HOME}/Android/Sdk`);

const localProps = join(unitDir, "local.properties");
if (!existsSync(localProps) && existsSync(sdk)) {
  writeFileSync(localProps, `sdk.dir=${sdk.replace(/\\/g, "/")}\n`);
}

if (!existsSync(localProps) && !existsSync(sdk)) {
  console.error(
    "Android SDK not found. Set ANDROID_HOME or create android-unit/local.properties with sdk.dir=...",
  );
  process.exit(1);
}

const result = spawnSync(gradlew, [":harshy:testDebugUnitTest", "--quiet"], {
  cwd: unitDir,
  stdio: "inherit",
  env: {
    ...process.env,
    ANDROID_HOME: process.env.ANDROID_HOME || sdk,
    ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || sdk,
  },
});

process.exit(result.status ?? 1);
