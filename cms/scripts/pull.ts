/**
 * Pull all game data from Sanity → /data/*.json files.
 *
 * Reconstructs the EXACT shapes the existing consumers (app/main.js, Python
 * backend, Next.js, analyzer) read from disk, so /data is treated as a
 * generated cache. The CMS is the source of truth.
 *
 * Usage (from /cms):
 *   pnpm pull
 *   pnpm pull -- --dry-run     # log what would be written, don't touch disk
 *   pnpm pull -- --only=units  # pull a single kind
 */
import fs from 'node:fs'
import path from 'node:path'
import {makeClient, DATA_DIR} from './client'

type Args = {only: Set<string> | null; dryRun: boolean}
function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const a: Args = {only: null, dryRun: false}
  for (const x of argv) {
    if (x === '--dry-run') a.dryRun = true
    else if (x.startsWith('--only=')) a.only = new Set(x.slice('--only='.length).split(','))
  }
  return a
}
const args = parseArgs()
const wants = (k: string) => !args.only || args.only.has(k)

// Token is not strictly required for reads on a public dataset, but most setups
// use private datasets; we let the client decide.
const client = makeClient({requireToken: false})

function writeJson(rel: string, obj: any) {
  const out = path.join(DATA_DIR, rel)
  const text = JSON.stringify(obj, null, 2) + '\n'
  if (args.dryRun) {
    console.log(`  [dry] would write ${rel} (${text.length} bytes)`)
    return
  }
  fs.mkdirSync(path.dirname(out), {recursive: true})
  const tmp = `${out}.tmp`
  fs.writeFileSync(tmp, text, 'utf-8')
  fs.renameSync(tmp, out)
  console.log(`  wrote ${rel} (${text.length} bytes)`)
}

// Reverse the camelCase → snake_case used in the schemas, restoring exact JSON
// shapes that the rest of the codebase reads.
function statBlock(s: any) {
  if (!s) return undefined
  return {
    hp: s.hp ?? 0,
    mana: s.mana ?? 0,
    atk: s.atk ?? [0, 0],
    armor: s.armor ?? 0,
    magic_resist: s.magicResist ?? 0,
    atk_rate: s.atkRate ?? 0,
    atk_range: s.atkRange ?? 0,
  }
}

// GROQ projection for an icon image asset. Returns null when no image is set,
// otherwise the CDN URL plus intrinsic dimensions (so Next.js Image can avoid
// layout shift without an extra round trip).
const ICON_PROJECTION = `"icon_url": icon.asset->url,
   "icon_dimensions": icon.asset->metadata.dimensions{width, height}`

// GROQ projection that coalesces editor `nameOverrides.*` over the VPK-fed
// `names.*` per locale. The returned `names` object has all locales the
// schema declares; falsy slots stay falsy so the web layer's pickLocalized
// fallback still kicks in.
const NAMES_PROJECTION = `"names": {
    "en": coalesce(nameOverrides.en, names.en),
    "lore": coalesce(nameOverrides.lore, names.lore),
    "ko": coalesce(nameOverrides.ko, names.ko),
    "ru": coalesce(nameOverrides.ru, names.ru),
    "zhCn": coalesce(nameOverrides.zhCn, names.zhCn),
    "zhTw": coalesce(nameOverrides.zhTw, names.zhTw)
  }`

// Talent uses `titles`/`titleOverrides` instead of `names`/`nameOverrides`.
const TITLES_PROJECTION = `"titles": {
    "en": coalesce(titleOverrides.en, titles.en),
    "lore": coalesce(titleOverrides.lore, titles.lore),
    "ko": coalesce(titleOverrides.ko, titles.ko),
    "ru": coalesce(titleOverrides.ru, titles.ru),
    "zhCn": coalesce(titleOverrides.zhCn, titles.zhCn),
    "zhTw": coalesce(titleOverrides.zhTw, titles.zhTw)
  }`

// Inverse of cms/scripts/migrate.ts:localizedNames — converts Sanity's
// localizedNames object shape ({zhCn, zhTw, ...}) back to the JSON i18n
// shape ({"zh-cn", "zh-tw", ...}) that the web/data layer reads.
function localizedNamesToJson(
  obj: Record<string, string | null | undefined> | null | undefined,
): Record<string, string> | undefined {
  if (!obj) return undefined
  const map: Record<string, string> = {}
  if (obj.en) map.en = obj.en
  if (obj.lore) map.lore = obj.lore
  if (obj.ko) map.ko = obj.ko
  if (obj.ru) map.ru = obj.ru
  if (obj.zhCn) map['zh-cn'] = obj.zhCn
  if (obj.zhTw) map['zh-tw'] = obj.zhTw
  return Object.keys(map).length > 0 ? map : undefined
}

function iconFields(r: any, existing?: {icon_url?: string | null; icon_dimensions?: {width: number; height: number} | null}): {icon_url: string | null; icon_dimensions: {width: number; height: number} | null} {
  return {
    icon_url: r.icon_url ?? existing?.icon_url ?? null,
    icon_dimensions: r.icon_dimensions ?? existing?.icon_dimensions ?? null,
  }
}

function readExistingIcons(filename: string, innerKey: string | null = null): Map<string, {icon_url?: string | null; icon_dimensions?: any}> {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8')
    const parsed = JSON.parse(raw)
    const records: Record<string, any> = innerKey ? parsed?.[innerKey] ?? {} : parsed
    const out = new Map<string, {icon_url?: string | null; icon_dimensions?: any}>()
    for (const [id, rec] of Object.entries(records)) {
      if (rec?.icon_url || rec?.icon_dimensions) {
        out.set(id, {icon_url: rec.icon_url, icon_dimensions: rec.icon_dimensions})
      }
    }
    return out
  } catch {
    return new Map()
  }
}

async function pullSynergies() {
  // Query in stable order so files diff cleanly.
  const rows = await client.fetch<any[]>(
    `*[_type == "synergy"] | order(gameId asc){
      gameId, name, description, descriptionHtml, lore, notes, tiers, abilitySpecial,
      ${NAMES_PROJECTION},
      ${ICON_PROJECTION}
    }`,
  )
  const i18n = readExistingI18n('synergies.json')
  const existingSynIcons = readExistingIcons('synergies.json')
  const out: Record<string, any> = {}
  for (const r of rows) {
    const sanityNames = localizedNamesToJson(r.names)
    const merged = applyI18n(
      {
        name: r.name,
        description: r.description ?? '',
        description_html: r.descriptionHtml ?? '',
        lore: r.lore ?? '',
        notes: r.notes ?? [],
        tiers: r.tiers ?? [],
        ability_special: r.abilitySpecial ? JSON.parse(r.abilitySpecial) : {},
        ...iconFields(r, existingSynIcons.get(r.gameId)),
      },
      i18n.get(r.gameId),
    )
    if (sanityNames) merged.names = sanityNames
    out[r.gameId] = merged
  }
  writeJson('synergies.json', out)
}

async function pullUnits() {
  const rows = await client.fetch<any[]>(
    `*[_type == "unit"] | order(name asc){
      name, gameId, cost, pool, attackType, abilities, stats,
      "synergies": synergies[]->name,
      ${NAMES_PROJECTION},
      ${ICON_PROJECTION}
    }`,
  )
  const existingFullIcons = readExistingIcons('units_full.json')
  const full: Record<string, any> = {}
  for (const r of rows) {
    const localizedNames = localizedNamesToJson(r.names)
    const fullIcon = iconFields(r, existingFullIcons.get(r.name))
    full[r.name] = {
      id: r.gameId ?? '',
      cost: r.cost,
      pool: r.pool,
      synergies: r.synergies ?? [],
      names: localizedNames,
      attack_type: r.attackType ?? null,
      abilities: r.abilities ? JSON.parse(r.abilities) : null,
      stats: r.stats
        ? {
            '1_star': statBlock(r.stats.star1),
            '2_star': statBlock(r.stats.star2),
            '3_star': statBlock(r.stats.star3),
          }
        : undefined,
      ...fullIcon,
    }
  }
  // Preserve the `aliases` map (data/aliases.json). Aliases are a VPK-pipeline
  // artifact (data/extract_vpk.py) — they're not editorial and Sanity has no
  // concept of them. Re-apply the same filter extract_vpk uses: keep an alias
  // only when its canonical target exists and the alias name doesn't collide
  // with a real unit.
  const existingAliases = readExistingAliases()
  const aliases: Record<string, string> = {}
  for (const [alias, canonical] of Object.entries(existingAliases)) {
    if (full[canonical] && !full[alias]) aliases[alias] = canonical
  }
  writeJson('units_full.json', full)
  writeJson('aliases.json', aliases)
}

function readExistingAliases(): Record<string, string> {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'aliases.json'), 'utf-8')
    return JSON.parse(raw) ?? {}
  } catch {
    return {}
  }
}

// Per-record i18n fields (`names`, `descriptions`, `lore_i18n`) are produced
// by data/enrich_i18n.py against the VPK and aren't editorial — Sanity has
// no schema for them. To keep them across `pnpm pull` cycles we read the
// existing JSON, snapshot the i18n maps by id, then re-attach them to each
// record after the pull.
type I18nFields = {
  names?: Record<string, string>
  descriptions?: Record<string, string>
  lore_i18n?: Record<string, string>
}

function readExistingI18n(
  filename: string,
  innerKey: string | null = null,
): Map<string, I18nFields> {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8')
    const parsed = JSON.parse(raw)
    const records: Record<string, any> = innerKey ? parsed?.[innerKey] ?? {} : parsed
    const out = new Map<string, I18nFields>()
    for (const [id, rec] of Object.entries(records)) {
      const fields: I18nFields = {}
      if (rec?.names) fields.names = rec.names
      if (rec?.descriptions) fields.descriptions = rec.descriptions
      if (rec?.lore_i18n) fields.lore_i18n = rec.lore_i18n
      if (Object.keys(fields).length > 0) out.set(id, fields)
    }
    return out
  } catch {
    return new Map()
  }
}

function applyI18n<T extends Record<string, any>>(
  rec: T,
  i18n: I18nFields | undefined,
): T & I18nFields {
  if (!i18n) return rec
  const merged: T & I18nFields = {...rec}
  if (i18n.names) merged.names = i18n.names
  if (i18n.descriptions) merged.descriptions = i18n.descriptions
  if (i18n.lore_i18n) merged.lore_i18n = i18n.lore_i18n
  return merged
}

async function pullItems() {
  const rows = await client.fetch<any[]>(
    `*[_type == "item"] | order(gameId asc){
      gameId, name, description, lore, quality, texture, tier, inCuratedSet, iconFile, notes,
      ${NAMES_PROJECTION},
      ${ICON_PROJECTION}
    }`,
  )
  const i18n = readExistingI18n('items_full.json')
  const existingFullIcons = readExistingIcons('items_full.json')
  const existingCuratedIcons = readExistingIcons('items.json', 'items')
  const full: Record<string, any> = {}
  const curated: Record<string, any> = {}
  for (const r of rows) {
    const fullIcon = iconFields(r, existingFullIcons.get(r.gameId))
    const sanityNames = localizedNamesToJson(r.names)
    const merged = applyI18n(
      {
        name: r.name,
        description: r.description ?? '',
        lore: r.lore ?? '',
        quality: r.quality ?? '',
        texture: r.texture ?? '',
        notes: r.notes ?? [],
        ...fullIcon,
      },
      i18n.get(r.gameId),
    )
    if (sanityNames) merged.names = sanityNames
    full[r.gameId] = merged
    if (r.inCuratedSet) {
      curated[r.name] = {
        tier: r.tier,
        icon: r.iconFile ?? '',
        ...iconFields(r, existingCuratedIcons.get(r.name)),
      }
    }
  }
  writeJson('items_full.json', full)
  writeJson('items.json', {items: curated, total: Object.keys(curated).length})
}

// Relic _Lore in the VPK is a placeholder for most relics ("From Relic Box"
// / "From: Relicbox"). Scrub at write time so the JSON cache only carries
// real flavour text.
const RELIC_BOX_LORE = /^\s*from:?\s*relic\s*box\s*$/i

function scrubRelicLore(value: string): string {
  return value && RELIC_BOX_LORE.test(value) ? '' : value
}

async function pullRelics() {
  const rows = await client.fetch<any[]>(
    `*[_type == "relic"] | order(gameId asc){
      gameId, name, description, lore,
      ${NAMES_PROJECTION},
      ${ICON_PROJECTION}
    }`,
  )
  const i18n = readExistingI18n('relics.json', 'relics')
  const inner: Record<string, any> = {}
  for (const r of rows) {
    const sanityNames = localizedNamesToJson(r.names)
    const merged = applyI18n(
      {
        name: r.name,
        description: r.description ?? '',
        lore: scrubRelicLore(r.lore ?? ''),
        ...iconFields(r),
      },
      i18n.get(r.gameId),
    )
    if (sanityNames) merged.names = sanityNames
    if (merged.lore_i18n) {
      const cleaned: Record<string, string> = {}
      for (const [lang, v] of Object.entries(merged.lore_i18n)) {
        const s = scrubRelicLore(v as string)
        if (s) cleaned[lang] = s
      }
      merged.lore_i18n = cleaned
    }
    inner[r.gameId] = merged
  }
  writeJson('relics.json', {relics: inner})
}

async function pullTalents() {
  const rows = await client.fetch<any[]>(
    `*[_type == "talent"] | order(slot asc){
      slot, title, description,
      ${TITLES_PROJECTION}
    }`,
  )
  const out: Record<string, any> = {}
  for (const r of rows) {
    const titles = localizedNamesToJson(r.titles)
    const entry: Record<string, any> = {title: r.title, description: r.description ?? ''}
    if (titles) entry.titles = titles
    out[r.slot] = entry
  }
  writeJson('talents.json', out)
}

async function pullAbilities() {
  const rows = await client.fetch<any[]>(
    `*[_type == "ability"] | order(gameId asc){
      gameId, name, description, cooldown, manaCost, castRange, abilitySpecial,
      ${NAMES_PROJECTION}
    }`,
  )
  const out: Record<string, any> = {}
  for (const r of rows) {
    const names = localizedNamesToJson(r.names)
    const entry: Record<string, any> = {
      name: r.name ?? '',
      description: r.description ?? '',
      cooldown: r.cooldown ?? '',
      mana_cost: r.manaCost ?? '',
      cast_range: r.castRange ?? '',
      ability_special: r.abilitySpecial ? JSON.parse(r.abilitySpecial) : {},
    }
    if (names) entry.names = names
    out[r.gameId] = entry
  }
  writeJson('abilities.json', out)
}

async function pullGameMode() {
  const r = await client.fetch<any>(
    `*[_id == "gameMode-singleton"][0]{
      "drop_relic_list": dropRelicList[]->gameId,
      "quest_2_relic_list": quest2RelicList[]->gameId,
      "prepare_timer": prepareTimer,
      "battle_timer": battleTimer
    }`,
  )
  writeJson('game_mode.json', {
    drop_relic_list: r?.drop_relic_list ?? [],
    quest_2_relic_list: r?.quest_2_relic_list ?? [],
    prepare_timer: r?.prepare_timer ?? 0,
    battle_timer: r?.battle_timer ?? 0,
  })
}

function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const UNIT_SLUG_ALIASES: Record<string, string> = {
  spectre: 'spectres',
  bloodseeker: 'blood-seeker',
  'soul-breaker': 'spirit-breaker',
  'dark-seer': 'darkseer',
  'terror-blade': 'terrorblade',
  'centaur-warrior': 'centaur-warrunner',
  abbadon: 'abaddon',
  'beast-master': 'beastmaster',
  'chao-knight': 'chaos-knight',
  'tide-hunter': 'tidehunter',
  'elter-titan': 'elder-titan',
  'ring-master': 'ringmaster',
  worlock: 'warlock',
  necrolyte: 'necrophos',
  antimage: 'anti-mage',
  'life-stealer': 'lifestealer',
}

function buildEntityResolver(): (name: string) => {entity_type: string; entity_slug: string} | null {
  const itemSlugs = new Set<string>()
  const relicSlugs = new Set<string>()
  const talentNames = new Map<string, true>()
  const unitSlugs = new Set<string>()
  const synergySlugs = new Set<string>()

  try {
    const items = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'items.json'), 'utf-8'))
    for (const name of Object.keys(items.items ?? {})) itemSlugs.add(slugifyName(name))
  } catch {}
  try {
    const relics = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'relics.json'), 'utf-8'))
    for (const r of Object.values(relics.relics ?? {}) as any[]) {
      if (r.name) relicSlugs.add(slugifyName(r.name))
    }
  } catch {}
  try {
    const talents = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'talents.json'), 'utf-8'))
    for (const t of Object.values(talents) as any[]) {
      if (t.title) talentNames.set(t.title.toLowerCase(), true)
    }
  } catch {}
  try {
    const units = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'units_full.json'), 'utf-8'))
    for (const name of Object.keys(units)) unitSlugs.add(slugifyName(name))
  } catch {}
  try {
    const synergies = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'synergies.json'), 'utf-8'))
    for (const s of Object.values(synergies) as any[]) {
      if (s.name) synergySlugs.add(slugifyName(s.name))
    }
  } catch {}

  return (name: string) => {
    const itemSlug = slugifyName(name)
    if (itemSlugs.has(itemSlug)) return {entity_type: 'item', entity_slug: itemSlug}
    const itemSlugNoApos = slugifyName(name.replace(/'/g, ''))
    if (itemSlugNoApos !== itemSlug && itemSlugs.has(itemSlugNoApos)) return {entity_type: 'item', entity_slug: itemSlugNoApos}

    const relicSlug = slugifyName(name)
    if (relicSlugs.has(relicSlug)) return {entity_type: 'relic', entity_slug: relicSlug}

    const talentName = name.replace(/^\d+[ab]\s*[—-]\s*/i, '')
    if (talentNames.has(talentName.toLowerCase())) return {entity_type: 'talent', entity_slug: 'talents'}

    const bare = name.replace(/\s*-\s+.*$/, '').replace(/\s*\(.*\)$/, '').trim()
    const unitSlug = slugifyName(bare)
    if (unitSlugs.has(unitSlug)) return {entity_type: 'unit', entity_slug: unitSlug}
    const aliased = UNIT_SLUG_ALIASES[unitSlug]
    if (aliased && unitSlugs.has(aliased)) return {entity_type: 'unit', entity_slug: aliased}

    const synergySlug = slugifyName(bare)
    if (synergySlugs.has(synergySlug)) return {entity_type: 'synergy', entity_slug: synergySlug}

    return null
  }
}

async function pullPatchNotes() {
  const rows = await client.fetch<any[]>(
    `*[_type == "patchNote"] | order(date desc){
      "slug": slug.current, date, title, titles, source, flavor, absorbedDates,
      sections[]{heading, entries[]{
        kind, name, detail,
        commentary,
        evidence[]{source, detail, url},
        "entityType": entity->_type,
        "entitySlug": select(
          entity->_type == "unit" => entity->name,
          entity->_type == "synergy" => entity->name,
          entity->_type == "item" => entity->name,
          entity->_type == "relic" => entity->name,
          entity->_type == "talent" => entity->slot
        )
      }}
    }`,
  )
  const resolve = buildEntityResolver()
  // Per-file outputs
  for (const r of rows) {
    const out: Record<string, unknown> = {
      date: r.date,
      title: r.title,
      source: r.source ?? '',
    }
    const titles = localizedNamesToJson(r.titles)
    if (titles) out.titles = titles
    if (r.flavor) out.flavor = r.flavor
    if (Array.isArray(r.absorbedDates) && r.absorbedDates.length) out.absorbedDates = r.absorbedDates
    out.sections = (r.sections || []).map((s: any) => ({
      heading: s.heading,
      entries: (s.entries || []).map((e: any) => {
        const entry: Record<string, unknown> = {
          kind: e.kind,
          name: e.name ?? '',
          detail: e.detail ?? '',
        }
        // Prefer Sanity reference; fall back to name resolution
        if (e.entityType && e.entitySlug) {
          entry.entity_type = e.entityType
          entry.entity_slug = slugifyName(e.entitySlug)
        } else {
          const entity = resolve(entry.name as string)
          if (entity) {
            entry.entity_type = entity.entity_type
            entry.entity_slug = entity.entity_slug
          }
        }
        // Editorial commentary + the evidence it rests on (Sanity-only;
        // the scraper never produces these).
        if (e.commentary) entry.commentary = e.commentary
        const evidence = (e.evidence || [])
          .filter((ev: any) => ev && (ev.source || ev.detail || ev.url))
          .map((ev: any) => {
            const out: Record<string, string> = {source: ev.source ?? 'other'}
            if (ev.detail) out.detail = ev.detail
            if (ev.url) out.url = ev.url
            return out
          })
        if (evidence.length) entry.evidence = evidence
        return entry
      }),
    }))
    writeJson(`patch_notes/${r.slug}.json`, out)
  }
  // Index
  writeJson('patch_notes/index.json', {
    patches: rows.map((r) => ({
      date: r.date,
      title: r.title,
      slug: r.slug,
      titles: localizedNamesToJson(r.titles),
    })),
  })
}

async function main() {
  console.log(`Pulling Sanity (${client.config().projectId}/${client.config().dataset}) → ${DATA_DIR}`)
  if (args.dryRun) console.log('  [DRY RUN — no writes]')
  console.log('')
  if (wants('synergies')) await pullSynergies()
  if (wants('units')) await pullUnits()
  if (wants('items')) await pullItems()
  if (wants('relics')) await pullRelics()
  if (wants('talents')) await pullTalents()
  if (wants('abilities')) await pullAbilities()
  if (wants('gameMode')) await pullGameMode()
  if (wants('patchNotes')) await pullPatchNotes()
  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
