const DOTA_CONSOLE_LOG_CANDIDATES = [
  "C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta/game/dota/console.log",
  "C:/Program Files/Steam/steamapps/common/dota 2 beta/game/dota/console.log",
];
const TRACKER_LOG_INITIAL_TAIL_BYTES = 256 * 1024;
const DOTA_LOG_INITIAL_TAIL_BYTES = 128 * 1024;
const DOTA_NOISE_RE = /\[GCClient\]|^WriteSteamRemoteStorageFileAsync|^CAsyncWriteInProgress|^\[SteamNetSockets\]|\[Filesystem\].*\.vpk\b|\bbad VPK magic\b|\bVPK magic\b|\bvpk:.*\.vpk:/i;

function createTrackerLog({ ipcMain, fs, path, appUserDataDir, getMainWindow, channels }) {
  const appLogDir = path.join(appUserDataDir, "logs");
  const trackerLogPath = path.join(appLogDir, "tracker.log");
  let trackerLogWatcher = null;
  let trackerLogOffset = 0;
  let dotaLogWatcher = null;
  let dotaLogOffset = 0;
  let dotaLogPath = null;

  function trackerLogTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function append(level, message) {
    try {
      fs.mkdirSync(appLogDir, { recursive: true });
      const normalizedLevel = String(level || "INFO").toUpperCase().padEnd(7, " ");
      const text = String(message || "").replace(/\r?\n/g, "\n  ");
      fs.appendFileSync(trackerLogPath, `${trackerLogTimestamp()}  ${normalizedLevel} ${text}\n`, "utf-8");
    } catch (e) {
      console.error("Failed to append tracker.log:", e);
    }
  }

  function summarizeBackendEvent(msg) {
    const summary = { ...msg };
    delete summary.rows;
    delete summary.state;
    delete summary.players;
    return JSON.stringify(summary);
  }

  function logBackendEvent(msg) {
    if (!msg || typeof msg !== "object") return;
    const type = String(msg.type || "");
    if (!type) return;
    if (["status", "nettable_status", "nettable_state", "nettable_rows", "log"].includes(type)) return;
    const level = type === "error" || type.endsWith("_error") ? "ERROR" : "INFO";
    const message = msg.message || msg.error || summarizeBackendEvent(msg);
    append(level, `Backend event ${type}: ${message}`);
  }

  function parseTrackerLogLines(text) {
    const entries = [];
    const lineRegex = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s+(\S+)\s+(.*)$/;
    for (const raw of text.split(/\r?\n/)) {
      if (!raw) continue;
      const m = raw.match(lineRegex);
      if (m) {
        if (!m[4].trim()) continue;
        const ts = new Date(`${m[1]}T${m[2]}`).getTime() / 1000;
        entries.push({ type: "log", source: "tracker", ts, level: m[3], msg: m[4] });
      } else if (entries.length > 0) {
        entries[entries.length - 1].msg += "\n" + raw;
      }
    }
    return entries;
  }

  function parseDotaLogLines(text) {
    const entries = [];
    const lineRegex = /^(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) (.*)$/;
    const year = new Date().getFullYear();
    for (const raw of text.split(/\r?\n/)) {
      if (!raw) continue;
      if (DOTA_NOISE_RE.test(raw)) continue;
      const m = raw.match(lineRegex);
      if (m) {
        const msg = m[6].trim();
        if (!msg || DOTA_NOISE_RE.test(msg)) continue;
        const ts = new Date(`${year}-${m[1]}-${m[2]}T${m[3]}:${m[4]}:${m[5]}`).getTime() / 1000;
        entries.push({ type: "log", source: "dota", ts, level: "INFO", msg });
      } else if (entries.length > 0) {
        entries[entries.length - 1].msg += "\n" + raw;
      }
    }
    return entries;
  }

  function resolveDotaLogPath() {
    for (const p of DOTA_CONSOLE_LOG_CANDIDATES) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  function readFileTail(filePath, maxBytes, parser) {
    if (!filePath || !fs.existsSync(filePath)) return [];
    const stats = fs.statSync(filePath);
    const start = Math.max(0, stats.size - maxBytes);
    const length = stats.size - start;
    if (length === 0) return [];
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, start);
      return parser(buf.toString("utf-8"));
    } finally {
      fs.closeSync(fd);
    }
  }

  function registerIpc() {
    ipcMain.handle(channels.trackerLog.read, () => {
      const tracker = readFileTail(trackerLogPath, TRACKER_LOG_INITIAL_TAIL_BYTES, parseTrackerLogLines);
      const dotaPath = dotaLogPath || resolveDotaLogPath();
      const dota = readFileTail(dotaPath, DOTA_LOG_INITIAL_TAIL_BYTES, parseDotaLogLines);
      return [...tracker, ...dota].sort((a, b) => a.ts - b.ts);
    });

    ipcMain.handle(channels.trackerLog.paths, () => ({
      tracker: trackerLogPath,
      dota: dotaLogPath || resolveDotaLogPath(),
    }));
  }

  function tailFileWatcher({ filePath, getOffset, setOffset, parser, label }) {
    if (!fs.existsSync(filePath)) return null;
    setOffset(fs.statSync(filePath).size);
    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType !== "change") return;
        try {
          const stats = fs.statSync(filePath);
          let offset = getOffset();
          if (stats.size < offset) offset = 0;
          if (stats.size === offset) return;
          const length = stats.size - offset;
          const fd = fs.openSync(filePath, "r");
          try {
            const buf = Buffer.alloc(length);
            fs.readSync(fd, buf, 0, length, offset);
            setOffset(stats.size);
            const newEntries = parser(buf.toString("utf-8"));
            const mainWindow = getMainWindow();
            if (newEntries.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(channels.trackerLog.update, newEntries);
            }
          } finally {
            fs.closeSync(fd);
          }
        } catch (e) {
          console.error(`${label} watcher read error:`, e);
        }
      });
      console.log(`${label} watcher started on ${filePath}`);
      return watcher;
    } catch (e) {
      console.error(`${label} watcher failed to start:`, e);
      return null;
    }
  }

  function startTrackerWatcher() {
    if (trackerLogWatcher) return;
    if (!fs.existsSync(trackerLogPath)) {
      setTimeout(startTrackerWatcher, 2000);
      return;
    }
    trackerLogWatcher = tailFileWatcher({
      filePath: trackerLogPath,
      getOffset: () => trackerLogOffset,
      setOffset: (v) => { trackerLogOffset = v; },
      parser: parseTrackerLogLines,
      label: "trackerLog",
    });
  }

  function startDotaWatcher() {
    if (dotaLogWatcher) return;
    dotaLogPath = resolveDotaLogPath();
    if (!dotaLogPath) {
      setTimeout(startDotaWatcher, 5000);
      return;
    }
    dotaLogWatcher = tailFileWatcher({
      filePath: dotaLogPath,
      getOffset: () => dotaLogOffset,
      setOffset: (v) => { dotaLogOffset = v; },
      parser: parseDotaLogLines,
      label: "dotaLog",
    });
  }

  function stop() {
    if (trackerLogWatcher) {
      try { trackerLogWatcher.close(); } catch {}
      trackerLogWatcher = null;
    }
    if (dotaLogWatcher) {
      try { dotaLogWatcher.close(); } catch {}
      dotaLogWatcher = null;
    }
  }

  return {
    trackerLogPath,
    append,
    logBackendEvent,
    registerIpc,
    startTrackerWatcher,
    startDotaWatcher,
    stop,
  };
}

module.exports = { createTrackerLog };
