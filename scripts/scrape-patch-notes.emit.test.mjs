import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./scrape-patch-notes.mjs", import.meta.url));
const until = "1792574438";
const since = "1792566238";
const knownOnDisk = "1792574438";
const oct21Ids = ["1792566239", "1792571846", "1792573504", "1792573595", "1792574438"];

function page(body, paging = "Showing 1-3 of 40 entries") {
  return `<div class="workshopBrowsePagingInfo">${paging}</div>${body}`;
}

const posts = `
  <div class="changeLogCtn">
    <div class="headline">Update: Oct 21 @ 3:33am</div>
    <p id="1792574538">● Brand new fixture note zzz-emit</p>
  </div>
  <div class="changeLogCtn">
    <div class="headline">Update: Oct 21 @ 2:20am</div>
    <p id="${knownOnDisk}">● Fix bug already saved zzz-emit</p>
  </div>
  <div class="changeLogCtn">
    <div class="headline">Update: 19 Sep @ 1:11am</div>
    <p id="1789817000">● Earlier fixture note zzz-emit</p>
  </div>
`;

function run(args, extra = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...extra, script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("emit-entries in the recorded range keeps posts already on disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "changelog-"));
  try {
    const saved = JSON.parse(
      await readFile(
        fileURLToPath(new URL("../content/patch-notes/2026-09-19-fixed-a-number-of-bugs.json", import.meta.url)),
        "utf8",
      ),
    );
    const savedIds = (saved.sourceEntries || []).map((entry) => String(entry.sourceId));
    assert.ok(savedIds.includes(knownOnDisk));
    const htmlPath = path.join(dir, "changelog.html");
    const outPath = path.join(dir, "entries.json");
    await writeFile(htmlPath, page(posts));
    const result = await run([
      `--emit-entries=${outPath}`,
      `--changelog-file=${htmlPath}`,
      `--since=1789817000`,
      `--until=${until}`,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /patch note\(s\) to write/);
    const entries = JSON.parse(await readFile(outPath, "utf8"));
    assert.deepEqual(
      entries.map((entry) => entry.sourceId),
      [knownOnDisk],
    );
    assert.deepEqual(
      entries.map((entry) => entry.date),
      ["2026-10-21"],
    );
    assert.equal(
      entries[0].url,
      `https://steamcommunity.com/sharedfiles/filedetails/changelog/1613886175#${knownOnDisk}`,
    );
    assert.match(entries[0].excerpt, /Fix bug already saved zzz-emit/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("emit-entries refuses a page without the Showing header", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "changelog-"));
  try {
    const htmlPath = path.join(dir, "changelog.html");
    const outPath = path.join(dir, "entries.json");
    await writeFile(htmlPath, posts);
    const result = await run([
      `--emit-entries=${outPath}`,
      `--changelog-file=${htmlPath}`,
      `--since=${since}`,
      `--until=${until}`,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /missing-paging-header|Refusing to write/);
    await assert.rejects(readFile(outPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("emit-entries refuses a non-final page that never leaves the update range", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "changelog-"));
  try {
    const htmlPath = path.join(dir, "changelog.html");
    const outPath = path.join(dir, "entries.json");
    const onlyRecent = `
      <div class="changeLogCtn">
        <div class="headline">Update: Oct 21 @ 3:33am</div>
        <p id="1792574538">● Only the recent fixture note zzz-emit</p>
      </div>
    `;
    await writeFile(htmlPath, page(onlyRecent, "Showing 1-1 of 40 entries"));
    const result = await run([
      `--emit-entries=${outPath}`,
      `--changelog-file=${htmlPath}`,
      `--since=${since}`,
      `--until=${until}`,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /update range|Refusing to write/);
    await assert.rejects(readFile(outPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("emit-entries without --until still refuses a page that misses every known post", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "changelog-"));
  try {
    const htmlPath = path.join(dir, "changelog.html");
    const outPath = path.join(dir, "entries.json");
    const freshOnly = posts.replaceAll(knownOnDisk, "1700000000");
    await writeFile(htmlPath, page(freshOnly, "Showing 1-3 of 40 entries"));
    const result = await run([
      `--emit-entries=${outPath}`,
      `--changelog-file=${htmlPath}`,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /known post|Refusing to write/);
    await assert.rejects(readFile(outPath, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function oct21Page() {
  const posts = [
    ["1792574438", "2:20am", "Fix bug!"],
    ["1792573595", "2:06am", "Third fix"],
    ["1792573504", "2:05am", "Second fix"],
    ["1792571846", "1:37am", "First fix"],
    ["1792566239", "12:03am", "Now you can activate your steam battle pass"],
  ].map(([id, time, text]) => `
    <div class="changeLogCtn">
      <div class="headline">Update: Oct 21 @ ${time}</div>
      <p id="${id}">● ${text}</p>
    </div>`).join("");
  return page(posts, "Showing 1-5 of 5 entries");
}

test("emit-entries uses the reader when Steam blocks the runner", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "changelog-"));
  try {
    const outPath = path.join(dir, "entries.json");
    const mockPath = path.join(dir, "mock-fetch.mjs");
    const html = oct21Page();
    await writeFile(mockPath, `
      const html = ${JSON.stringify(html)};
      globalThis.fetch = async (url) => {
        const href = String(url);
        if (href.includes("r.jina.ai")) {
          return { status: 200, async text() { return html; } };
        }
        return { status: 403, async text() { return "Access Denied"; } };
      };
    `);
    const result = await run([
      `--emit-entries=${outPath}`,
      `--since=${since}`,
      `--until=${until}`,
    ], ["--import", mockPath]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /Text-rendered fallback returned 5 entries/);
    assert.doesNotMatch(result.stderr, /already saved in content\/patch-notes/);
    const entries = JSON.parse(await readFile(outPath, "utf8"));
    assert.deepEqual(entries.map((entry) => entry.sourceId), oct21Ids);
    assert.match(entries[0].excerpt, /steam battle pass/);
    assert.match(entries[4].excerpt, /Fix bug!/);
    assert.equal(entries.some((entry) => entry.origin), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("emit-entries uses saved patch notes when the reader page has no posts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "changelog-"));
  try {
    const outPath = path.join(dir, "entries.json");
    const mockPath = path.join(dir, "mock-fetch.mjs");
    const html = `<div class="workshopBrowsePagingInfo">Showing 1-1 of 1 entries</div>`;
    await writeFile(mockPath, `
      const html = ${JSON.stringify(html)};
      globalThis.fetch = async (url) => {
        const href = String(url);
        if (href.includes("r.jina.ai")) {
          return { status: 200, async text() { return html; } };
        }
        return { status: 403, async text() { return "Access Denied"; } };
      };
    `);
    const result = await run([
      `--emit-entries=${outPath}`,
      `--since=${since}`,
      `--until=${until}`,
    ], ["--import", mockPath]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /returned no entries/);
    assert.match(result.stderr, /already saved in content\/patch-notes/);
    const entries = JSON.parse(await readFile(outPath, "utf8"));
    assert.deepEqual(entries.map((entry) => entry.sourceId), oct21Ids);
    assert.ok(entries.every((entry) => entry.origin === "saved-patch-notes"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("emit-entries uses saved patch notes when Steam and the reader are blocked", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "changelog-"));
  try {
    const outPath = path.join(dir, "entries.json");
    const mockPath = path.join(dir, "mock-fetch.mjs");
    await writeFile(mockPath, `
      globalThis.fetch = async () => ({ status: 403, async text() { return "blocked"; } });
    `);
    const result = await run([
      `--emit-entries=${outPath}`,
      `--since=${since}`,
      `--until=${until}`,
    ], ["--import", mockPath]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /already saved in content\/patch-notes/);
    const entries = JSON.parse(await readFile(outPath, "utf8"));
    assert.deepEqual(entries.map((entry) => entry.sourceId), oct21Ids);
    assert.match(entries[0].excerpt, /steam battle pass/);
    assert.ok(entries.every((entry) => entry.origin === "saved-patch-notes"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
