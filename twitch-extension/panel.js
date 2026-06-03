// Track Auto Chess — Twitch panel extension.
//
// Reads the broadcaster's configured Steam username / SteamID64, loads the
// public rank endpoint, and refreshes every 30 minutes. The panel intentionally
// stays tiny and only shows the current rank — no match history.

// Default to prod; override with ?api=http://localhost:3000 when previewing
// locally. Use the www host directly so browser CORS fetches do not follow a
// cross-origin redirect from the apex domain.
const DEFAULT_API_HOST = "https://www.trackautochess.com";
const API_HOST = (() => {
  try {
    const override = new URL(window.location.href).searchParams.get("api");
    if (override) return override.replace(/\/$/, "");
  } catch {}
  return DEFAULT_API_HOST;
})();
const POLL_INTERVAL_MS = 30 * 60 * 1000;

const els = {
  loading: document.getElementById("loading"),
  unconfigured: document.getElementById("unconfigured"),
  content: document.getElementById("content"),
  error: document.getElementById("error"),
  avatar: document.getElementById("avatar"),
  name: document.getElementById("name"),
  rank: document.getElementById("rank"),
  mmr: document.getElementById("mmr"),
  ladder: document.getElementById("ladder"),
  season: document.getElementById("season"),
  updated: document.getElementById("updated"),
  profileLink: document.getElementById("profile-link"),
};

let pollHandle = null;
let lastSteamId = null;

function show(state) {
  for (const key of ["loading", "unconfigured", "content", "error"]) {
    els[key].classList.toggle("hidden", key !== state);
  }
}

function fmt(value) {
  return value == null ? "—" : value.toLocaleString("en-US");
}

function formatUpdated(iso) {
  if (!iso) return "Refreshes every 30 min";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Refreshes every 30 min";
  return `Updated ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · refreshes every 30 min`;
}

function render(data) {
  els.avatar.src = data.player.avatar_url || "";
  els.avatar.classList.toggle("hidden", !data.player.avatar_url);
  els.name.textContent = data.player.name || data.player.steam_id;
  els.profileLink.href = data.player.profile_url;

  els.rank.textContent = data.stats.rank || "Unranked";
  els.mmr.textContent = data.stats.mmr != null ? `${fmt(data.stats.mmr)} MMR` : "No MMR yet";
  els.season.textContent = data.stats.season ? data.stats.season.toUpperCase() : "";
  els.updated.textContent = formatUpdated(data.generated_at);

  if (data.stats.queen_ladder_rank != null) {
    els.ladder.textContent = `Queen ladder #${fmt(data.stats.queen_ladder_rank)}`;
    els.ladder.classList.remove("hidden");
  } else {
    els.ladder.classList.add("hidden");
  }

  show("content");
}

async function fetchStats(steamId) {
  try {
    const resp = await fetch(
      `${API_HOST}/api/twitch/${encodeURIComponent(steamId)}/stats`,
      { cache: "no-store" }
    );
    if (resp.status === 404) {
      els.error.textContent = "Profile not found. Check the username in setup.";
      show("error");
      return;
    }
    if (!resp.ok) {
      els.error.textContent = `Failed to load rank (HTTP ${resp.status}).`;
      show("error");
      return;
    }
    const data = await resp.json();
    render(data);
  } catch (err) {
    els.error.textContent = "Couldn't reach Track Auto Chess.";
    show("error");
  }
}

function startPolling(steamId) {
  if (pollHandle) clearInterval(pollHandle);
  lastSteamId = steamId;
  fetchStats(steamId);
  pollHandle = setInterval(() => fetchStats(steamId), POLL_INTERVAL_MS);
}

function readConfig() {
  // Broadcaster sets a per-channel steamInput string via the config view.
  const raw = window.Twitch?.ext?.configuration?.broadcaster?.content;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.steamInput === "string" && parsed.steamInput.trim()) {
      return parsed.steamInput.trim();
    }
    // Backwards compatible with the previous config shape.
    if (typeof parsed.steamId === "string" && parsed.steamId.trim()) {
      return parsed.steamId.trim();
    }
  } catch {
    return raw.trim() || null;
  }
  return null;
}

function isInsideTwitchExtension() {
  if (!window.Twitch?.ext) return false;
  const host = window.location.hostname;
  return host.endsWith(".ext-twitch.tv") || host === "ext-twitch.tv";
}

function bootstrap() {
  if (!isInsideTwitchExtension()) {
    // Local development outside Twitch — accept ?steamId=... or ?username=...
    // for previewing.
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("steamId") || url.searchParams.get("username");
    if (sid) startPolling(sid);
    else show("unconfigured");
    return;
  }

  window.Twitch.ext.onAuthorized(() => {
    const sid = readConfig();
    if (sid) startPolling(sid);
    else show("unconfigured");
  });

  window.Twitch.ext.configuration.onChanged(() => {
    const sid = readConfig();
    if (sid && sid !== lastSteamId) startPolling(sid);
    else if (!sid) {
      if (pollHandle) clearInterval(pollHandle);
      show("unconfigured");
    }
  });
}

bootstrap();
