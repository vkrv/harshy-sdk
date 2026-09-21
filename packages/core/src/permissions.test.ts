import { describe, expect, it } from "vitest";

import { grantedPermissions, isLocationGranted, permissionLabel, permissionResult } from "./permissions.js";

describe("permissionResult", () => {
  it("defaults to not asked and overlays known grants", () => {
    expect(permissionResult().location).toBe("undetermined");
    expect(permissionResult({ location: "granted" }).location).toBe("granted");
    expect(permissionResult({ location: "granted" }).backgroundLocation).toBe("undetermined");
  });
});

describe("isLocationGranted", () => {
  it("is the only hard gate to start a native trip", () => {
    expect(isLocationGranted(grantedPermissions())).toBe(true);
    expect(isLocationGranted(permissionResult({ location: "denied" }))).toBe(false);
  });
});

describe("permissionLabel", () => {
  it("names each status for host UI", () => {
    expect(permissionLabel("granted")).toBe("Granted");
    expect(permissionLabel("denied")).toBe("Denied");
    expect(permissionLabel("undetermined")).toBe("Not asked");
  });
});
