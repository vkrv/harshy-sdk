import type { JsonFileStore } from "./json-file-store";

export const ARCHIVE_INDEX_FILE = "index.json";
export const DEFAULT_ARCHIVE_MAX_ITEMS = 40;

export type ArchiveIndex = {
  version: 1;
  ids: string[];
};

export type IndexedArchive<T> = {
  load: () => Promise<T[]>;
  replaceAll: (items: T[]) => Promise<T[]>;
  put: (item: T) => Promise<T[]>;
  remove: (id: string) => Promise<T[]>;
};

export function archiveFileName(id: string, emptyFallback = "item"): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return `${safe || emptyFallback}.json`;
}

export function parseArchiveIndex(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const ids = (value as ArchiveIndex).ids;
  if (!Array.isArray(ids) || !ids.every((item) => typeof item === "string")) {
    return null;
  }
  return ids;
}

export function archiveIndexPayload(ids: string[]): ArchiveIndex {
  return { version: 1, ids };
}

function upsertById<T>(list: T[], item: T, getId: (value: T) => string, maxItems: number): T[] {
  const id = getId(item);
  return [item, ...list.filter((entry) => getId(entry) !== id)].slice(0, maxItems);
}

function orderByIds<T>(list: T[], ids: string[], getId: (value: T) => string): T[] {
  const byId = new Map(list.map((item) => [getId(item), item]));
  const ordered: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  for (const item of byId.values()) {
    ordered.push(item);
  }
  return ordered;
}

export function createIndexedArchive<T>(options: {
  store: JsonFileStore;
  parseItem: (value: unknown) => T | null;
  getId: (item: T) => string;
  fileName?: (id: string) => string;
  indexFile?: string;
  reserved?: readonly string[];
  maxItems?: number;
}): IndexedArchive<T> {
  const indexFile = options.indexFile ?? ARCHIVE_INDEX_FILE;
  const reserved = new Set([indexFile, ...(options.reserved ?? [])]);
  const maxItems = options.maxItems ?? DEFAULT_ARCHIVE_MAX_ITEMS;
  let chain: Promise<unknown> = Promise.resolve();

  const run = <R,>(work: () => Promise<R>): Promise<R> => {
    const next = chain.then(work, work);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const itemFileName = (id: string): string => {
    const name = (options.fileName ?? archiveFileName)(id);
    return reserved.has(name) ? `item-${name}` : name;
  };

  const isItemFile = (name: string) => name.endsWith(".json") && !reserved.has(name);

  const readItem = async (name: string): Promise<T | null> => {
    return options.parseItem(await options.store.read(name));
  };

  const loadUnlocked = async (): Promise<T[]> => {
    const indexIds = parseArchiveIndex(await options.store.read(indexFile));
    if (indexIds) {
      const fromIndex: T[] = [];
      for (const id of indexIds) {
        const item = await readItem(itemFileName(id));
        if (item && options.getId(item) === id) {
          fromIndex.push(item);
        }
      }
      if (fromIndex.length > 0 || indexIds.length === 0) {
        return fromIndex;
      }
    }

    const scanned: T[] = [];
    for (const name of await options.store.list()) {
      if (!isItemFile(name)) {
        continue;
      }
      const item = await readItem(name);
      if (item) {
        scanned.push(item);
      }
    }
    return indexIds ? orderByIds(scanned, indexIds, options.getId) : scanned;
  };

  const replaceAllUnlocked = async (items: T[]): Promise<T[]> => {
    const next = items.slice(0, maxItems);
    const keep = new Set<string>([indexFile, ...reserved]);
    for (const item of next) {
      const name = itemFileName(options.getId(item));
      keep.add(name);
      await options.store.write(name, item);
    }
    await options.store.write(
      indexFile,
      archiveIndexPayload(next.map((item) => options.getId(item))),
    );
    for (const name of await options.store.list()) {
      if (isItemFile(name) && !keep.has(name)) {
        await options.store.remove(name);
      }
    }
    return next;
  };

  return {
    load: () => run(loadUnlocked),
    replaceAll: (items) => run(() => replaceAllUnlocked(items)),
    put: (item) =>
      run(async () => {
        const current = await loadUnlocked();
        return replaceAllUnlocked(upsertById(current, item, options.getId, maxItems));
      }),
    remove: (id) =>
      run(async () => {
        const current = await loadUnlocked();
        return replaceAllUnlocked(current.filter((item) => options.getId(item) !== id));
      }),
  };
}
