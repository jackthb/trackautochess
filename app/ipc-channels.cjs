const CHANNELS = {
  app: {
    openExternal: "app:openExternal",
    getVersion: "app:getVersion",
  },
  data: {
    units: "data:units",
    unitsFull: "data:units_full",
    synergies: "data:synergies",
    relics: "data:relics",
    items: "data:items",
    itemsFull: "data:items_full",
    talents: "data:talents",
  },
  replays: {
    list: "replays:list",
    delete: "replays:delete",
    stats: "replays:stats",
    openFolder: "replays:openFolder",
    exists: "replays:exists",
  },
  tracker: {
    command: "tracker:command",
    event: "tracker:event",
  },
  trackerLog: {
    read: "trackerLog:read",
    paths: "trackerLog:paths",
    update: "trackerLog:update",
  },
  window: {
    minimize: "window:minimize",
    maximize: "window:maximize",
    close: "window:close",
  },
};

module.exports = { CHANNELS };
