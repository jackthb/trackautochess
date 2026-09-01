export const MIN_ROSTER_SIZE = 2;
export const MAX_ROSTER_SIZE = 8;
export const MAX_TIMELINE_ROUNDS = 80;

const STEAM_ID64_MIN = 76561197960265728n;
const STEAM_ID64_MAX = 76561202255233023n;
const MATCH_ID_RE = /^[a-f0-9]{16}$/;
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const CAPTURE_SOURCES = new Set([
  "end_board",
  "post_game_no_end_board",
  "manual_finalize",
  "manual_finalize_dump",
  "left_match_superseded",
  "left_match_timeout",
]);
const EDITABLE_PLAYER_FIELDS = new Set(["notes", "replay", "screenshot"]);

type JsonObject = Record<string, unknown>;

export class ValidationError extends Error {}

export interface ValidatedMatch {
  match: JsonObject;
  players: JsonObject[];
  roster: string[];
}

export interface ValidatedTimeline {
  matchId: string;
  row: {
    match_id: string;
    round_count: number;
    first_round: number;
    last_round: number;
    timeline: JsonObject;
  };
}

export interface ValidatedPlayerUpdate {
  id: number;
  fields: JsonObject;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    !Number.isInteger(value) || (value as number) < min ||
    (value as number) > max
  ) {
    throw new ValidationError(
      `${label} must be an integer from ${min} to ${max}`,
    );
  }
  return value as number;
}

function timestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" || !value.trim() ||
    !ISO_TIMESTAMP_RE.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new ValidationError(`${label} must be an ISO timestamp`);
  }
  if (Date.parse(value) > Date.now() + 24 * 60 * 60 * 1000) {
    throw new ValidationError(
      `${label} cannot be more than one day in the future`,
    );
  }
  return value;
}

function matchId(value: unknown): string {
  if (typeof value !== "string" || !MATCH_ID_RE.test(value)) {
    throw new ValidationError(
      "match_id must be 16 lowercase hexadecimal characters",
    );
  }
  return value;
}

export function steamId(value: unknown, label = "steam_id"): string {
  if (typeof value !== "string" || !/^\d{17}$/.test(value)) {
    throw new ValidationError(`${label} must be a SteamID64 string`);
  }
  const parsed = BigInt(value);
  if (parsed < STEAM_ID64_MIN || parsed > STEAM_ID64_MAX) {
    throw new ValidationError(`${label} is outside the public SteamID64 range`);
  }
  return value;
}

function optionalInteger(
  source: JsonObject,
  field: string,
  label: string,
  min: number,
  max: number,
): number | null {
  const value = source[field];
  return value == null ? null : integer(value, `${label}.${field}`, min, max);
}

function optionalNumber(
  source: JsonObject,
  field: string,
  label: string,
  min: number,
  max: number,
): number | null {
  const value = source[field];
  if (value == null) return null;
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < min ||
    value > max
  ) {
    throw new ValidationError(
      `${label}.${field} must be a number from ${min} to ${max}`,
    );
  }
  return value;
}

function optionalString(
  source: JsonObject,
  field: string,
  label: string,
  maxLength: number,
): string | null {
  const value = source[field];
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new ValidationError(
      `${label}.${field} must be a string no longer than ${maxLength} characters`,
    );
  }
  return value;
}

function optionalJson(
  source: JsonObject,
  field: string,
  label: string,
  maxBytes: number,
): unknown {
  const value = source[field];
  if (value == null) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > maxBytes) {
    throw new ValidationError(
      `${label}.${field} must be no larger than ${maxBytes} bytes`,
    );
  }
  return value;
}

export function validateMatchRequest(
  payload: unknown,
  callerSteamId: string,
): ValidatedMatch {
  const request = object(payload, "request");
  if (request.action !== "ingest_match") {
    throw new ValidationError("action must be ingest_match");
  }
  const inputMatch = object(request.match, "match");
  const id = matchId(inputMatch.match_id);
  const playedAt = timestamp(inputMatch.played_at, "match.played_at");
  if (!Array.isArray(request.players)) {
    throw new ValidationError("players must be an array");
  }
  if (
    request.players.length < MIN_ROSTER_SIZE ||
    request.players.length > MAX_ROSTER_SIZE
  ) {
    throw new ValidationError(
      `players must contain ${MIN_ROSTER_SIZE} to ${MAX_ROSTER_SIZE} rows`,
    );
  }

  const captureStatus = inputMatch.capture_status;
  if (captureStatus !== "complete" && captureStatus !== "partial") {
    throw new ValidationError(
      "match.capture_status must be complete or partial",
    );
  }
  if (inputMatch.is_finished !== true) {
    throw new ValidationError("match.is_finished must be true");
  }
  if (
    typeof inputMatch.verification_source !== "string" ||
    !CAPTURE_SOURCES.has(inputMatch.verification_source)
  ) {
    throw new ValidationError("match.verification_source is not supported");
  }
  if (
    inputMatch.player_count !== undefined &&
    inputMatch.player_count !== request.players.length
  ) {
    throw new ValidationError("match.player_count must equal the roster size");
  }
  if (inputMatch.final_round != null) {
    integer(inputMatch.final_round, "match.final_round", 1, 200);
  }
  if (
    inputMatch.duration != null &&
    (typeof inputMatch.duration !== "number" ||
      !Number.isFinite(inputMatch.duration) ||
      inputMatch.duration < 0 ||
      inputMatch.duration > 8 * 60 * 60)
  ) {
    throw new ValidationError(
      "match.duration must be between 0 and 28800 seconds",
    );
  }

  const seenSteamIds = new Set<string>();
  const seenPlacements = new Set<number>();
  const createdAt = new Date().toISOString();
  const players = request.players.map((value, index) => {
    const input = object(value, `players[${index}]`);
    if (matchId(input.match_id) !== id) {
      throw new ValidationError(
        `players[${index}].match_id does not match the match`,
      );
    }
    const playerSteamId = steamId(input.steam_id, `players[${index}].steam_id`);
    if (seenSteamIds.has(playerSteamId)) {
      throw new ValidationError("players must have unique Steam IDs");
    }
    seenSteamIds.add(playerSteamId);
    const placement = integer(
      input.placement,
      `players[${index}].placement`,
      0,
      8,
    );
    if (captureStatus === "complete") {
      if (placement === 0 || seenPlacements.has(placement)) {
        throw new ValidationError(
          "complete matches must have unique placements from 1 to 8",
        );
      }
      seenPlacements.add(placement);
    }
    const label = `players[${index}]`;
    return {
      match_id: id,
      steam_id: playerSteamId,
      placement,
      mmr_level: optionalInteger(input, "mmr_level", label, 0, 32767),
      hero_level: optionalInteger(input, "hero_level", label, 0, 100),
      chess_lineup: optionalString(input, "chess_lineup", label, 20_000),
      chess_hand: optionalString(input, "chess_hand", label, 20_000),
      synergies: optionalString(input, "synergies", label, 10_000),
      relic: optionalString(input, "relic", label, 500),
      relic_history: optionalJson(input, "relic_history", label, 100_000),
      talents: optionalString(input, "talents", label, 10_000),
      win_round: optionalInteger(input, "win_round", label, 0, 32767),
      lose_round: optionalInteger(input, "lose_round", label, 0, 32767),
      draw_round: optionalInteger(input, "draw_round", label, 0, 32767),
      kills: optionalInteger(input, "kills", label, 0, 32767),
      deaths: optionalInteger(input, "deaths", label, 0, 32767),
      hero_damage: optionalInteger(
        input,
        "hero_damage",
        label,
        0,
        2_147_483_647,
      ),
      hero_damaged: optionalInteger(
        input,
        "hero_damaged",
        label,
        0,
        2_147_483_647,
      ),
      mvp_chess_name: optionalString(input, "mvp_chess_name", label, 500),
      mvp_chess_items: optionalString(input, "mvp_chess_items", label, 10_000),
      max_lineup_value: optionalInteger(
        input,
        "max_lineup_value",
        label,
        0,
        2_147_483_647,
      ),
      max_lineup_value_lineup: optionalString(
        input,
        "max_lineup_value_lineup",
        label,
        20_000,
      ),
      duration: optionalNumber(input, "duration", label, 0, 8 * 60 * 60),
      final_round: optionalInteger(input, "final_round", label, 0, 200),
      zhugong: optionalString(input, "zhugong", label, 500),
      total_money: optionalInteger(
        input,
        "total_money",
        label,
        0,
        2_147_483_647,
      ),
      candy: optionalInteger(input, "candy", label, 0, 2_147_483_647),
      played_at: playedAt,
      replay: optionalString(input, "replay", label, 2_000_000),
      created_at: createdAt,
    };
  });

  if (!seenSteamIds.has(callerSteamId)) {
    throw new ValidationError(
      "the authenticated Steam user must be in the roster",
    );
  }

  const match = {
    match_id: id,
    played_at: playedAt,
    duration: optionalNumber(inputMatch, "duration", "match", 0, 8 * 60 * 60),
    final_round: optionalInteger(inputMatch, "final_round", "match", 1, 200),
    player_count: players.length,
    capture_status: captureStatus,
    is_finished: true,
    verification_source: inputMatch.verification_source,
    verified_at: createdAt,
    capture_started_at: inputMatch.capture_started_at == null
      ? null
      : timestamp(inputMatch.capture_started_at, "match.capture_started_at"),
    capture_ended_at: inputMatch.capture_ended_at == null
      ? playedAt
      : timestamp(inputMatch.capture_ended_at, "match.capture_ended_at"),
    observer_steam_id: callerSteamId,
  };
  if (
    match.capture_started_at &&
    Date.parse(match.capture_started_at) > Date.parse(match.capture_ended_at)
  ) {
    throw new ValidationError(
      "match.capture_started_at cannot be after capture_ended_at",
    );
  }
  return { match, players, roster: [...seenSteamIds].sort() };
}

export function validateTimelineRequest(
  payload: unknown,
  callerSteamId: string,
): ValidatedTimeline {
  const request = object(payload, "request");
  if (request.action !== "upsert_timeline") {
    throw new ValidationError("action must be upsert_timeline");
  }
  const timeline = object(request.timeline, "timeline");
  const id = matchId(timeline.match_id);
  if (
    steamId(timeline.observer_steam_id, "timeline.observer_steam_id") !==
      callerSteamId
  ) {
    throw new ValidationError(
      "timeline owner must be the authenticated Steam user",
    );
  }
  timestamp(timeline.played_at, "timeline.played_at");
  if (!Array.isArray(timeline.rounds)) {
    throw new ValidationError("timeline.rounds must be an array");
  }
  if (
    timeline.rounds.length < 1 || timeline.rounds.length > MAX_TIMELINE_ROUNDS
  ) {
    throw new ValidationError(
      `timeline must contain 1 to ${MAX_TIMELINE_ROUNDS} rounds`,
    );
  }

  let previousRound = 0;
  for (const [index, value] of timeline.rounds.entries()) {
    const round = object(value, `timeline.rounds[${index}]`);
    const roundNumber = integer(
      round.round,
      `timeline.rounds[${index}].round`,
      1,
      200,
    );
    if (roundNumber <= previousRound) {
      throw new ValidationError("timeline rounds must be strictly increasing");
    }
    previousRound = roundNumber;
    const players = object(round.players, `timeline.rounds[${index}].players`);
    const playerIds = Object.keys(players);
    if (playerIds.length > MAX_ROSTER_SIZE) {
      throw new ValidationError(
        "a timeline round cannot contain more than 8 players",
      );
    }
    playerIds.forEach((playerId) =>
      steamId(playerId, `timeline.rounds[${index}].players key`)
    );
    if (round.captured_at != null) {
      timestamp(round.captured_at, `timeline.rounds[${index}].captured_at`);
    }
    for (const playerId of playerIds) {
      object(
        players[playerId],
        `timeline.rounds[${index}].players.${playerId}`,
      );
      const bytes = new TextEncoder().encode(
        JSON.stringify(players[playerId]),
      ).byteLength;
      if (bytes > 100_000) {
        throw new ValidationError(
          `timeline.rounds[${index}].players.${playerId} is too large`,
        );
      }
    }
  }

  const firstRound = integer(
    timeline.first_round,
    "timeline.first_round",
    1,
    200,
  );
  const lastRound = integer(timeline.last_round, "timeline.last_round", 1, 200);
  const roundCount = integer(
    timeline.round_count,
    "timeline.round_count",
    1,
    MAX_TIMELINE_ROUNDS,
  );
  if (
    firstRound !== (timeline.rounds[0] as JsonObject).round ||
    lastRound !== (timeline.rounds.at(-1) as JsonObject).round ||
    roundCount !== timeline.rounds.length
  ) {
    throw new ValidationError(
      "timeline round metadata does not match timeline.rounds",
    );
  }

  if (timeline.roster_fingerprint !== undefined) {
    if (!Array.isArray(timeline.roster_fingerprint)) {
      throw new ValidationError("timeline.roster_fingerprint must be an array");
    }
    const roster = timeline.roster_fingerprint.map((value, index) =>
      steamId(value, `timeline.roster_fingerprint[${index}]`)
    );
    if (
      new Set(roster).size !== roster.length || roster.length > MAX_ROSTER_SIZE
    ) {
      throw new ValidationError(
        "timeline.roster_fingerprint must be a unique roster",
      );
    }
    if (roster.length > 0 && !roster.includes(callerSteamId)) {
      throw new ValidationError(
        "timeline roster must include the authenticated Steam user",
      );
    }
  }

  return {
    matchId: id,
    row: {
      match_id: id,
      round_count: roundCount,
      first_round: firstRound,
      last_round: lastRound,
      timeline,
    },
  };
}

export function bindTimelineToStoredMatch(
  validated: ValidatedTimeline,
  storedRoster: string[],
  storedPlayedAt: string,
  callerSteamId: string,
): void {
  const roster = storedRoster.map((value, index) =>
    steamId(value, `storedRoster[${index}]`)
  ).sort();
  if (
    roster.length < MIN_ROSTER_SIZE || roster.length > MAX_ROSTER_SIZE ||
    new Set(roster).size !== roster.length || !roster.includes(callerSteamId)
  ) {
    throw new ValidationError("stored match roster is invalid");
  }
  const timelineRoster =
    Array.isArray(validated.row.timeline.roster_fingerprint)
      ? [...validated.row.timeline.roster_fingerprint].map(String).sort()
      : [];
  if (
    timelineRoster.length > 0 &&
    (timelineRoster.length !== roster.length ||
      timelineRoster.some((steamId, index) => steamId !== roster[index]))
  ) {
    throw new ValidationError("timeline roster does not match stored roster");
  }
  for (
    const [index, round] of (
      validated.row.timeline.rounds as Array<JsonObject>
    ).entries()
  ) {
    const playerIds = Object.keys(round.players as JsonObject);
    if (playerIds.some((playerId) => !roster.includes(playerId))) {
      throw new ValidationError(
        `timeline round ${index} contains a player outside the stored roster`,
      );
    }
  }
  validated.row.timeline.roster_fingerprint = roster;
  validated.row.timeline.played_at = timestamp(
    storedPlayedAt,
    "stored match played_at",
  );
}

export function validatePlayerUpdateRequest(
  payload: unknown,
): ValidatedPlayerUpdate {
  const request = object(payload, "request");
  if (request.action !== "update_match_player") {
    throw new ValidationError("action must be update_match_player");
  }
  const id = integer(request.id, "id", 1, Number.MAX_SAFE_INTEGER);
  const inputFields = object(request.fields, "fields");
  const entries = Object.entries(inputFields);
  if (
    entries.length === 0 ||
    entries.some(([field]) => !EDITABLE_PLAYER_FIELDS.has(field))
  ) {
    throw new ValidationError(
      "fields may only contain notes, replay, or screenshot",
    );
  }
  const fields = Object.fromEntries(
    entries.map(([field, value]) => {
      if (value !== null && typeof value !== "string") {
        throw new ValidationError(`${field} must be a string or null`);
      }
      const maxLength = field === "notes" ? 5_000 : 2_000_000;
      if (typeof value === "string" && value.length > maxLength) {
        throw new ValidationError(`${field} is too large`);
      }
      return [field, value];
    }),
  );
  return { id, fields };
}
