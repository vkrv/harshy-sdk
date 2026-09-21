import type { PermissionResult, PermissionStatus } from "./types.js";

export function permissionResult(overrides: Partial<PermissionResult> = {}): PermissionResult {
  return {
    location: "undetermined",
    backgroundLocation: "undetermined",
    motion: "undetermined",
    notifications: "undetermined",
    ...overrides,
  };
}

export function grantedPermissions(): PermissionResult {
  return permissionResult({
    location: "granted",
    backgroundLocation: "granted",
    motion: "granted",
    notifications: "granted",
  });
}

export function isLocationGranted(status: PermissionResult): boolean {
  return status.location === "granted";
}

export function permissionLabel(status: PermissionStatus): string {
  if (status === "granted") {
    return "Granted";
  }
  if (status === "denied") {
    return "Denied";
  }
  return "Not asked";
}
