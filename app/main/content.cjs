function createContentIpc({ ipcMain, fs, path, contentDir }) {
  let runtimeGameDataCache = null;

  function readJsonFile(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return fallback;
    }
  }

  function materializeContentEntity(entity) {
    const output = { ...(entity?.source || {}) };
    if (entity?.icon) output.icon = entity.icon;
    for (const [key, value] of Object.entries(entity?.overrides || {})) {
      if (value !== null && value !== undefined) output[key] = value;
    }
    return output;
  }

  function readContentCollection(relativeDir) {
    const dir = path.join(contentDir, "game", relativeDir);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .map((file) => readJsonFile(path.join(dir, file), null))
      .filter(Boolean);
  }

  function getRuntimeGameData() {
    if (runtimeGameDataCache) return runtimeGameDataCache;

    const aliases = readJsonFile(path.join(contentDir, "game", "aliases.json"), {});
    const items = readJsonFile(path.join(contentDir, "game", "curated-items.json"), {});

    const unitsFull = {};
    for (const entry of readContentCollection("units")) {
      unitsFull[entry.name] = {
        id: entry.gameId,
        ...materializeContentEntity(entry),
      };
    }

    const synergies = {};
    for (const entry of readContentCollection("synergies")) {
      synergies[entry.gameId] = materializeContentEntity(entry);
    }

    const relics = {};
    for (const entry of readContentCollection("relics")) {
      relics[entry.gameId] = materializeContentEntity(entry);
    }

    const itemsFull = {};
    for (const entry of readContentCollection("items")) {
      itemsFull[entry.gameId] = materializeContentEntity(entry);
    }

    const talents = {};
    for (const entry of readContentCollection("talents")) {
      const { slot, ...talent } = entry;
      talents[slot] = talent;
    }

    runtimeGameDataCache = {
      aliases,
      items,
      unitsFull,
      synergies,
      relics: { relics },
      itemsFull,
      talents,
    };
    return runtimeGameDataCache;
  }

  function register() {
    ipcMain.handle("data:units", async () => {
      const data = getRuntimeGameData();
      return { units: data.unitsFull, aliases: data.aliases };
    });
    ipcMain.handle("data:synergies", async () => getRuntimeGameData().synergies);
    ipcMain.handle("data:relics", async () => getRuntimeGameData().relics);
    ipcMain.handle("data:units_full", async () => getRuntimeGameData().unitsFull);
    ipcMain.handle("data:items", async () => getRuntimeGameData().items);
    ipcMain.handle("data:items_full", async () => getRuntimeGameData().itemsFull);
    ipcMain.handle("data:talents", async () => getRuntimeGameData().talents);
  }

  return { register, getRuntimeGameData };
}

module.exports = { createContentIpc };
