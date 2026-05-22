// Track Auto Chess — Twitch panel extension.
//
// Reads the broadcaster's configured Steam ID, polls our public stats
// endpoint, renders compact stats + MMR sparkline. Auto-refreshes every
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
  totalChickens: document.getElementById("total-chickens"),
  lifetimePeak: document.getElementById("lifetime-peak"),
  totalGames: document.getElementById("total-games"),
  candy: document.getElementById("candy"),
  graphWrap: document.getElementById("graph-wrap"),
  graph: document.getElementById("graph"),
  profileLink: document.getElementById("profile-link"),
};

const SVG_NS = "http://www.w3.org/2000/svg";
const GRAPH_W = 280;
const GRAPH_H = 90;
const GRAPH_PAD_X = 6;
const GRAPH_PAD_Y = 10;

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

function buildGraphPoints(seasons, history) {
  const seasonPoints = (seasons || [])
    .filter((s) => typeof s.mmr === "number")
    .slice()
    .sort((a, b) => String(a.season).localeCompare(String(b.season)))
    .map((s) => ({ mmr: s.mmr, kind: "season" }));
  const snapshotPoints = (history || [])
    .filter((s) => typeof s.mmr === "number")
    .slice()
    .sort(
      (a, b) =>
        new Date(a.snapshotted_at).getTime() -
        new Date(b.snapshotted_at).getTime()
    )
    .map((s) => ({ mmr: s.mmr, kind: "snapshot" }));
  return [...seasonPoints, ...snapshotPoints];
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function renderGraph(seasons, history) {
  const points = buildGraphPoints(seasons, history);
  while (els.graph.firstChild) els.graph.removeChild(els.graph.firstChild);
  if (points.length < 2) {
    els.graphWrap.classList.add("hidden");
    return;
  }
  const mmrs = points.map((p) => p.mmr);
  const minMmr = Math.min(...mmrs);
  const maxMmr = Math.max(...mmrs);
  const range = maxMmr - minMmr || 1;
  const innerW = GRAPH_W - GRAPH_PAD_X * 2;
  const innerH = GRAPH_H - GRAPH_PAD_Y * 2;
  const coords = points.map((p, i) => ({
    x: GRAPH_PAD_X + (i / (points.length - 1)) * innerW,
    y: GRAPH_PAD_Y + innerH - ((p.mmr - minMmr) / range) * innerH,
    mmr: p.mmr,
    kind: p.kind,
  }));
  const polyPoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];

  els.graph.appendChild(
    svgEl("polygon", {
      class: "area",
      points: `${first.x},${GRAPH_H - GRAPH_PAD_Y} ${polyPoints} ${last.x},${GRAPH_H - GRAPH_PAD_Y}`,
    })
  );
  els.graph.appendChild(
    svgEl("polyline", { class: "line", points: polyPoints })
  );
  for (let i = 0; i < coords.length - 1; i++) {
    const c = coords[i];
    els.graph.appendChild(
      svgEl("circle", {
        class: `dot ${c.kind}`,
        cx: c.x,
        cy: c.y,
        r: c.kind === "season" ? 2.4 : 1.6,
      })
    );
  }
  els.graph.appendChild(
    svgEl("circle", { class: "last-dot", cx: last.x, cy: last.y, r: 2.6 })
  );
  const label = svgEl("text", {
    class: "axis",
    x: last.x - 4,
    y: last.y - 5,
    "text-anchor": "end",
  });
  label.textContent = String(last.mmr);
  els.graph.appendChild(label);

  els.graphWrap.classList.remove("hidden");
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
  els.totalChickens.textContent = fmt(data.stats.total_chicken_count);
  els.lifetimePeak.textContent = fmt(data.stats.lifetime_peak_mmr);
  els.totalGames.textContent =
    data.stats.total_games_played != null
      ? `${fmt(data.stats.total_games_played)}${data.stats.seasons_played ? ` · ${data.stats.seasons_played}s` : ""}`
      : "—";
  els.candy.textContent = fmt(data.stats.candy);

  renderGraph(data.seasons, data.mmr_history);

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
