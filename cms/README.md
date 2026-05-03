# DAC CMS — Sanity Studio

[Sanity](https://www.sanity.io) is the source of truth for game data: units, synergies, items, relics, talents, abilities, game-mode config, and patch notes. The JSON files in `/data/*.json` are now a **generated cache** — they're rebuilt from Sanity by `pnpm pull` and consumed by the rest of the monorepo (Electron app, Next.js web, Python analyzer, …) exactly as before.

## Why Sanity?

- **Free tier easily fits this dataset.** ~600 records and a few hundred icons; the free tier allows 10 000 documents, 1 GB assets, 100k API requests/month.
- **Real reference fields** — e.g. a `unit` document literally references its `synergy` documents, so renames propagate automatically.
- **Image CDN** built in for the icons.
- **Schemas live in this repo as TypeScript.** Anyone can read them; no point-and-click admin lock-in.
- **Python and Node clients** so the VPK extraction pipeline (`data/extract_vpk.py`) and the editorial workflow share the same backend.

## Repo layout

```
cms/
├── sanity.config.ts          # Studio entry — reads project ID from env
├── sanity.cli.ts             # CLI config (deploy / dataset / etc.)
├── schemas/                  # Document + object schemas (one file per type)
│   ├── unit.ts, synergy.ts, item.ts, relic.ts, talent.ts, ability.ts,
│   ├── gameMode.ts, patchNote.ts
│   └── objects/              # Re-usable inline objects (unitStats, names, …)
├── structure/deskStructure.ts # Custom desk (singletons, ordering)
└── scripts/
    ├── client.ts             # Shared Sanity client + slugify + docId helpers
    ├── migrate.ts            # One-shot import: /data/*.json → Sanity
    └── pull.ts               # Sanity → /data/*.json (cache refresh)
```

## First-time setup

You only do this once per project.

1. **Create a Sanity project.** From `cms/`:
   ```bash
   pnpm install
   pnpm dlx sanity@latest init --create-project "DAC CMS" --dataset production
   ```
   Pick a project name, accept "production" as the dataset, and choose **schema-less / blank** when prompted (we already have schemas in this folder). This writes a `.sanity` folder and prints your **project ID**.

2. **Configure env.**
   ```bash
   cp .env.example .env
   # Edit .env and fill in:
   #   SANITY_PROJECT_ID=<id from step 1>
   #   SANITY_DATASET=production
   #   SANITY_TOKEN=<see step 3>
   ```

3. **Create a write token** at `https://www.sanity.io/manage/project/<PROJECT_ID>/api#tokens`. Choose **Editor** (or **Deploy Studio**) scope. Paste it into `.env` as `SANITY_TOKEN`.

4. **Run the one-shot migration** to seed Sanity from the existing `/data/*.json` files:
   ```bash
   pnpm migrate              # data only (~1–2 minutes)
   pnpm migrate -- --icons   # also upload all icons in /data/icons (slow, ~5 min)
   ```
   Re-runs are safe — it uses `createOrReplace` with deterministic IDs.

5. **Deploy the Studio** so editors can use it in a browser:
   ```bash
   pnpm deploy
   # Choose a hostname, e.g. "dac-cms" → https://dac-cms.sanity.studio
   ```

## Day-to-day commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the Studio locally at http://localhost:3333 |
| `pnpm pull` | Pulls all docs from Sanity → `/data/*.json` (refreshes the cache) |
| `pnpm pull -- --only=units` | Pull a single kind |
| `pnpm pull -- --dry-run` | Show what would be written without touching disk |
| `pnpm migrate` | Push `/data/*.json` → Sanity (used after a VPK extract or rare manual import) |
| `pnpm migrate -- --icons` | Same, plus upload icons |
| `pnpm migrate -- --only=synergies,units` | Push specific kinds |
| `pnpm deploy` | Deploy the Studio so others can edit in a browser |
| `pnpm check` | TypeScript type-check the schemas + scripts |

## Pulling new VPK data into the CMS

When a new patch ships, the pipeline is:

```
                   ┌──── extract_vpk.py (Python) ────┐
   Dota VPK  ──►   │  parses KV1, writes /data/*.json │
                   └──────────────┬───────────────────┘
                                  │ --push-cms
                                  ▼
                         Sanity Cloud (CMS)
                                  │ pnpm pull
                                  ▼
                         /data/*.json (cache)
                                  │
            ┌─────────────────────┼─────────────────────┐
            ▼                     ▼                     ▼
       Electron app          Next.js web           Python analyzer
       (reads /data)         (reads @data/*)       (reads /data)
```

So a typical patch day looks like:

```bash
# 1. Extract from VPK and immediately push to Sanity:
python data/extract_vpk.py --push-cms

# 2. (Optional) Hand-curate items.json / synergies / patch notes in the Studio.

# 3. Refresh the local /data cache for the rest of the monorepo:
cd cms && pnpm pull
```

## Schema notes

- **`gameId`** is the field that holds the original VPK identifier (e.g. `is_assassin`, `chess_aa`, `item_bkb`). It's `readOnly` in the Studio because changing it would break VPK reconciliation.
- **Document IDs** are deterministic: `unit-aegis`, `synergy-assassin`, `item-bkb`, etc. This is what makes `migrate` idempotent and what lets `extract_vpk.py --push-cms` upsert in-place.
- **References are resolved by display name** when the original JSON used display names (e.g. `units.synergies = ["Knight", "Undead"]`). The migrate script looks them up against the synergy `name` field; the pull script projects them back via GROQ `synergies[]->name`.
- **Singletons.** `gameMode` is enforced as a singleton via the desk structure (always `gameMode-singleton`).
- **Patch notes** are *not* generated by the VPK pipeline — they're hand-curated in the Studio (or imported from existing `data/patch_notes/*.json` once via `pnpm migrate --only=patchNotes`).
- **Icons** live in two places: as Sanity image assets (referenced by docs, served via Sanity's CDN) and as PNGs under `/data/icons/` (so the desktop app can keep doing local file reads). `pnpm migrate --icons` uploads from local PNGs; the desktop build still uses the local PNGs.

## Why `/data/*.json` still exists

Sanity is the source of truth, but the existing consumers — Electron `fs.readFileSync`, Python `Path.read_text`, Next.js `import @data/*` — would break if forced to fetch over HTTP. So `/data/*.json` is now a **generated cache**:

- Editors edit in the Studio.
- The VPK pipeline pushes via `--push-cms`.
- A periodic `pnpm pull` (or pre-build hook) refreshes `/data/*.json` from Sanity.
- The rest of the codebase keeps reading local files exactly as it did before — no behavioural changes.

If you want to remove the local cache and read directly from Sanity at runtime, that's a follow-up refactor (the URL would be `https://<project-id>.api.sanity.io/v2024-10-01/data/query/<dataset>?query=...`).

## Icon hosting (Sanity CDN with Vercel fallback)

After `pnpm migrate -- --icons`, Sanity hosts every uploaded icon on its CDN. `pnpm pull` projects each asset's URL and intrinsic dimensions back into the JSON cache as two new optional fields per entity:

```jsonc
// e.g. units.json
{
  "units": {
    "Aegis": {
      "cost": 4,
      "synergies": ["Knight"],
      "icon_url": "https://cdn.sanity.io/images/<proj>/<dataset>/abc.png",
      "icon_dimensions": { "width": 128, "height": 128 }
    }
  }
}
```

The web/ helpers (`web/lib/{units,synergies,relics,items}.ts`) read these fields and expose a precomputed `iconUrl` on every `DisplayUnit`, `DisplaySynergy`, `DisplayRelic`, `DisplayItem`:

```ts
{
  ...,
  iconStem: "aegis",                 // stem used by web/scripts/sync-icons.mjs
  iconUrl: "https://cdn.sanity.io/...", // Sanity URL when uploaded; local fallback otherwise
  iconDimensions: { width: 128, height: 128 } // null when not from Sanity
}
```

**Fallback semantics:** if `icon_url` is missing in the JSON (e.g. no asset uploaded yet), the lib falls back to `/icons/<type>/<stem>.png`, which `web/scripts/sync-icons.mjs` copies from `data/icons/` into `web/public/icons/` at build time. So the site still renders correctly before Sanity is set up.

Wired consumers in web/:
- Pages that read `Display*` objects directly: `pages/units.tsx`, `pages/relics.tsx`, `pages/species.tsx`, `pages/classes.tsx`, `pages/units/[slug].tsx`, `pages/synergies/[slug].tsx`, `pages/relics/[slug].tsx`, `pages/patch-notes/[slug].tsx`.
- Pages/components that receive raw lineup strings use `web/lib/icons.ts → resolveIconUrl(type, stem)`, which looks up the Sanity URL by stem and falls back to `/icons/<type>/<stem>.png`: `components/GameRow.tsx`, `pages/games/[id].tsx`, `pages/players/[steamId].tsx`.

### Rolling back to Vercel-only image hosting

If the Sanity CDN ever doesn't pan out (cost, latency, etc.), the rollback is small:

1. **Stop populating `icon_url`.** Either delete the icon assets in Sanity (`pnpm sanity dataset delete-assets <dataset>`) or remove the `${ICON_PROJECTION}` snippet from `cms/scripts/pull.ts` so the JSON cache is rebuilt without `icon_url` fields.
2. **Re-run `pnpm pull`.** With `icon_url` absent, every `Display*.iconUrl` falls back to `/icons/<type>/<stem>.png`.
3. **Confirm `web/scripts/sync-icons.mjs` is still wired.** It already runs at `predev` / `prebuild` and copies `data/icons/` → `web/public/icons/`. Vercel will host them as static assets exactly like today.

No consumer code needs to change for the rollback — the Sanity-or-local resolution happens once in the lib layer.
