import { compactSessionExport, parseSessionExport, type SessionExport } from "@harshy/core";

import {
  DEFAULT_ARCHIVE_MAX_ITEMS,
  createIndexedArchive,
  type IndexedArchive,
} from "./indexed-archive";
import type { JsonFileStore } from "./json-file-store";

export function parseArchivedSession(value: unknown): SessionExport | null {
  try {
    return parseSessionExport(value);
  } catch {
    return null;
  }
}

export function archiveSessionExport(session: SessionExport): SessionExport {
  return compactSessionExport(session);
}

export function createSessionArchive(
  store: JsonFileStore,
  options: { maxItems?: number } = {},
): IndexedArchive<SessionExport> {
  const archive = createIndexedArchive({
    store,
    parseItem: parseArchivedSession,
    getId: (session) => session.sessionId,
    maxItems: options.maxItems ?? DEFAULT_ARCHIVE_MAX_ITEMS,
  });
  return {
    load: archive.load,
    replaceAll: (items) => archive.replaceAll(items.map(archiveSessionExport)),
    put: (item) => archive.put(archiveSessionExport(item)),
    remove: archive.remove,
  };
}
