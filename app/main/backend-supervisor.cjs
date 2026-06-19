function createBackendSupervisor({
  fs,
  path,
  spawn,
  readline,
  desktopPaths,
  isDev,
  env,
  trackerLogPath,
  appendLog,
}) {
  let backendProcess = null;
  let backendRL = null;
  let backendRestarting = false;
  let backendRestartTimer = null;
  let backendWatchers = [];
  const subscribers = new Set();

  function emit(msg) {
    for (const cb of subscribers) cb(msg);
  }

  function getBackendCommand() {
    return desktopPaths.backendCommand;
  }

  function start() {
    if (backendProcess) return;
    const { command, args, cwd } = getBackendCommand();
    if ((command.includes(path.sep) || path.isAbsolute(command)) && !fs.existsSync(command)) {
      console.error(`Backend not found at ${command}`);
      return;
    }

    console.log(`Starting ${desktopPaths.backendKind} backend: ${command} ${args.join(" ")}`);
    appendLog("INFO", `Starting ${desktopPaths.backendKind} backend: ${command} ${args.join(" ")}`);
    appendLog("INFO", `Tracker log path: ${trackerLogPath}`);

    backendProcess = spawn(command, args, {
      cwd,
      env: { ...env, DAC_DIR: desktopPaths.dacDir, TRACK_AUTO_CHESS_LOG_PATH: trackerLogPath },
      stdio: ["pipe", "pipe", "pipe"],
    });

    backendRL = readline.createInterface({ input: backendProcess.stdout });
    backendRL.on("line", (line) => {
      try {
        emit(JSON.parse(line));
      } catch {
        console.error("Failed to parse backend output:", line);
        appendLog("ERROR", `Failed to parse backend output: ${line}`);
      }
    });

    backendProcess.stderr.on("data", (data) => {
      const text = data.toString().trim();
      console.error(`[backend stderr] ${text}`);
      if (text) appendLog("ERROR", `[backend stderr] ${text}`);
    });

    backendProcess.on("close", (code) => {
      console.log(`Backend process exited with code ${code}`);
      appendLog("WARNING", `Backend process exited with code ${code}`);
      backendProcess = null;
      backendRL = null;

      if (backendRestarting) {
        backendRestarting = false;
        start();
        return;
      }

      emit({
        type: "error",
        message: `${desktopPaths.backendKind} backend exited (code ${code})`,
      });
    });

    backendProcess.on("error", (err) => {
      console.error("Failed to start backend:", err);
      appendLog("ERROR", `Failed to start backend: ${err?.message || err}`);
    });
  }

  function send(cmd) {
    if (!backendProcess || !backendProcess.stdin.writable) {
      console.error("Backend process not running - cannot send:", cmd);
      appendLog("ERROR", `Backend process not running - cannot send: ${JSON.stringify(cmd)}`);
      return;
    }
    const line = JSON.stringify(cmd) + "\n";
    console.log("sendToBackend:", line.trim());
    appendLog("INFO", `Command sent: ${cmd?.cmd ?? "unknown"}`);
    backendProcess.stdin.write(line);
  }

  function restart(reason) {
    if (!isDev) return;
    console.log(`Restarting backend: ${reason}`);
    if (!backendProcess) {
      start();
      return;
    }
    backendRestarting = true;
    send({ cmd: "quit" });
    setTimeout(() => {
      if (backendProcess && backendRestarting) backendProcess.kill();
    }, 1500);
  }

  function scheduleRestart(reason) {
    if (backendRestartTimer) clearTimeout(backendRestartTimer);
    backendRestartTimer = setTimeout(() => {
      backendRestartTimer = null;
      restart(reason);
    }, 350);
  }

  function startDevWatcher() {
    if (!isDev) return;
    const backendDir = desktopPaths.trackerDir;
    if (!fs.existsSync(backendDir)) return;
    try {
      const watcher = fs.watch(backendDir, { recursive: true }, (_event, filename) => {
        const normalized = String(filename || "").replace(/\\/g, "/");
        if (!normalized.endsWith(".rs")) return;
        if (normalized.includes("/.venv/") || normalized.includes("/build/") || normalized.includes("/target/")) return;
        scheduleRestart(filename);
      });
      backendWatchers.push(watcher);
      console.log(`Watching ${desktopPaths.backendKind} backend for hot restart: ${backendDir}`);
    } catch (e) {
      console.error(`Failed to watch backend dir ${backendDir}:`, e);
    }
  }

  function stop() {
    for (const watcher of backendWatchers) {
      try { watcher.close(); } catch {}
    }
    backendWatchers = [];
    if (backendRestartTimer) {
      clearTimeout(backendRestartTimer);
      backendRestartTimer = null;
    }
    if (backendProcess) {
      send({ cmd: "quit" });
      setTimeout(() => {
        if (backendProcess) backendProcess.kill();
      }, 3000);
    }
  }

  function onEvent(cb) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }

  return { start, stop, send, restart, startDevWatcher, onEvent };
}

module.exports = { createBackendSupervisor };
