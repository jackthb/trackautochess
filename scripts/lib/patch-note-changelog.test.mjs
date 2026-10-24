import assert from "node:assert/strict";
import test from "node:test";

import { classifyPatchNoteKind } from "./patch-note-kind.mjs";
import {
  applyIncomingEntries,
  assignEntryDates,
  buildPatchFromDay,
  changelogIsoDate,
  classifyChangelogPost,
  collectChangelogPages,
  hasNextChangelogPage,
  parseChangelogBody,
  parseChangelogEntries,
  takeEntriesUntilKnown,
  titleForChangelogPost,
} from "./patch-note-changelog.mjs";

const HOSTING_NOTICE = "Drodo Notice: Due to server restrictions, all matches are hosted locally, please DONOT LEAVE EARLY if you are the HOST. Rank mode is currently closed until solutions on localhosts implemented.";
const RANKED_REOPEN = "• Ranked Mode is attempting to reopen. (Any bug during the Beta test please notify us via email!)";
const AUG_6 = `-Tune in for the Top of War on Aug 7th - Aug 9th.
-Largo: Health decreased from 800 to 700
-Grimstroke - Stroke of fate: Duration decreased from 10s to 6s, reduction percent decreased from 10/30/60 to 10/30/50
-Second Chance removed`;
const SEP_15 = `• Ranked Mode is attempting to reopen. (Any bug during the Beta test please notify us via email!)
• In Ranked Mode: A full completion grants local host player extra Ranked Points. Instead, an early abortion deducts local host player’s Ranked Points based on the host’s historical finish rate.
• For the gaming experience of other players, pleased do not quit the game early if you're the host! Premium Host election is now underway…`;
const SEP_16 = `Ranked Mode (Local Host Version) Beta

● Host player point reward rules: Upon starting a game, the host player automatically pledges a portion of points for credit. Hosts with better historical credit need to pledge fewer points (three tiers: -100 / -60 / -20).
● Fixed bugs: incorrect rank evaluation caused by point pledging, and unintended loss of point triggered by match abortion.
● Badge for Premium local hosts will be awarded later: Awakening the Machine`;

function stamp(year, monthIndex, day, hours, minutes) {
  return String(Math.floor(Date.UTC(year, monthIndex, day, hours, minutes) / 1000));
}

test("pagination stops at the first known entry and does not read later pages", async () => {
  const pages = [
    [{ sourceId: "new-1" }, { sourceId: "new-2" }],
    [{ sourceId: "new-3" }, { sourceId: "known-sep-19" }, { sourceId: "older" }],
    [{ sourceId: "should-not-fetch" }],
  ];
  const requested = [];
  const known = new Set(["known-sep-19"]);
  const result = await collectChangelogPages({
    isKnown: (entry) => known.has(entry.sourceId),
    fetchPage(page) {
      requested.push(page);
      const entries = pages[page - 1] || [];
      return { entries, hasNext: page < pages.length };
    },
  });

  assert.deepEqual(requested, [1, 2]);
  assert.equal(result.reachedKnown, true);
  assert.deepEqual(result.entries.map((entry) => entry.sourceId), ["new-1", "new-2", "new-3"]);
});

test("takeEntriesUntilKnown keeps newer rows on the same page and drops the known row", () => {
  const taken = takeEntriesUntilKnown(
    [{ sourceId: "a" }, { sourceId: "b" }, { sourceId: "old" }],
    (entry) => entry.sourceId === "old",
  );
  assert.equal(taken.reachedKnown, true);
  assert.deepEqual(taken.fresh.map((entry) => entry.sourceId), ["a", "b"]);
});

test("december headlines keep december when the timestamp has already entered january UTC", () => {
  // 2027-01-01 06:30 UTC is still the evening of 31 Dec in Pacific time.
  const sourceId = stamp(2027, 0, 1, 6, 30);
  assert.equal(changelogIsoDate({ month: "Dec", day: "31", sourceId }), "2026-12-31");
  assert.equal(changelogIsoDate({ month: "December", day: 31, sourceId }), "2026-12-31");
});

test("year comes from the entry timestamp rather than the current calendar year", () => {
  assert.equal(
    changelogIsoDate({ month: "Dec", day: "20", sourceId: stamp(2025, 11, 20, 18, 0) }),
    "2025-12-20",
  );
  assert.equal(
    changelogIsoDate({ month: "Jan", day: "15", sourceId: stamp(2027, 0, 15, 12, 0) }),
    "2027-01-15",
  );
});

test("a december entry after a january entry rolls back a year without a timestamp", () => {
  const dated = assignEntryDates([
    {
      month: "Jan",
      day: "2",
      time: "1:00am",
      sourceId: stamp(2027, 0, 2, 8, 0),
      content: "Fix bug!",
    },
    {
      month: "Dec",
      day: "31",
      time: "11:00pm",
      sourceId: null,
      content: "-fix bug",
    },
  ]);

  assert.equal(dated[0].date, "2027-01-02");
  assert.equal(dated[1].date, "2026-12-31");
});

test("html parser accepts month-day and day-month headlines and dates them from the update id", () => {
  const octId = "1792574438";
  const mayId = stamp(2026, 4, 25, 8, 45);
  const html = `
    <div class="changeLogCtn">
      <div class="changelog headline">Update: Oct 21 @ 2:20am</div>
      <p id="${octId}">● Fix bug!</p>
    </div>
    <div class="changeLogCtn">
      <div class="changelog headline">Update: 25 May @ 1:45am</div>
      <p id="${mayId}">-fix bug</p>
    </div>
  `;
  const entries = parseChangelogEntries(html);
  assert.deepEqual(entries.map((entry) => entry.date), ["2026-10-21", "2026-05-25"]);
  assert.equal(entries[0].time, "2:20am");
  assert.equal(entries[1].content.includes("-fix bug") || entries[1].content.includes("fix bug"), true);
});

test("one-line bugfixes are hotfixes and announcements are notices, never rebalance patches", () => {
  assert.equal(classifyChangelogPost("Fix bug!"), "hotfix");
  assert.equal(classifyChangelogPost("-fix bug"), "hotfix");
  assert.equal(classifyChangelogPost("● Fix bug!"), "hotfix");
  assert.ok(["hotfix", "minor"].includes(classifyChangelogPost("Fix bug!")));
  assert.ok(["hotfix", "minor"].includes(classifyChangelogPost("-fix bug")));
  assert.equal(classifyChangelogPost("auto launch after 120s"), "minor");
  assert.equal(classifyChangelogPost(HOSTING_NOTICE), "notice");
  assert.equal(classifyChangelogPost(RANKED_REOPEN), "notice");
  assert.equal(classifyChangelogPost(`Download Xiaoheihe PC Client
Due to maintenance of the DOTA2 Arcade system, you cannot launch games inside DOTA2 for now. Download Xiaoheihe to play.
If you cannot register within the app, complete quick registration at this site.`), "notice");
  assert.equal(classifyChangelogPost(AUG_6), "patch");

  for (const content of ["Fix bug!", "-fix bug", HOSTING_NOTICE, RANKED_REOPEN, "auto launch after 120s"]) {
    const category = classifyChangelogPost(content);
    const parsed = parseChangelogBody(content);
    assert.notEqual(titleForChangelogPost(category, parsed.title, parsed.entries), "Rebalance Patch");
  }
  assert.equal(titleForChangelogPost("hotfix", null, []), "Hotfix");
  assert.equal(titleForChangelogPost("minor", null, []), "Minor Patch");
  assert.equal(titleForChangelogPost("notice", null, parseChangelogBody(HOSTING_NOTICE).entries), "Hosting Notice");
  assert.equal(titleForChangelogPost("notice", null, parseChangelogBody(RANKED_REOPEN).entries), "Ranked Mode Reopening");
});

test("entry splitting keeps full names, drops stray bullets, and attaches each detail to its own line", () => {
  const aug6 = parseChangelogBody(AUG_6);
  assert.equal(aug6.entries[0].detail, "Tune in for the Top of War on Aug 7th - Aug 9th.");
  assert.equal(aug6.entries[1].name, "Largo");
  assert.equal(aug6.entries[1].detail, "Health decreased from 800 to 700");
  assert.equal(aug6.entries[1].kind, "nerf");
  assert.equal(aug6.entries[2].name, "Grimstroke - Stroke of fate");
  assert.match(aug6.entries[2].detail, /^Duration decreased from 10s to 6s/);
  assert.equal(aug6.entries[2].kind, "nerf");
  assert.equal(aug6.entries[3].name, "Second Chance");
  assert.equal(aug6.entries[3].detail, "Removed");
  assert.equal(aug6.entries[3].kind, "removed");

  const sep15 = parseChangelogBody(SEP_15);
  assert.equal(sep15.entries[1].name, "In Ranked Mode");
  assert.match(sep15.entries[1].detail, /^A full completion grants/);
  assert.equal(sep15.entries[1].detail.includes("attempting to reopen"), false);
  assert.match(sep15.entries[2].detail, /Premium Host election/);

  const sep16 = parseChangelogBody(SEP_16);
  assert.equal(sep16.title, "Ranked Mode (Local Host Version) Beta");
  assert.equal(sep16.entries[1].name, "Fixed bugs");
  assert.match(sep16.entries[1].detail, /^incorrect rank evaluation/);
  assert.equal(sep16.entries[1].kind, "fix");
  assert.equal(sep16.entries[2].name, "Badge for Premium local hosts will be awarded later");
  assert.equal(sep16.entries[2].detail, "Awakening the Machine");
  assert.equal(sep16.entries[2].kind, "note");

  const built = buildPatchFromDay([{
    date: "2026-09-16",
    time: "12:02am",
    content: SEP_16,
    sourceId: "1789542131",
  }]);
  assert.notEqual(built.title, "Rebalance Patch");
  assert.equal(built.title, "Ranked Mode (Local Host Version) Beta");

  for (const parsed of [aug6, sep15, sep16]) {
    for (const entry of parsed.entries) {
      assert.equal(entry.name.includes("..."), false, entry.name);
      assert.equal(entry.name.includes("•"), false, entry.name);
      assert.equal(entry.detail.includes("•"), false, entry.detail);
      assert.equal(entry.detail.includes("●"), false, entry.detail);
    }
  }
});

function pagingHtml(range, body = "") {
  return `<div class="workshopBrowsePagingInfo">${range}</div>${body}`;
}

function postHtml(id, headline, body) {
  return `<div class="changeLogCtn"><div class="changelog headline">${headline}</div><p id="${id}">${body}</p></div>`;
}

test("a 429 page is a failure, not the end of the changelog", async () => {
  const requested = [];
  await assert.rejects(
    () => collectChangelogPages({
      isKnown: () => false,
      fetchPage(page) {
        requested.push(page);
        return {
          status: 429,
          html: "You've made too many requests recently",
          entries: [],
        };
      },
    }),
    /rate-limited/,
  );
  assert.deepEqual(requested, [1]);
});

test("a non-200 page is a failure, not the end of the changelog", async () => {
  await assert.rejects(
    () => collectChangelogPages({
      isKnown: () => false,
      fetchPage() {
        return { status: 503, html: "upstream unavailable", entries: [] };
      },
    }),
    /http-503/,
  );
});

test("a page without the Showing header is a failure, not exhaustion", async () => {
  await assert.rejects(
    () => collectChangelogPages({
      isKnown: () => false,
      fetchPage() {
        return {
          status: 200,
          html: "<html><title>Steam Community</title><body>An error was encountered</body></html>",
          entries: [],
        };
      },
    }),
    /missing-paging-header/,
  );
});

test("Showing Y of N identifies the real last page, including a short final page", async () => {
  const result = await collectChangelogPages({
    isKnown: () => false,
    fetchPage() {
      const html = pagingHtml(
        "Showing 1,081-1,087 of 1,087 entries",
        postHtml(stamp(2026, 0, 2, 9, 0), "Update: Jan 2 @ 1:00am", "● Fix bug!"),
      );
      return { status: 200, html, entries: parseChangelogEntries(html) };
    },
  });
  assert.equal(result.exhausted, true);
  assert.equal(result.reachedKnown, false);
  assert.equal(result.pagesFetched, 1);
  assert.equal(result.entries.length, 1);
});

test("an empty page that still has a non-final Showing header fails the run", async () => {
  await assert.rejects(
    () => collectChangelogPages({
      isKnown: () => false,
      fetchPage(page) {
        if (page === 1) {
          const html = pagingHtml(
            "Showing 1-10 of 1,087 entries",
            postHtml("1792574438", "Update: Oct 21 @ 2:20am", "● Fix bug!"),
          );
          return { status: 200, html, entries: parseChangelogEntries(html) };
        }
        return {
          status: 200,
          html: pagingHtml("Showing 11-20 of 1,087 entries"),
          entries: [],
        };
      },
    }),
    /empty-page/,
  );
});

test("pagination stops at the cap when no known post or final Showing header appears", async () => {
  let pages = 0;
  await assert.rejects(
    () => collectChangelogPages({
      maxPages: 30,
      isKnown: () => false,
      fetchPage(page) {
        pages += 1;
        return { entries: [{ sourceId: `id-${page}` }], hasNext: true };
      },
    }),
    /stopped after 30 pages/,
  );
  assert.equal(pages, 30);
});

test("a next link that closes on a parenthesis still counts, and the Showing header wins", () => {
  assert.equal(
    hasNextChangelogPage(
      "See [next](https://steamcommunity.com/sharedfiles/filedetails/changelog/1613886175?l=english&p=2)",
      1,
    ),
    true,
  );
  assert.equal(hasNextChangelogPage("Showing 1-10 of 1,087 entries", 1), true);
  assert.equal(hasNextChangelogPage("Showing 1,081-1,087 of 1,087 entries", 1), false);
});

test("a page that ends before a known post without Y == N does not count as exhausted", async () => {
  await assert.rejects(
    () => collectChangelogPages({
      isKnown: () => false,
      fetchPage() {
        return { entries: [{ sourceId: "orphan" }], hasNext: false };
      },
    }),
    /ended before a known post/,
  );
});

test("hourly generic bugfix posts on one day join a single rollup", () => {
  let notes = [];
  for (let index = 0; index < 5; index += 1) {
    notes = applyIncomingEntries(notes, [{
      date: "2026-10-21",
      time: `${index + 1}:00am`,
      sourceId: `bug-${index}`,
      content: "● Fix bug!",
    }]);
  }
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Fixed a number of bugs");
  assert.equal(notes[0].slug, "2026-10-21-fixed-a-number-of-bugs");
  assert.equal(notes[0].sourceEntries.length, 5);
  assert.equal(notes[0].sections.flatMap((section) => section.entries).length, 1);
  assert.match(notes[0].sections[0].entries[0].detail, /5 Workshop posts on Oct 21/);
});

test("hourly balance posts on one day stay one note and keep every id", () => {
  let notes = [];
  for (let index = 0; index < 5; index += 1) {
    notes = applyIncomingEntries(notes, [{
      date: "2026-08-06",
      time: `${index + 1}:10am`,
      sourceId: `balance-${index}`,
      content: `-Largo: Health decreased from ${800 + index} to ${700 + index}`,
    }]);
  }
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Rebalance Patch");
  assert.equal(notes[0].category, "patch");
  assert.equal(notes[0].closesBugfixRollup, true);
  assert.equal(notes[0].sourceEntries.length, 5);
  assert.equal(notes[0].sections.flatMap((section) => section.entries).length, 5);
});

test("an empty body records its id and does not add a line", () => {
  const notes = applyIncomingEntries([], [
    { date: "2026-10-10", time: "6:27am", sourceId: "bug", content: "● Fix bug!" },
    { date: "2026-10-10", time: "6:52am", sourceId: "1791640346", content: "" },
  ]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].sections.flatMap((section) => section.entries).length, 1);
  assert.ok(notes[0].sourceEntries.some((entry) => entry.sourceId === "1791640346"));
  assert.match(notes[0].sections[0].entries[0].detail, /1 Workshop post/);
});

test("identical notices collapse and a balance patch closes the bugfix rollup", () => {
  const notice = `Download the Xiaoheihe PC client (https://dota.xiaoheihe.cn/).
Due to maintenance of the DOTA2 Arcade system, you cannot launch games inside DOTA2 for now. Download Xiaoheihe to play.`;
  const notes = applyIncomingEntries([], [
    { date: "2026-08-05", time: "9:06am", sourceId: "aug5", content: "-fix bug" },
    { date: "2026-08-06", time: "12:16am", sourceId: "aug6", content: AUG_6 },
    { date: "2026-09-19", time: "4:25am", sourceId: "sep19", content: "● Fix bug!" },
    { date: "2026-10-11", time: "9:25pm", sourceId: "oct11", content: notice },
    { date: "2026-10-19", time: "6:49am", sourceId: "oct19", content: notice },
    { date: "2026-10-21", time: "2:20am", sourceId: "oct21", content: "● Fix bug!" },
  ]);
  const rollups = notes.filter((note) => note.rollup === "bugfixes");
  assert.equal(rollups.length, 2);
  assert.equal(rollups[0].slug, "2026-08-05-fixed-a-number-of-bugs");
  assert.equal(rollups[1].slug, "2026-09-19-fixed-a-number-of-bugs");
  assert.deepEqual(
    rollups[1].sourceEntries.map((entry) => entry.sourceId),
    ["sep19", "oct21"],
  );
  const notices = notes.filter((note) => note.category === "notice");
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].sourceEntries.map((entry) => entry.sourceId), ["oct11", "oct19"]);
});

test("a later notice does not downgrade a same-day balance patch", () => {
  const notes = applyIncomingEntries([], [
    { date: "2026-08-06", time: "12:16am", sourceId: "patch", content: AUG_6 },
    { date: "2026-08-06", time: "9:00pm", sourceId: "notice", content: HOSTING_NOTICE },
  ]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].category, "patch");
  assert.equal(notes[0].closesBugfixRollup, true);
  assert.equal(notes[0].sourceEntries.length, 2);
});

test("a download URL colon does not become the name split", () => {
  const parsed = parseChangelogBody(
    "Download the Xiaoheihe PC client (https://dota.xiaoheihe.cn/). The built-in Dota 2 browser may fail, so open that address in your system browser.",
  );
  assert.equal(parsed.entries.length, 1);
  assert.equal(
    parsed.entries[0].name,
    "Download the Xiaoheihe PC client (https://dota.xiaoheihe.cn/).",
  );
  assert.match(parsed.entries[0].detail, /^The built-in Dota 2 browser/);
});

function savedNote(note) {
  const copy = structuredClone(note);
  delete copy.closesBugfixRollup;
  delete copy.dirty;
  delete copy.sortKey;
  delete copy.openedSortKey;
  delete copy.file;
  return copy;
}

test("a same-day balance post closes the rollup on the next hourly run", () => {
  const existing = {
    date: "2026-10-22",
    title: "Hosting Notice",
    category: "notice",
    slug: "2026-10-22-hosting-notice",
    openedOn: "2026-10-22",
    sourceEntries: [{
      sourceId: "notice-1",
      date: "2026-10-22",
      time: "1:00am",
      contentHash: "notice-hash",
    }],
    sections: [{
      heading: "Notice",
      entries: [{ kind: "note", name: "Servers are hosted locally.", detail: "Do not leave early." }],
    }],
  };
  const afterBalance = applyIncomingEntries([existing], [{
    date: "2026-10-22",
    time: "2:00pm",
    sourceId: "balance-1",
    content: "Largo: Health increased from 700 to 800",
  }]);
  const upgraded = afterBalance.find((note) => note.slug === "2026-10-22-hosting-notice");
  assert.equal(upgraded.category, "patch");
  assert.equal(upgraded.title, "Rebalance Patch");

  const afterFix = applyIncomingEntries(afterBalance.map(savedNote), [{
    date: "2026-10-23",
    time: "3:00am",
    sourceId: "bug-next",
    content: "● Fix bug!",
  }]);
  const rollups = afterFix.filter((note) => note.rollup === "bugfixes");
  assert.equal(rollups.length, 1);
  assert.equal(rollups[0].openedOn, "2026-10-23");
  assert.deepEqual(rollups[0].sourceEntries.map((entry) => entry.sourceId), ["bug-next"]);
});

test("a saved patch closes the rollup even when the title is still a notice", () => {
  const notes = applyIncomingEntries([{
    date: "2026-10-22",
    title: "Hosting Notice",
    category: "patch",
    slug: "2026-10-22-hosting-notice",
    sourceEntries: [{
      sourceId: "balance-1",
      date: "2026-10-22",
      time: "2:00pm",
      contentHash: "balance-hash",
    }],
    sections: [{
      heading: "Changes",
      entries: [{ kind: "buff", name: "Largo", detail: "Health increased from 700 to 800" }],
    }],
  }], [{
    date: "2026-10-23",
    time: "3:00am",
    sourceId: "bug-next",
    content: "Fix bug!",
  }]);
  const rollup = notes.find((note) => note.rollup === "bugfixes");
  assert.equal(rollup.openedOn, "2026-10-23");
  assert.equal(notes.find((note) => note.category === "patch").sourceEntries.some((entry) => entry.sourceId === "bug-next"), false);
});

test("a long bugfix rollup caps the date list and does not repeat its title", () => {
  const dates = ["2026-09-19", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-27", "2026-10-08", "2026-10-10", "2026-10-11", "2026-10-15", "2026-10-19", "2026-10-21"];
  let notes = [];
  dates.forEach((date, index) => {
    notes = applyIncomingEntries(notes, [{
      date,
      time: "1:00am",
      sourceId: `day-${index}`,
      content: "Fix bug!",
    }]);
  });
  const entry = notes[0].sections[0].entries[0];
  assert.notEqual(entry.name, notes[0].title);
  assert.equal(entry.name, "Workshop bugfixes");
  assert.match(entry.detail, /11 Workshop posts from Sep 19 through Oct 21 \(Sep 19, Sep 23, Sep 24, and 8 more\)/);
});

test("xiaoheihe polish keeps unrelated lines and puts the url outside the name", () => {
  const html = `
    <div class="changeLogCtn">
      <div class="changelog headline">Update: Oct 11 @ 9:25pm</div>
      <p id="1791779118">
        <a href="https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fdota.xiaoheihe.cn%2F">Download Xiaoheihe PC Client</a>
        （Right‑click this link ‑ Copy URL to clipboard, then download via your system browser! The built‑in DOTA2 browser may fail to download.）<br>
        Due to maintenance of the DOTA2 Arcade system, you cannot launch games inside DOTA2 for now. Download Xiaoheihe to play.<br>
        If you cannot register within the app, complete quick registration at this site
        <a href="https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fwww.xiaoheihe.cn%2F">https://www.xiaoheihe.cn/</a><br>
        If you cannot see any model in recruit panel, pls enhance your dota2 video settings slightly.<br>
        Largo: Health increased from 700 to 800
      </p>
    </div>
  `;
  const parsed = parseChangelogBody(parseChangelogEntries(html)[0].content);
  const names = parsed.entries.map((entry) => entry.name);
  assert.equal(names[0].includes("http"), false);
  assert.match(names[0], /cannot launch games inside DOTA2/);
  assert.ok(names.some((name) => name === "Download the Xiaoheihe PC client."));
  assert.ok(parsed.entries.some((entry) => entry.detail.includes("https://dota.xiaoheihe.cn/")));
  assert.equal(names.some((name) => /^[)）.]+$/.test(name)), false);
  assert.ok(parsed.entries.some((entry) => entry.name === "Largo"));
  assert.match(parseChangelogEntries(html)[0].content, /Largo: Health increased from 700 to 800/);
});

test("a minor one-liner does not close the bugfix rollup", () => {
  const notes = applyIncomingEntries([], [
    { date: "2026-09-23", time: "11:23pm", sourceId: "before", content: "● Fix bug!" },
    { date: "2026-09-24", time: "7:40am", sourceId: "launch", content: "● auto launch after 120s" },
    { date: "2026-09-25", time: "8:36pm", sourceId: "after", content: "● Fix bug!" },
  ]);
  const rollup = notes.find((note) => note.rollup === "bugfixes");
  assert.equal(rollup.sourceEntries.length, 2);
  assert.equal(notes.find((note) => note.category === "minor").title, "Auto launch after 120s");
});

test("notice and specific bugfix lines get note and fix kinds", () => {
  assert.equal(classifyPatchNoteKind(HOSTING_NOTICE), "note");
  assert.equal(classifyPatchNoteKind("Fix bug!"), "fix");
  assert.equal(classifyPatchNoteKind("-fix bug"), "fix");
  assert.equal(
    classifyPatchNoteKind(
      "Satan, Linken's Sphere, Ogre Hood, Eye of Skadi, Aegis of Immortals, and Bloodstone their special effects or maximum-health-modifying effects missing.",
      "Fix bugs",
    ),
    "fix",
  );
  assert.equal(
    classifyPatchNoteKind("incorrect rank evaluation caused by point pledging.", "Fixed bugs"),
    "fix",
  );
  assert.equal(
    classifyPatchNoteKind("27 Workshop posts from Sep 19 through Oct 21 (Sep 19, Sep 23, Sep 24, and 8 more).", "Workshop bugfixes"),
    "fix",
  );
});
