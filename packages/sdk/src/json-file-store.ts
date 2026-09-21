export type JsonFileStore = {
  read: (name: string) => Promise<unknown | null>;
  write: (name: string, value: unknown) => Promise<void>;
  remove: (name: string) => Promise<void>;
  list: () => Promise<string[]>;
};

export type JsonKeyValue = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function parseJson(raw: string | null): unknown | null {
  if (raw == null) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** In-memory files for tests and hosts that do not want disk yet. */
export function createMemoryJsonFileStore(
  initial: Record<string, unknown> = {},
): JsonFileStore {
  const files = new Map<string, string>();
  for (const [name, value] of Object.entries(initial)) {
    files.set(name, JSON.stringify(value));
  }
  return {
    async read(name) {
      return parseJson(files.get(name) ?? null);
    },
    async write(name, value) {
      files.set(name, JSON.stringify(value));
    },
    async remove(name) {
      files.delete(name);
    },
    async list() {
      return [...files.keys()];
    },
  };
}

/** In-memory key/value map that matches AsyncStorage's string API. */
export function createMemoryKeyValue(
  initial: Record<string, string> = {},
): JsonKeyValue {
  const items = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return items.get(key) ?? null;
    },
    async setItem(key, value) {
      items.set(key, value);
    },
    async removeItem(key) {
      items.delete(key);
    },
  };
}

/**
 * One JSON document per filename, stored behind a string key/value API
 * (AsyncStorage, SecureStore, tests). A separate list key tracks names.
 */
export function createPrefixedJsonFileStore(
  kv: JsonKeyValue,
  prefix: string,
): JsonFileStore {
  const listKey = `${prefix}__names`;
  const fileKey = (name: string) => `${prefix}${name}`;

  const readNames = async (): Promise<string[]> => {
    const value = parseJson(await kv.getItem(listKey));
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      return [];
    }
    return value;
  };

  return {
    async read(name) {
      return parseJson(await kv.getItem(fileKey(name)));
    },
    async write(name, value) {
      await kv.setItem(fileKey(name), JSON.stringify(value));
      const names = await readNames();
      if (!names.includes(name)) {
        await kv.setItem(listKey, JSON.stringify([...names, name]));
      }
    },
    async remove(name) {
      await kv.removeItem(fileKey(name));
      await kv.setItem(
        listKey,
        JSON.stringify((await readNames()).filter((entry) => entry !== name)),
      );
    },
    async list() {
      return readNames();
    },
  };
}
