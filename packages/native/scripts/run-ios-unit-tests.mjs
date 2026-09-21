#!/usr/bin/env node
/**
 * Runs Swift PM tests for HarshyMath (HarshyRoadStamp) on macOS.
 * Skips with exit 0 on non-macOS so Linux CI can rely on Android JUnit.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("Skipping iOS Swift tests (macOS only).");
  process.exit(0);
}

const mathPackage = join(dirname(fileURLToPath(import.meta.url)), "..", "HarshyMath");
const result = spawnSync("swift", ["test", "--package-path", mathPackage], {
  cwd: mathPackage,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
