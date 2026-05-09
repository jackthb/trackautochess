// Dumps useful DAC CustomNetTable values to the Dota console.log so the
// Python ingester can pull them out and write to Supabase. Keyed off the
// dedi-pushed tables in data/vscripts/scripts/vscripts/addon_game_mode.lua —
// see tools/dac_dump/README.md for the per-table provenance.
//
// Output is one line per unique payload:
//   DAC_NETTABLE_DUMP_BEGIN <json> DAC_NETTABLE_DUMP_END
// where the JSON is { t: tableName, k: key, v: value }.
//
// Launch Dota with `-condebug` so $.Msg writes to <dota>/game/dota/console.log,
// and with `-insert_search_path` pointing at the tree containing this script.
// See tools/dac_dump/README.md for the install flow.

"use strict";

(function () {
    // [tableName, predicate(key) | null]
    var WATCH = [
        ["ranking_top_table", null],
        ["match_history_table", function (k) { return k.indexOf("match_history_") === 0; }],
        ["dac_table", function (k) {
            return k === "player_info" || k === "end_board" || k === "user_panel_ranking";
        }],
        ["player_id_table", function (k) { return k.indexOf("player_") === 0; }],
    ];

    var POLL_INTERVAL_S = 5;
    var POLL_DURATION_S = 180;

    var emitted = {};

    function emit(tableName, key, value) {
        if (value == null) return;
        var json;
        try {
            json = JSON.stringify({ t: tableName, k: String(key), v: value });
        } catch (e) {
            $.Msg("DAC_NETTABLE_DUMP_ERR stringify_failed " + tableName + "/" + key + " " + e);
            return;
        }
        if (emitted[json]) return;
        emitted[json] = true;
        $.Msg("DAC_NETTABLE_DUMP_BEGIN " + json + " DAC_NETTABLE_DUMP_END");
    }

    function keepKey(predicate, key) {
        return predicate == null || predicate(String(key));
    }

    function pull(tableName, predicate) {
        try {
            var all = CustomNetTables.GetAllTableValues(tableName) || [];
            for (var i = 0; i < all.length; i++) {
                var entry = all[i];
                if (keepKey(predicate, entry.key)) {
                    emit(tableName, entry.key, entry.value);
                }
            }
        } catch (e) {
            $.Msg("DAC_NETTABLE_DUMP_ERR pull_failed " + tableName + " " + e);
        }
    }

    function subscribe(tableName, predicate) {
        try {
            CustomNetTables.SubscribeNetTableListener(tableName, function (t, k, v) {
                if (keepKey(predicate, k)) emit(t, k, v);
            });
        } catch (e) {
            $.Msg("DAC_NETTABLE_DUMP_ERR subscribe_failed " + tableName + " " + e);
        }
    }

    // The Players API exposes the steam_id ↔ player_id mapping that NetTables
    // alone doesn't (the dedi has it but doesn't broadcast it directly). We
    // synthesise a __synth__ / lobby_steam_ids entry from it. Note: account_id
    // is the 32-bit Steam account ID, not SteamID64 — JS Number can't safely
    // hold the 64-bit form. Ingester adds the 76561197960265728 offset.
    function emitLobbySteamIds() {
        try {
            if (typeof Game === "undefined" || typeof Players === "undefined") return;
            var ids = (Game.GetAllPlayerIDs && Game.GetAllPlayerIDs()) || [];
            if (ids.length === 0) return;
            var map = {};
            for (var i = 0; i < ids.length; i++) {
                var pid = ids[i];
                map[String(pid)] = {
                    player_id: pid,
                    steam_account_id: Players.GetSteamAccountID(pid),
                    name: Players.GetPlayerName(pid),
                    team: Players.GetTeam ? Players.GetTeam(pid) : null,
                };
            }
            emit("__synth__", "lobby_steam_ids", map);
        } catch (e) {
            $.Msg("DAC_NETTABLE_DUMP_ERR lobby_synth_failed " + e);
        }
    }

    // Initial subscribe + pull, then poll for late-arriving values.
    for (var i = 0; i < WATCH.length; i++) {
        subscribe(WATCH[i][0], WATCH[i][1]);
        pull(WATCH[i][0], WATCH[i][1]);
    }
    emitLobbySteamIds();

    var ticks = 0;
    var maxTicks = Math.ceil(POLL_DURATION_S / POLL_INTERVAL_S);
    function loop() {
        ticks += 1;
        for (var j = 0; j < WATCH.length; j++) {
            pull(WATCH[j][0], WATCH[j][1]);
        }
        emitLobbySteamIds();
        if (ticks < maxTicks) {
            $.Schedule(POLL_INTERVAL_S, loop);
        }
    }
    $.Schedule(POLL_INTERVAL_S, loop);
})();
