// Track Auto Chess — Twitch panel extension.
//
// Reads the broadcaster's configured Steam username / SteamID64 and loads the
// public rank endpoint for display inside Twitch's hosted-extension shell.

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
  name: document.getElementById("name"),
  rank: document.getElementById("rank"),
  mmr: document.getElementById("mmr"),
  maxMmr: document.getElementById("max-mmr"),
  winRate: document.getElementById("win-rate"),
  chickenCount: document.getElementById("chicken-count"),
  seasonGames: document.getElementById("season-games"),
  candy: document.getElementById("candy"),
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
  return value == null ? "--" : value.toLocaleString("en-US");
}

function setText(el, value) {
  if (el) el.textContent = value;
}

function pct(value) {
  return value == null ? "--" : `${fmt(value)}%`;
}

function formatUpdated(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `Updated ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function winRate(stats) {
  if (stats.chicken_count == null || !stats.season_games) return null;
  return Math.round((stats.chicken_count / stats.season_games) * 100);
}

function render(data) {
  const stats = data.stats || {};
  const player = data.player || {};

  setText(els.name, player.name || player.steam_id || "Auto Chess player");
  els.profileLink.href = player.profile_url || "#";

  setText(els.rank, stats.rank || "Unranked");
  setText(els.mmr, stats.mmr != null ? `${fmt(stats.mmr)} MMR` : "No MMR yet");
  setText(els.maxMmr, stats.max_mmr != null ? fmt(stats.max_mmr) : "--");
  setText(els.winRate, pct(winRate(stats)));
  setText(els.chickenCount, stats.chicken_count != null ? fmt(stats.chicken_count) : "--");
  setText(els.seasonGames, stats.season_games != null ? fmt(stats.season_games) : "--");
  setText(els.candy, stats.candy != null ? fmt(stats.candy) : "--");
  setText(els.season, stats.season ? stats.season.toUpperCase() : "");
  setText(els.updated, formatUpdated(data.generated_at));

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
    render(await resp.json());
  } catch {
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
  const raw = window.Twitch?.ext?.configuration?.broadcaster?.content;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.steamInput === "string" && parsed.steamInput.trim()) {
      return parsed.steamInput.trim();
    }
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
