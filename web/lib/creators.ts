import creatorsConfig from "../../content/creators.json";
import { unstable_cache } from "next/cache";
import { playerProfilePath } from "@/lib/steam";
import { createSupabaseAnonClient } from "@/lib/supabase";
import { STEAM_ID_TEXT_SELECT } from "@/lib/supabaseSelect";

export type CreatorPlatform = "twitch" | "youtube" | "kick" | "douyu" | "website";

export interface CreatorConfig {
  id: string;
  name: string;
  description?: string;
  steamId?: string;
  profileUrl?: string;
  avatarUrl?: string;
  streamUrl?: string;
  youtubeChannelId?: string;
  youtubeHandle?: string;
  youtubePlaylistId?: string;
  includeTerms?: string[];
  excludeTerms?: string[];
  seedVideoIds?: string[];
}

export interface CreatorLiveStream {
  id: string;
  steamId: string | null;
  name: string;
  description: string | null;
  url: string;
  platform: CreatorPlatform;
  avatarUrl: string | null;
  profilePath: string | null;
  title: string | null;
  thumbnailUrl: string | null;
}

export interface CreatorUpload {
  id: string;
  creatorId: string;
  creatorName: string;
  title: string;
  url: string;
  publishedAt: string | null;
  thumbnailUrl: string | null;
}

interface CreatorConfigFile {
  creators: CreatorConfig[];
}

interface CreatorUserRow {
  steam_id: string;
  name: string | null;
  custom_url: string | null;
  avatar_url: string | null;
  stream_link: string | null;
  drodo_mmr: number | null;
  drodo_season_games: number | null;
  drodo_chicken_count: number | null;
  drodo_raw_data: Record<string, unknown> | null;
  queen_ladder_rank: number | null;
  queen_ladder_last_seen_at: string | null;
}

interface ResolvedYouTubeChannel {
  channelId: string | null;
  handle: string | null;
}

const YOUTUBE_FEED_BASE = "https://www.youtube.com/feeds/videos.xml";
const CREATOR_FEED_REVALIDATE_SECONDS = 900;
export const CREATOR_LIVE_STREAM_REVALIDATE_SECONDS = 300;
const CREATOR_LIVE_STREAM_TIMEOUT_MS = 1500;
const MAX_UPLOADS_PER_CREATOR = 12;
export const MAX_CREATOR_UPLOADS = 30;

const DEFAULT_INCLUDE_TERMS = [
  "dota auto chess",
  "dota 2 auto chess",
  "auto chess",
  "dota chess",
  "dac",
  "刀塔自走棋",
  "自走棋",
];

const DEFAULT_EXCLUDE_TERMS = ["teamfight tactics", "tft", "hearthstone", "battlegrounds"];
const CREATOR_USER_SELECT =
  `${STEAM_ID_TEXT_SELECT}, name, custom_url, avatar_url, stream_link, drodo_mmr, drodo_season_games, drodo_chicken_count, drodo_raw_data, queen_ladder_rank, queen_ladder_last_seen_at` as const;

function contentCreatorConfigRows(): CreatorConfig[] {
  return ((creatorsConfig as CreatorConfigFile).creators ?? [])
    .filter((creator) => creator.id && creator.name)
    .map((creator) => ({
      ...creator,
      steamId: creator.steamId ? String(creator.steamId) : undefined,
      includeTerms: normalizeTerms(creator.includeTerms, DEFAULT_INCLUDE_TERMS),
      excludeTerms: normalizeTerms(creator.excludeTerms, DEFAULT_EXCLUDE_TERMS),
    }));
}

async function databaseCreatorConfigRows(): Promise<CreatorConfig[]> {
  const supabase = createSupabaseAnonClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("users")
    .select(CREATOR_USER_SELECT)
    .not("stream_link", "is", null)
    .order("queen_ladder_rank", { ascending: true, nullsFirst: false })
    .limit(100);

  if (error) {
    console.error("Failed to load creator stream links from Supabase:", error);
    return [];
  }

  const creators: CreatorConfig[] = [];
  for (const row of (data as CreatorUserRow[] | null) ?? []) {
    const streamUrl = row.stream_link?.trim();
    if (!streamUrl) continue;
    const steamId = String(row.steam_id);
    const name = firstNonEmpty(
      nonSteamIdText(row.name),
      nonSteamIdText(row.custom_url),
      creatorNameFromStreamUrl(streamUrl),
      streamPlatform(streamUrl) === "douyu" ? "Douyu" : null
    );
    if (!name) continue;
    creators.push({
      id: `steam-${steamId}`,
      name,
      steamId,
      avatarUrl: row.avatar_url ?? undefined,
      streamUrl,
      profileUrl: hasPublicAutoChessProfile(row)
        ? playerProfilePath(steamId, row.custom_url)
        : undefined,
      includeTerms: DEFAULT_INCLUDE_TERMS,
      excludeTerms: DEFAULT_EXCLUDE_TERMS,
    });
  }
  return creators;
}

function normalizeTerms(
  terms: string[] | undefined,
  fallback: string[]
): string[] {
  const normalized = (terms?.length ? terms : fallback)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

export function streamPlatform(url: string): CreatorPlatform {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("twitch.tv")) return "twitch";
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      return "youtube";
    }
    if (hostname.includes("kick.com")) return "kick";
    if (hostname.includes("douyu.com")) return "douyu";
  } catch {
    // Fall through to a generic external-link label for malformed stored URLs.
  }
  return "website";
}

function douyuRoomId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes("douyu.com")) return null;
    const rid = parsed.searchParams.get("rid")?.trim();
    if (rid && /^\d+$/.test(rid)) return rid;
    const roomPath = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .find((segment) => /^\d+$/.test(segment));
    return roomPath ?? null;
  } catch {
    return null;
  }
}

function twitchLogin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes("twitch.tv")) return null;
    const login = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)[0];
    return login && /^[a-z0-9_]{3,25}$/i.test(login) ? login : null;
  } catch {
    return null;
  }
}

function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function nonSteamIdText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || /^\d{16,17}$/.test(trimmed)) return null;
  return trimmed;
}

function creatorNameFromStreamUrl(url: string): string | null {
  const twitch = twitchLogin(url);
  if (twitch) return twitch;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase().includes("douyu.com")) {
      return null;
    }
    return nonSteamIdText(
      parsed.pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean)[0] ?? parsed.hostname.replace(/^www\./, "")
    );
  } catch {
    return null;
  }
}

function hasPublicAutoChessProfile(row: CreatorUserRow): boolean {
  return Boolean(
    row.queen_ladder_rank != null ||
      row.queen_ladder_last_seen_at ||
      row.drodo_mmr != null ||
      row.drodo_season_games != null ||
      row.drodo_chicken_count != null
  );
}

export function canonicalCreatorStreamUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.trim().replace(/\/+$/, "").toLowerCase();
  }
}

function dedupeLiveStreams(streams: CreatorLiveStream[]): CreatorLiveStream[] {
  const byUrl = new Map<string, CreatorLiveStream>();
  for (const stream of streams) {
    const key = canonicalCreatorStreamUrl(stream.url);
    const current = byUrl.get(key);
    if (!current) {
      byUrl.set(key, stream);
      continue;
    }
    byUrl.set(key, {
      ...current,
      steamId: current.steamId ?? stream.steamId,
      name: current.name === "Douyu" ? stream.name : current.name,
      description: current.description ?? stream.description,
      avatarUrl: current.avatarUrl ?? stream.avatarUrl,
      profilePath: current.profilePath ?? stream.profilePath,
      title: current.title ?? stream.title,
      thumbnailUrl: current.thumbnailUrl ?? stream.thumbnailUrl,
    });
  }
  return [...byUrl.values()];
}

function stableIdFromUrl(url: string): string {
  return (
    url
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "creator"
  );
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function xmlText(entry: string, tag: string): string | null {
  const match = entry.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i")
  );
  return match ? decodeXml(match[1].trim()) : null;
}

function xmlAttr(entry: string, tag: string, attr: string): string | null {
  const match = entry.match(
    new RegExp(`<${tag}\\b[^>]*\\s${attr}="([^"]+)"`, "i")
  );
  return match ? decodeXml(match[1]) : null;
}

function htmlJsonValue(html: string, key: string): string | null {
  const match = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
  return match ? JSON.parse(`"${match[1]}"`) : null;
}

function stripHandlePrefix(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

function creatorYouTubeUrl(creator: CreatorConfig): string | null {
  if (creator.youtubeChannelId) {
    return `https://www.youtube.com/channel/${creator.youtubeChannelId}`;
  }
  if (creator.youtubeHandle) {
    return `https://www.youtube.com/@${encodeURIComponent(stripHandlePrefix(creator.youtubeHandle))}`;
  }
  return null;
}

async function resolveYouTubeChannel(
  creator: CreatorConfig
): Promise<ResolvedYouTubeChannel> {
  if (creator.youtubeChannelId) {
    return { channelId: creator.youtubeChannelId, handle: creator.youtubeHandle ?? null };
  }

  const channelUrl = creatorYouTubeUrl(creator);
  if (!channelUrl) return { channelId: null, handle: creator.youtubeHandle ?? null };

  const response = await fetch(channelUrl, {
    next: { revalidate: CREATOR_FEED_REVALIDATE_SECONDS },
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) return { channelId: null, handle: creator.youtubeHandle ?? null };

  const html = await response.text();
  return {
    channelId:
      htmlJsonValue(html, "channelId") ?? htmlJsonValue(html, "externalId"),
    handle: creator.youtubeHandle ?? htmlJsonValue(html, "webCommandMetadata.url"),
  };
}

function contentMatchesCreatorFilter(
  content: string,
  creator: CreatorConfig
): boolean {
  const normalizedContent = content.toLowerCase();
  const includeTerms = normalizeTerms(creator.includeTerms, DEFAULT_INCLUDE_TERMS);
  const excludeTerms = normalizeTerms(creator.excludeTerms, DEFAULT_EXCLUDE_TERMS);

  if (excludeTerms.some((term) => contentIncludesTerm(normalizedContent, term))) {
    return false;
  }
  return includeTerms.some((term) => contentIncludesTerm(normalizedContent, term));
}

function contentIncludesTerm(content: string, term: string): boolean {
  if (/^[a-z0-9 ]+$/.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(content);
  }
  return content.includes(term);
}

function parseYouTubeFeed(xml: string, creator: CreatorConfig): CreatorUpload[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? [];
  return entries
    .slice(0, MAX_UPLOADS_PER_CREATOR)
    .map((entry) => {
      const videoId =
        xmlText(entry, "yt:videoId") ??
        stableIdFromUrl(xmlAttr(entry, "link", "href") ?? "video");
      const url =
        xmlAttr(entry, "link", "href") ??
        `https://www.youtube.com/watch?v=${videoId}`;
      const title = xmlText(entry, "title") ?? "Untitled upload";
      const description = xmlText(entry, "media:description") ?? "";
      return {
        id: `${creator.id}-${videoId}`,
        creatorId: creator.id,
        creatorName: creator.name,
        title,
        url,
        publishedAt: xmlText(entry, "published") ?? null,
        thumbnailUrl: xmlAttr(entry, "media:thumbnail", "url"),
        searchableText: `${title}\n${description}`,
      };
    })
    .filter((upload) => contentMatchesCreatorFilter(upload.searchableText, creator))
    .map(({ searchableText: _searchableText, ...upload }) => upload);
}

async function fetchCreatorUploads(
  creator: CreatorConfig
): Promise<CreatorUpload[]> {
  const params = new URLSearchParams();
  if (creator.youtubePlaylistId) {
    params.set("playlist_id", creator.youtubePlaylistId);
  } else {
    const { channelId } = await resolveYouTubeChannel(creator);
    if (!channelId) return [];
    params.set("channel_id", channelId);
  }

  const response = await fetch(`${YOUTUBE_FEED_BASE}?${params.toString()}`, {
    next: { revalidate: CREATOR_FEED_REVALIDATE_SECONDS },
  });
  if (!response.ok) return [];
  return parseYouTubeFeed(await response.text(), creator);
}

async function fetchYouTubeLiveStream(
  creator: CreatorConfig,
  revalidateSeconds = 120
): Promise<CreatorLiveStream | null> {
  const channelUrl = creatorYouTubeUrl(creator);
  if (!channelUrl && !creator.streamUrl) return null;

  const liveUrl = creator.streamUrl ?? `${channelUrl}/live`;
  const response = await fetch(liveUrl, {
    next: { revalidate: revalidateSeconds },
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) return null;

  const html = await response.text();
  const isLive =
    html.includes('"isLiveNow":true') ||
    html.includes('"isLiveBroadcast":true') ||
    html.includes('"status":"LIVE_STREAMING"');
  if (!isLive) return null;

  const videoId =
    htmlJsonValue(html, "videoId") ??
    new URL(response.url).searchParams.get("v") ??
    stableIdFromUrl(liveUrl);
  const watchUrl = videoId.startsWith("UC")
    ? liveUrl
    : `https://www.youtube.com/watch?v=${videoId}`;

  return {
    id: `${creator.id}-live-${videoId}`,
    steamId: creator.steamId ?? null,
    name: creator.name,
    description: creator.description ?? null,
    url: watchUrl,
    platform: "youtube",
    avatarUrl: creator.avatarUrl ?? null,
    profilePath: creator.profileUrl ?? channelUrl,
    title: htmlJsonValue(html, "title") ?? null,
    thumbnailUrl:
      html.match(/https:\/\/i\.ytimg\.com\/vi\/[^"\\]+/)?.[0] ?? null,
  };
}

async function fetchTwitchLiveStream(
  creator: CreatorConfig,
  revalidateSeconds = 120
): Promise<CreatorLiveStream | null> {
  if (!creator.streamUrl) return null;
  const login = twitchLogin(creator.streamUrl);
  if (!login) return null;

  const response = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    next: { revalidate: revalidateSeconds },
    headers: {
      "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
    },
    body: JSON.stringify({
      query:
        "query CreatorLiveStatus($login: String!) { user(login: $login) { displayName profileImageURL(width: 96) stream { id type title previewImageURL(width: 640, height: 360) } } }",
      variables: { login },
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | {
        data?: {
          user?: {
            displayName?: string;
            profileImageURL?: string;
            stream?: {
              id?: string;
              type?: string;
              title?: string;
              previewImageURL?: string;
            } | null;
          } | null;
        };
      }
    | null;
  const stream = payload?.data?.user?.stream;
  if (!stream || stream.type?.toLowerCase() !== "live") return null;

  return {
    id: `${creator.id}-live-twitch-${stream.id ?? login}`,
    steamId: creator.steamId ?? null,
    name: firstNonEmpty(nonSteamIdText(payload?.data?.user?.displayName), creator.name, login) ?? login,
    description: creator.description ?? null,
    url: creator.streamUrl,
    platform: "twitch",
    avatarUrl: creator.avatarUrl ?? payload?.data?.user?.profileImageURL ?? null,
    profilePath: creator.profileUrl ?? null,
    title: stream.title ?? null,
    thumbnailUrl: stream.previewImageURL ?? null,
  };
}

async function fetchDouyuLiveStream(
  creator: CreatorConfig,
  revalidateSeconds = 120
): Promise<CreatorLiveStream | null> {
  if (!creator.streamUrl) return null;
  const roomId = douyuRoomId(creator.streamUrl);
  if (!roomId) return null;

  const response = await fetch(
    `https://open.douyucdn.cn/api/RoomApi/room/${encodeURIComponent(roomId)}`,
    {
      next: { revalidate: revalidateSeconds },
      headers: { "user-agent": "Mozilla/5.0" },
    }
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: number;
        data?: {
          room_status?: string | number;
          owner_name?: string;
          room_name?: string;
          room_thumb?: string;
        };
      }
    | null;
  if (!payload || payload.error !== 0) return null;
  if (String(payload.data?.room_status) !== "1") return null;

  return {
    id: `${creator.id}-live-douyu-${roomId}`,
    steamId: creator.steamId ?? null,
    name: firstNonEmpty(nonSteamIdText(payload.data?.owner_name), creator.name) ?? creator.name,
    description: creator.description ?? null,
    url: creator.streamUrl,
    platform: "douyu",
    avatarUrl: creator.avatarUrl ?? null,
    profilePath: creator.profileUrl ?? null,
    title: payload.data?.room_name ?? null,
    thumbnailUrl: payload.data?.room_thumb ?? null,
  };
}

async function fetchGenericLiveStream(
  creator: CreatorConfig,
  revalidateSeconds = 120
): Promise<CreatorLiveStream | null> {
  if (!creator.streamUrl) return null;
  const platform = streamPlatform(creator.streamUrl);
  if (platform === "youtube") return fetchYouTubeLiveStream(creator, revalidateSeconds);
  if (platform === "twitch") return fetchTwitchLiveStream(creator, revalidateSeconds);
  if (platform === "douyu") return fetchDouyuLiveStream(creator, revalidateSeconds);

  const response = await fetch(creator.streamUrl, {
    next: { revalidate: revalidateSeconds },
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) return null;
  const html = await response.text();
  const isLive =
    html.includes('"isLiveBroadcast":true') ||
    html.includes('"isLiveNow":true') ||
    html.includes('"isLive":true') ||
    html.includes('"livestream":true');
  if (!isLive) return null;

  return {
    id: `${creator.id}-live-${stableIdFromUrl(creator.streamUrl)}`,
    steamId: creator.steamId ?? null,
    name: creator.name,
    description: creator.description ?? null,
    url: creator.streamUrl,
    platform,
    avatarUrl: creator.avatarUrl ?? null,
    profilePath: creator.profileUrl ?? null,
    title: htmlJsonValue(html, "title") ?? null,
    thumbnailUrl: null,
  };
}

async function fetchCreatorLiveStreamWithTimeout(
  creator: CreatorConfig,
  revalidateSeconds: number
): Promise<CreatorLiveStream | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CREATOR_LIVE_STREAM_TIMEOUT_MS);
    });
    return await Promise.race([
      fetchGenericLiveStream(creator, revalidateSeconds),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadCreatorLiveStreams({
  revalidateSeconds = 120,
}: {
  revalidateSeconds?: number;
} = {}): Promise<{
  streams: CreatorLiveStream[];
  error: string | null;
}> {
  const creators = await databaseCreatorConfigRows();
  const results = await Promise.all(
    creators.map(async (creator) => {
      try {
        return await fetchCreatorLiveStreamWithTimeout(creator, revalidateSeconds);
      } catch (error) {
        console.error(`Failed to load live stream for ${creator.id}:`, error);
        return null;
      }
    })
  );

  const streams = results.filter((stream): stream is CreatorLiveStream =>
    Boolean(stream)
  );
  return {
    streams: dedupeLiveStreams(streams),
    error: null,
  };
}

export const loadCachedCreatorLiveStreams = unstable_cache(
  () =>
    loadCreatorLiveStreams({
      revalidateSeconds: CREATOR_LIVE_STREAM_REVALIDATE_SECONDS,
    }),
  ["creator-live-streams"],
  {
    revalidate: CREATOR_LIVE_STREAM_REVALIDATE_SECONDS,
    tags: ["creator-live-streams"],
  }
);

export async function loadCreatorUploads(): Promise<CreatorUpload[]> {
  const creators = contentCreatorConfigRows();
  const uploads = await Promise.all(
    creators.map(async (creator) => {
      try {
        return await fetchCreatorUploads(creator);
      } catch (error) {
        console.error(`Failed to load creator uploads for ${creator.id}:`, error);
        return [];
      }
    })
  );

  return uploads
    .flat()
    .sort((a, b) => {
      const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bt - at;
    })
    .slice(0, MAX_CREATOR_UPLOADS);
}
