// Track Auto Chess — Twitch panel extension.
//
// Reads the broadcaster's configured Steam ID, polls our public stats
// endpoint, renders compact stats + recent matches. Auto-refreshes every
// 60s while visible.

// Default to prod; override with ?api=http://localhost:3000 when previewing
// locally. Twitch's hosted iframe always runs on a *.ext-twitch.tv origin so
// the override is dev-only.
// Use the www host directly — the apex (trackautochess.com) returns a 307
// to www, and browser CORS fetches don't reliably survive cross-origin
// redirects. Hitting the final host avoids the round-trip and the failure.
const DEFAULT_API_HOST = "https://www.trackautochess.com";
const API_HOST = (() => {
  try {
    const override = new URL(window.location.href).searchParams.get("api");
    if (override) return override.replace(/\/$/, "");
  } catch {}
  return DEFAULT_API_HOST;
})();
const POLL_INTERVAL_MS = 60_000;

const els = {
  loading: document.getElementById("loading"),
  unconfigured: document.getElementById("unconfigured"),
  content: document.getElementById("content"),
  error: document.getElementById("error"),
  avatar: document.getElementById("avatar"),
  name: document.getElementById("name"),
  rankLine: document.getElementById("rank-line"),
  mmr: document.getElementById("mmr"),
  maxMmr: document.getElementById("max-mmr"),
  games: document.getElementById("games"),
  chickens: document.getElementById("chickens"),
  recent: document.getElementById("recent"),
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

function placementClass(p) {
  if (p === 1) return "placement p1";
  if (p === 2) return "placement p2";
  if (p === 3) return "placement p3";
  if (p == null) return "placement bot";
  return p > 4 ? "placement bot" : "placement";
}

function summarizeSynergies(synergies) {
  if (!synergies) return "";
  // Pipe-delimited string like "Aqir:4|Beast:3" — top 3 by tier.
  return synergies
    .split("|")
    .slice(0, 3)
    .map((s) => s.replace(":", " "))
    .join(" · ");
}

function render(data) {
  els.avatar.src = data.player.avatar_url || "";
  els.name.textContent = data.player.name || data.player.steam_id;
  els.name.href = data.player.profile_url;
  els.profileLink.href = data.player.profile_url;

  const rankBits = [];
  if (data.stats.rank) rankBits.push(data.stats.rank);
  if (data.stats.season) rankBits.push(data.stats.season.toUpperCase());
  els.rankLine.textContent = rankBits.join(" · ");

  els.mmr.textContent = fmt(data.stats.mmr);
  els.maxMmr.textContent = fmt(data.stats.max_mmr);
  els.games.textContent = fmt(data.stats.games_played);
  els.chickens.textContent =
    data.stats.chicken_count != null
      ? `${fmt(data.stats.chicken_count)}${data.stats.chicken_pct != null ? ` (${data.stats.chicken_pct}%)` : ""}`
      : "—";

  els.recent.innerHTML = "";
  if (!data.recent_games || data.recent_games.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No recorded matches yet.";
    li.style.justifyContent = "center";
    li.style.color = "#898993";
    els.recent.appendChild(li);
  } else {
    for (const g of data.recent_games.slice(0, 5)) {
      const li = document.createElement("li");
      const placement = document.createElement("span");
      placement.className = placementClass(g.placement);
      placement.textContent = g.placement != null ? `#${g.placement}` : "—";
      const synergies = document.createElement("span");
      synergies.className = "synergies";
      synergies.textContent = summarizeSynergies(g.synergies);
      const wl = document.createElement("span");
      wl.className = "wl";
      if (g.wins != null && g.losses != null) {
        wl.textContent = `${g.wins}-${g.losses}`;
      }
      li.append(placement, synergies, wl);
      els.recent.appendChild(li);
    }
  }

  show("content");
}

async function fetchStats(steamId) {
  try {
    const resp = await fetch(
      `${API_HOST}/api/twitch/${encodeURIComponent(steamId)}/stats`
    );
    if (resp.status === 404) {
      els.error.textContent = "Profile not found.";
      show("error");
      return;
    }
    if (!resp.ok) {
      els.error.textContent = `Failed to load (HTTP ${resp.status}).`;
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
  // Broadcaster sets a per-channel "steamId" string via the config view.
  const raw = window.Twitch?.ext?.configuration?.broadcaster?.content;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.steamId === "string" && parsed.steamId.trim()) {
      return parsed.steamId.trim();
    }
  } catch {
    /* not JSON; treat raw as the id */
    return raw.trim() || null;
  }
  return null;
}

function isInsideTwitchExtension() {
  // The twitch-ext helper script loads from its CDN even when we're not in a
  // Twitch iframe, so `window.Twitch?.ext` alone is a misleading check —
  // `onAuthorized` simply never fires outside Twitch and we'd stay on Loading
  // forever. Twitch serves extensions from *.ext-twitch.tv, so the hostname
  // is the reliable signal.
  if (!window.Twitch?.ext) return false;
  const host = window.location.hostname;
  return host.endsWith(".ext-twitch.tv") || host === "ext-twitch.tv";
}

function bootstrap() {
  if (!isInsideTwitchExtension()) {
    // Local development outside Twitch — accept ?steamId=... for previewing.
    const url = new URL(window.location.href);
    const sid = url.searchParams.get("steamId");
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
