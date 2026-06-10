function isPathInside(parent, child, path) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function createReplays({ ipcMain, protocol, net, shell, fs, path, replayDir, iconsDir }) {
  function replayPath(filename) {
    const filePath = path.resolve(replayDir, String(filename || ""));
    return isPathInside(path.resolve(replayDir), filePath, path) ? filePath : null;
  }

  function registerIpc() {
    ipcMain.handle("replays:list", async () => {
      if (!fs.existsSync(replayDir)) return [];
      const files = fs.readdirSync(replayDir).filter((f) => f.endsWith(".mp4"));
      return files
        .map((name) => {
          const filePath = path.join(replayDir, name);
          const stat = fs.statSync(filePath);
          return { name, path: filePath, size: stat.size, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    });

    ipcMain.handle("replays:delete", async (_event, filename) => {
      const filePath = replayPath(filename);
      if (!filePath) return false;
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    });

    ipcMain.handle("replays:stats", async () => {
      if (!fs.existsSync(replayDir)) return { count: 0, totalBytes: 0 };
      const files = fs.readdirSync(replayDir).filter((f) => f.endsWith(".mp4"));
      let totalBytes = 0;
      for (const f of files) totalBytes += fs.statSync(path.join(replayDir, f)).size;
      return { count: files.length, totalBytes };
    });

    ipcMain.handle("replays:openFolder", async () => {
      await shell.openPath(replayDir);
    });

    ipcMain.handle("replays:exists", async (_event, filename) => {
      const filePath = replayPath(filename);
      return Boolean(filePath && fs.existsSync(filePath));
    });
  }

  function registerProtocols() {
    protocol.handle("replay", (request) => {
      const filename = decodeURIComponent(request.url.replace("replay://video/", ""));
      const filePath = replayPath(filename);
      if (!filePath || !fs.existsSync(filePath)) return new Response("Not found", { status: 404 });

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = request.headers.get("Range");
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          const chunkSize = end - start + 1;
          return new Response(fs.createReadStream(filePath, { start, end }), {
            status: 206,
            headers: {
              "Content-Range": `bytes ${start}-${end}/${fileSize}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(chunkSize),
              "Content-Type": "video/mp4",
            },
          });
        }
      }
      return new Response(fs.createReadStream(filePath), {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(fileSize),
          "Content-Type": "video/mp4",
        },
      });
    });

    protocol.handle("icons", (request) => {
      const urlPath = decodeURIComponent(request.url.replace("icons://", ""));
      const filePath = path.resolve(iconsDir, urlPath);
      if (!isPathInside(path.resolve(iconsDir), filePath, path)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!fs.existsSync(filePath)) return new Response("Not found", { status: 404 });
      return net.fetch(`file://${filePath}`);
    });
  }

  return { registerIpc, registerProtocols };
}

module.exports = { createReplays };
