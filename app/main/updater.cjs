const UPDATE_CHECK_INTERVAL_MS = 6 * 3600 * 1000;
const GITHUB_RELEASES_API = "https://api.github.com/repos/jackthb/dac-tools/releases/latest";

function parseSemver(tag) {
  const match = String(tag || "").match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map((part) => Number.parseInt(part, 10)) : [0, 0, 0];
}

function isNewerVersion(remoteTag, currentVersion) {
  const remote = parseSemver(remoteTag);
  const current = parseSemver(currentVersion);
  for (let i = 0; i < 3; i += 1) {
    if (remote[i] > current[i]) return true;
    if (remote[i] < current[i]) return false;
  }
  return false;
}

function fetchJson(https, url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Track-Auto-Chess-Updater",
        },
        timeout: 15000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GitHub releases API returned ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("GitHub releases API timed out")));
    req.on("error", reject);
  });
}

function createUpdater({ app, https, isPackaged, getTrackerStatus, emitEvent }) {
  async function checkForUpdate() {
    if (!isPackaged) return;
    try {
      const data = await fetchJson(https, GITHUB_RELEASES_API);
      const remoteTag = data?.tag_name || "";
      if (!remoteTag || !isNewerVersion(remoteTag, app.getVersion())) return;
      const asset = (data.assets || []).find((item) =>
        String(item?.name || "").toLowerCase().endsWith(".exe"),
      );
      if (!asset?.browser_download_url) return;
      if (getTrackerStatus().update?.tag === remoteTag) return;
      emitEvent({
        type: "update_available",
        tag: remoteTag,
        download_url: asset.browser_download_url,
        html_url: data.html_url || "",
      });
    } catch (e) {
      console.error("Update check failed:", e);
    }
  }

  function start() {
    if (!isPackaged) return;
    setTimeout(checkForUpdate, 10_000);
    setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  }

  return { start, checkForUpdate };
}

module.exports = {
  GITHUB_RELEASES_API,
  parseSemver,
  isNewerVersion,
  fetchJson,
  createUpdater,
};
