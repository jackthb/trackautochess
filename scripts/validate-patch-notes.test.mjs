import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  crossCheckPatchAgainstDiff,
  validatePatchDocument,
} from "./validate-patch-notes.mjs";

test("accepts the corrected September 7 patch on main", () => {
  const patch = JSON.parse(
    readFileSync(
      new URL("../content/patch-notes/2026-09-07-rebalance-patch.json", import.meta.url),
      "utf8",
    ),
  );

  assert.deepEqual(validatePatchDocument(patch).mismatches, []);
});

test("reports the old Lina cooldown label as a mismatch", () => {
  const patch = {
    date: "2026-09-07",
    title: "Rebalance Patch",
    sections: [
      {
        heading: "Chess Pieces",
        entries: [
          {
            kind: "buff",
            name: "Lina - Laguna Blade",
            detail: "Cooldown increased from 8/6/4s to 8/7/6s",
          },
        ],
      },
    ],
  };

  assert.deepEqual(validatePatchDocument(patch).mismatches, [
    {
      section: "Chess Pieces",
      name: "Lina - Laguna Blade",
      detail: "Cooldown increased from 8/6/4s to 8/7/6s",
      actual: "buff",
      expected: "nerf",
    },
  ]);
});

test("CLI prints the mismatch and exits non-zero", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "patch-note-validation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const patchPath = join(directory, "wrong-lina.json");
  writeFileSync(
    patchPath,
    JSON.stringify({
      date: "2026-09-07",
      title: "Wrong Lina fixture",
      sections: [
        {
          heading: "Chess Pieces",
          entries: [
            {
              kind: "buff",
              name: "Lina - Laguna Blade",
              detail: "Cooldown increased from 8/6/4s to 8/7/6s",
            },
          ],
        },
      ],
    }),
  );

  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./validate-patch-notes.mjs", import.meta.url)), patchPath],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected nerf, found buff/);
  assert.match(result.stderr, /Cooldown increased from 8\/6\/4s to 8\/7\/6s/);
});

test("best-effort diff check recognizes an entry name and stat", () => {
  const patch = {
    sections: [
      {
        heading: "Chess Pieces",
        entries: [
          {
            kind: "nerf",
            name: "Lina - Laguna Blade",
            detail: "Cooldown increased from 8/6/4s to 8/7/6s",
          },
        ],
      },
    ],
  };
  const diff = `diff --git a/data/vscripts_prev/abilities/lina.lua b/data/vscripts/abilities/lina.lua
--- a/data/vscripts_prev/abilities/lina.lua
+++ b/data/vscripts/abilities/lina.lua
-laguna_blade.cooldown = { 8, 6, 4 }
+laguna_blade.cooldown = { 8, 7, 6 }
`;

  assert.deepEqual(crossCheckPatchAgainstDiff(patch, diff), [
    {
      section: "Chess Pieces",
      name: "Lina - Laguna Blade",
      matchedName: true,
      matchedStats: ["cooldown"],
    },
  ]);
});
