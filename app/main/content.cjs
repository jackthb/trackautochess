function createContentIpc({ ipcMain, fs, path, contentDir, channels }) {
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
    const itemLinks = readJsonFile(path.join(contentDir, "game", "item-links.json"), { links: [] });

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
      itemLinks,
      unitsFull,
      synergies,
      relics: { relics },
      itemsFull,
      talents,
    };
    return runtimeGameDataCache;
  }

  function register() {
    ipcMain.handle(channels.data.units, async () => {
      const data = getRuntimeGameData();
      return { units: data.unitsFull, aliases: data.aliases };
    });
    ipcMain.handle(channels.data.synergies, async () => getRuntimeGameData().synergies);
    ipcMain.handle(channels.data.relics, async () => getRuntimeGameData().relics);
    ipcMain.handle(channels.data.unitsFull, async () => getRuntimeGameData().unitsFull);
    ipcMain.handle(channels.data.items, async () => getRuntimeGameData().items);
    ipcMain.handle(channels.data.itemsFull, async () => getRuntimeGameData().itemsFull);
    ipcMain.handle(channels.data.itemLinks, async () => getRuntimeGameData().itemLinks);
    ipcMain.handle(channels.data.talents, async () => getRuntimeGameData().talents);
  }

  return { register, getRuntimeGameData };
}

module.exports = { createContentIpc };
