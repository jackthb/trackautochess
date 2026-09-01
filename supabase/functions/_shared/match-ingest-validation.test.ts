import {
  bindTimelineToStoredMatch,
  validateMatchRequest,
  validateTimelineRequest,
  ValidationError,
} from "./match-ingest-validation.ts";

const OWNER = "76561198000000001";
const OPPONENT = "76561198000000002";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertRejects(run: () => unknown, expected: string): void {
  try {
    run();
  } catch (error) {
    assert(error instanceof ValidationError);
    assert(
      error.message.includes(expected),
      `${error.message} did not include ${expected}`,
    );
    return;
  }
  throw new Error("expected validation to fail");
}

function matchPayload() {
  return {
    action: "ingest_match",
    match: {
      match_id: "0123456789abcdef",
      played_at: "2026-08-26T20:00:00Z",
      player_count: 2,
      capture_status: "complete",
      is_finished: true,
      verification_source: "end_board",
      ignored_client_field: "not persisted",
    },
    players: [
      {
        match_id: "0123456789abcdef",
        steam_id: OWNER,
        placement: 1,
        chess_lineup: "Axe(2)",
        ignored_client_field: "not persisted",
      },
      {
        match_id: "0123456789abcdef",
        steam_id: OPPONENT,
        placement: 2,
      },
    ],
  };
}

function timelinePayload() {
  return {
    action: "upsert_timeline",
    timeline: {
      match_id: "0123456789abcdef",
      played_at: "2026-08-26T20:00:00Z",
      observer_steam_id: OWNER,
      roster_fingerprint: [OWNER, OPPONENT],
      round_count: 2,
      first_round: 1,
      last_round: 2,
      rounds: [
        {
          round: 1,
          players: {
            [OWNER]: { hp: 100 },
            [OPPONENT]: { hp: 100 },
          },
        },
        {
          round: 2,
          players: {
            [OWNER]: { hp: 96 },
            [OPPONENT]: { hp: 100 },
          },
        },
      ],
    },
  };
}

Deno.test("validated match requires and assigns the authenticated owner", () => {
  const validated = validateMatchRequest(matchPayload(), OWNER);
  assert(validated.match.observer_steam_id === OWNER);
  assert(validated.roster.join(",") === `${OWNER},${OPPONENT}`);
  assert(!Object.hasOwn(validated.match, "ignored_client_field"));
  assert(!Object.hasOwn(validated.players[0], "ignored_client_field"));
  assert(validated.players[0].played_at === validated.match.played_at);
});

Deno.test("validated match rejects a caller outside the roster", () => {
  assertRejects(
    () => validateMatchRequest(matchPayload(), "76561198000000003"),
    "authenticated Steam user",
  );
});

Deno.test("validated match rejects duplicate complete placements", () => {
  const payload = matchPayload();
  payload.players[1].placement = 1;
  assertRejects(
    () => validateMatchRequest(payload, OWNER),
    "unique placements",
  );
});

Deno.test("validated timeline requires strictly increasing rounds", () => {
  const payload = timelinePayload();
  payload.timeline.rounds[1].round = 1;
  assertRejects(
    () => validateTimelineRequest(payload, OWNER),
    "strictly increasing",
  );
});

Deno.test("validated timeline requires the authenticated owner", () => {
  const payload = timelinePayload();
  payload.timeline.observer_steam_id = OPPONENT;
  assertRejects(
    () => validateTimelineRequest(payload, OWNER),
    "timeline owner",
  );
});

Deno.test("validated match rejects invalid persisted player field types", () => {
  const payload = matchPayload();
  (payload.players[0] as Record<string, unknown>).mmr_level = "forged";
  assertRejects(
    () => validateMatchRequest(payload, OWNER),
    "mmr_level must be an integer",
  );
});

Deno.test("timeline is bound to the stored roster and match timestamp", () => {
  const validated = validateTimelineRequest(timelinePayload(), OWNER);
  bindTimelineToStoredMatch(
    validated,
    [OWNER, OPPONENT],
    "2026-08-26T19:59:00Z",
    OWNER,
  );
  assert(
    (validated.row.timeline.roster_fingerprint as string[]).join(",") ===
      `${OWNER},${OPPONENT}`,
  );
  assert(validated.row.timeline.played_at === "2026-08-26T19:59:00Z");

  const outside = timelinePayload();
  (outside.timeline.rounds[0].players as Record<string, { hp: number }>)[
    "76561198000000003"
  ] = { hp: 100 };
  assertRejects(() => {
    const invalid = validateTimelineRequest(outside, OWNER);
    bindTimelineToStoredMatch(
      invalid,
      [OWNER, OPPONENT],
      "2026-08-26T19:59:00Z",
      OWNER,
    );
  }, "outside the stored roster");
});
