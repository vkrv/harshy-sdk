import { describe, expect, it } from "vitest";

import {
  ARCHIVE_INDEX_FILE,
  archiveFileName,
  archiveIndexPayload,
  createIndexedArchive,
  createMemoryJsonFileStore,
  createMemoryKeyValue,
  createPrefixedJsonFileStore,
  parseArchiveIndex,
} from "./index";

type Item = { id: string; n: number };

function createArchive(
  store = createMemoryJsonFileStore(),
  extras: { maxItems?: number; reserved?: string[] } = {},
) {
  return {
    store,
    archive: createIndexedArchive<Item>({
      store,
      parseItem: (value) => {
        if (typeof value !== "object" || value === null) {
          return null;
        }
        const item = value as Item;
        return typeof item.id === "string" && typeof item.n === "number" ? item : null;
      },
      getId: (item) => item.id,
      reserved: extras.reserved,
      maxItems: extras.maxItems,
    }),
  };
}

describe("json file store", () => {
  it("clones values so callers cannot mutate stored JSON", async () => {
    const store = createMemoryJsonFileStore();
    const value = { n: 1 };
    await store.write("a.json", value);
    value.n = 9;
    expect(await store.read("a.json")).toEqual({ n: 1 });
  });

  it("stores one JSON document per name behind a key/value map", async () => {
    const kv = createMemoryKeyValue();
    const store = createPrefixedJsonFileStore(kv, "lab.");
    await store.write("trip.json", { id: "trip" });
    expect(await store.list()).toEqual(["trip.json"]);
    expect(await store.read("trip.json")).toEqual({ id: "trip" });
    await store.remove("trip.json");
    expect(await store.list()).toEqual([]);
    expect(await store.read("trip.json")).toBeNull();
  });
});

describe("indexed archive", () => {
  it("sanitizes ids and keeps index.json reserved", () => {
    expect(archiveFileName("trip-1/../ok")).toBe("trip-1_.._ok.json");
    expect(archiveFileName("")).toBe("item.json");
    expect(archiveFileName("", "trip")).toBe("trip.json");
    expect(parseArchiveIndex(["b", "a"])).toEqual(["b", "a"]);
    expect(parseArchiveIndex(archiveIndexPayload(["b"]))).toEqual(["b"]);
    expect(parseArchiveIndex(null)).toBeNull();
  });

  it("round-trips items newest-first and upserts by id", async () => {
    const { archive } = createArchive();
    await archive.put({ id: "a", n: 1 });
    await archive.put({ id: "b", n: 2 });
    expect((await archive.load()).map((item) => item.id)).toEqual(["b", "a"]);
    await archive.put({ id: "a", n: 3 });
    const loaded = await archive.load();
    expect(loaded.map((item) => item.id)).toEqual(["a", "b"]);
    expect(loaded[0]?.n).toBe(3);
  });

  it("trims maxItems and deletes leftover files", async () => {
    const { archive, store } = createArchive(createMemoryJsonFileStore(), { maxItems: 2 });
    await archive.put({ id: "a", n: 1 });
    await archive.put({ id: "b", n: 2 });
    await archive.put({ id: "c", n: 3 });
    expect((await archive.load()).map((item) => item.id)).toEqual(["c", "b"]);
    expect(await store.list()).toEqual(expect.arrayContaining(["c.json", "b.json", ARCHIVE_INDEX_FILE]));
    expect(await store.read("a.json")).toBeNull();
  });

  it("skips a corrupt item file without wiping the rest", async () => {
    const store = createMemoryJsonFileStore({
      [ARCHIVE_INDEX_FILE]: archiveIndexPayload(["ok", "bad"]),
      "ok.json": { id: "ok", n: 1 },
      "bad.json": { truncated: true },
    });
    const { archive } = createArchive(store);
    expect(await archive.load()).toEqual([{ id: "ok", n: 1 }]);
  });

  it("scans the directory when the index is missing", async () => {
    const store = createMemoryJsonFileStore({
      "b.json": { id: "b", n: 2 },
      "a.json": { id: "a", n: 1 },
    });
    const { archive } = createArchive(store);
    expect((await archive.load()).map((item) => item.id).sort()).toEqual(["a", "b"]);
  });

  it("serializes concurrent puts so both items survive", async () => {
    const { archive } = createArchive();
    await Promise.all([
      archive.put({ id: "a", n: 1 }),
      archive.put({ id: "b", n: 2 }),
    ]);
    expect((await archive.load()).map((item) => item.id).sort()).toEqual(["a", "b"]);
  });

  it("does not treat reserved files as items and avoids clobbering them", async () => {
    const store = createMemoryJsonFileStore({
      "detector.json": { harshAccelMps2: 3 },
    });
    const { archive } = createArchive(store, { reserved: ["detector.json"] });
    await archive.put({ id: "detector", n: 1 });
    expect(await store.read("detector.json")).toEqual({ harshAccelMps2: 3 });
    expect(await store.read("item-detector.json")).toEqual({ id: "detector", n: 1 });
    expect((await archive.load()).map((item) => item.id)).toEqual(["detector"]);
  });

  it("keeps an empty index instead of resurrecting deleted files", async () => {
    const { archive, store } = createArchive();
    await archive.put({ id: "gone", n: 1 });
    await archive.replaceAll([]);
    await store.write("gone.json", { id: "gone", n: 9 });
    expect(await archive.load()).toEqual([]);
  });
});
