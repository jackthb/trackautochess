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

function iconFields(r: any): {icon_url: string | null; icon_dimensions: {width: number; height: number} | null} {
  return {
    icon_url: r.icon_url ?? null,
    icon_dimensions: r.icon_dimensions ?? null,
  }
}

async function pullSynergies() {
  // Query in stable order so files diff cleanly.
  const rows = await client.fetch<any[]>(
    `*[_type == "synergy"] | order(gameId asc){
      gameId, name, description, descriptionHtml, lore, notes, tiers, abilitySpecial,
      ${ICON_PROJECTION}
    }`,
  )
  const i18n = readExistingI18n('synergies.json')
  const out: Record<string, any> = {}
  for (const r of rows) {
    out[r.gameId] = applyI18n(
      {
        name: r.name,
        description: r.description ?? '',
        description_html: r.descriptionHtml ?? '',
        lore: r.lore ?? '',
        notes: r.notes ?? [],
        tiers: r.tiers ?? [],
        ability_special: r.abilitySpecial ? JSON.parse(r.abilitySpecial) : {},
        ...iconFields(r),
      },
      i18n.get(r.gameId),
    )
  }
  writeJson('synergies.json', out)
}

async function pullUnits() {
  const rows = await client.fetch<any[]>(
    `*[_type == "unit"] | order(name asc){
      name, gameId, cost, pool, attackType, names, abilities, stats,
      "synergies": synergies[]->name,
      ${ICON_PROJECTION}
    }`,
  )
  const simple: Record<string, any> = {}
  const full: Record<string, any> = {}
  for (const r of rows) {
    const localizedNames = r.names
      ? {
          en: r.names.en,
          lore: r.names.lore,
          ko: r.names.ko,
          ru: r.names.ru,
          'zh-cn': r.names.zhCn,
          'zh-tw': r.names.zhTw,
        }
      : undefined
    const icon = iconFields(r)
    simple[r.name] = {
      cost: r.cost,
      pool: r.pool,
      synergies: r.synergies ?? [],
      names: localizedNames,
      ...icon,
    }
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
      ...icon,
    }
  }
  // Preserve top-level `aliases` from the existing units.json. Aliases are a
  // VPK-pipeline artifact (data/extract_vpk.py) — they're not editorial and
  // Sanity has no concept of them. Re-apply the same filter extract_vpk uses:
  // keep an alias only when its canonical target exists and the alias name
  // doesn't collide with a real unit.
  const existingAliases = readExistingAliases()
  const aliases: Record<string, string> = {}
  for (const [alias, canonical] of Object.entries(existingAliases)) {
    if (simple[canonical] && !simple[alias]) aliases[alias] = canonical
  }
  const unitsOut: {units: Record<string, any>; aliases?: Record<string, string>} = {units: simple}
  if (Object.keys(aliases).length > 0) unitsOut.aliases = aliases
  writeJson('units.json', unitsOut)
  writeJson('units_full.json', full)
}

function readExistingAliases(): Record<string, string> {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'units.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed?.aliases ?? {}
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
      ${ICON_PROJECTION}
    }`,
  )
  const i18n = readExistingI18n('items_full.json')
  const full: Record<string, any> = {}
  const curated: Record<string, any> = {}
  for (const r of rows) {
    const icon = iconFields(r)
    full[r.gameId] = applyI18n(
      {
        name: r.name,
        description: r.description ?? '',
        lore: r.lore ?? '',
        quality: r.quality ?? '',
        texture: r.texture ?? '',
        notes: r.notes ?? [],
        ...icon,
      },
      i18n.get(r.gameId),
    )
    if (r.inCuratedSet) {
      curated[r.name] = {
        tier: r.tier,
        icon: r.iconFile ?? '',
        ...icon,
      }
    }
  }
  writeJson('items_full.json', full)
  writeJson('items.json', {items: curated, total: Object.keys(curated).length})
}

async function pullRelics() {
  const rows = await client.fetch<any[]>(
    `*[_type == "relic"] | order(gameId asc){
      gameId, name, description, lore,
      ${ICON_PROJECTION}
    }`,
  )
  const i18n = readExistingI18n('relics.json', 'relics')
  const inner: Record<string, any> = {}
  for (const r of rows) {
    inner[r.gameId] = applyI18n(
      {
        name: r.name,
        description: r.description ?? '',
        lore: r.lore ?? '',
        ...iconFields(r),
      },
      i18n.get(r.gameId),
    )
  }
  writeJson('relics.json', {relics: inner})
}

async function pullTalents() {
  const rows = await client.fetch<any[]>(
    `*[_type == "talent"] | order(slot asc){slot, title, description}`,
  )
  const out: Record<string, any> = {}
  for (const r of rows) out[r.slot] = {title: r.title, description: r.description ?? ''}
  writeJson('talents.json', out)
}

async function pullAbilities() {
  const rows = await client.fetch<any[]>(
    `*[_type == "ability"] | order(gameId asc){
      gameId, name, description, cooldown, manaCost, castRange, abilitySpecial
    }`,
  )
  const out: Record<string, any> = {}
  for (const r of rows) {
    out[r.gameId] = {
      name: r.name ?? '',
      description: r.description ?? '',
      cooldown: r.cooldown ?? '',
      mana_cost: r.manaCost ?? '',
      cast_range: r.castRange ?? '',
      ability_special: r.abilitySpecial ? JSON.parse(r.abilitySpecial) : {},
    }
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

async function pullPatchNotes() {
  const rows = await client.fetch<any[]>(
    `*[_type == "patchNote"] | order(date desc){
      "slug": slug.current, date, title, source, flavor, sections
    }`,
  )
  // Per-file outputs
  for (const r of rows) {
    const out: Record<string, unknown> = {
      date: r.date,
      title: r.title,
      source: r.source ?? '',
    }
    if (r.flavor) out.flavor = r.flavor
    out.sections = (r.sections || []).map((s: any) => ({
      heading: s.heading,
      entries: (s.entries || []).map((e: any) => ({
        kind: e.kind,
        name: e.name ?? '',
        detail: e.detail ?? '',
      })),
    }))
    writeJson(`patch_notes/${r.slug}.json`, out)
  }
  // Index
  writeJson('patch_notes/index.json', {
    patches: rows.map((r) => ({date: r.date, title: r.title, slug: r.slug})),
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
