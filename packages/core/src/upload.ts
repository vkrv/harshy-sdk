import { sessionExportSchema } from "./schemas.js";
import type { SessionExport, UploadAdapter } from "./types.js";

export async function uploadSession(
  session: SessionExport,
  adapter: UploadAdapter | null | undefined,
): Promise<void> {
  if (!adapter) {
    throw new Error("No upload adapter configured");
  }
  const parsed = sessionExportSchema.parse(session);
  await adapter.upload(parsed);
}
