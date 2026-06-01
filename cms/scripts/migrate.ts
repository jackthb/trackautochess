/**
 * One-shot migration: read /data/*.json and create/update Sanity documents.
 *
 * Idempotent — can be re-run safely. Uses createOrReplace via deterministic _id.
 *
 * Usage (from /cms):
 *   pnpm migrate                        # everything except icons
 *   pnpm migrate -- --icons             # also upload icons (slow, ~hundreds of files)
 *   pnpm migrate -- --only=units,items  # only specified types
 *   pnpm migrate -- --dry-run           # log what would happen, don't write
 */
import fs from 'node:fs'
import path from 'node:path'
import {makeClient, DATA_DIR, ICONS_DIR, docId} from './client'
import {unitStem, synIconName, relicStem} from './stems'

type Args = {only: Set<string> | null; icons: boolean; dryRun: boolean}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = {only: null, icons: false, dryRun: false}
  for (const a of argv) {
    if (a === '--icons') args.icons = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a.startsWith('--only=')) args.only = new Set(a.slice('--only='.length).split(','))
  }
  return args
}

function readJson<T = any>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), 'utf-8'))
}

const args = parseArgs()
const client = makeClient()
const wants = (kind: string) => !args.only || args.only.has(kind)

// ──────────────────────────────────────────────────────────────────
// Icon upload (idempotent via assetMetadata.title; cached in-memory)
// ──────────────────────────────────────────────────────────────────
const iconRefCache = new Map<string, string>() // absolute path → asset _ref
async function uploadIcon(absPath: string): Promise<string | null> {
  if (!args.icons) return null
  if (iconRefCache.has(absPath)) return iconRefCache.get(absPath)!
  if (!fs.existsSync(absPath)) {
    console.warn(`  ! missing icon ${absPath}`)
    return null
  }
  if (args.dryRun) {
    console.log(`  [dry] would upload ${path.relative(DATA_DIR, absPath)}`)
    iconRefCache.set(absPath, 'dry-ref')
    return 'dry-ref'
  }
  const file = fs.readFileSync(absPath)
  const asset = await client.assets.upload('image', file, {
    filename: path.basename(absPath),
  })
  iconRefCache.set(absPath, asset._id)
  return asset._id
}

function imageField(assetId: string | null) {
  if (!assetId || assetId === 'dry-ref') return undefined
  return {_type: 'image', asset: {_type: 'reference', _ref: assetId}}
}

// Maps the JSON i18n shape ({en, ru, "zh-cn", ...}) to Sanity's localizedNames
// object shape ({en, ru, zhCn, ...}). Returns undefined when input is empty so
// Sanity doesn't store a noisy empty object.
function localizedNames(names: any): any {
  if (!names || typeof names !== 'object') return undefined
  const out = {
    en: names.en,
    lore: names.lore,
    ko: names.ko,
    ru: names.ru,
    zhCn: names['zh-cn'],
    zhTw: names['zh-tw'],
  }
  return Object.values(out).some((v) => v) ? out : undefined
}

async function commit(docs: any[]) {
  if (args.dryRun) {
    console.log(`  [dry] would write ${docs.length} doc(s)`)
    return
  }
  // Sanity transaction limit is 500 mutations — chunk for safety.
  const CHUNK = 100
  for (let i = 0; i < docs.length; i += CHUNK) {
    const tx = client.transaction()
    for (const d of docs.slice(i, i + CHUNK)) tx.createOrReplace(d)
    await tx.commit({autoGenerateArrayKeys: true})
  }
}

// ──────────────────────────────────────────────────────────────────
// Synergies   (must run first — units reference these)
// ──────────────────────────────────────────────────────────────────
async function migrateSynergies() {
  const raw = readJson<Record<string, any>>('synergies.json')
  const docs: any[] = []
  const nameToId = new Map<string, string>()
  for (const [gameId, s] of Object.entries(raw)) {
    const _id = docId.synergy(gameId)
    nameToId.set(s.name, _id)
    const iconPath = path.join(ICONS_DIR, 'synergies', `${synIconName(s.name)}.png`)
    const assetId = await uploadIcon(iconPath)
    docs.push({
      _id,
      _type: 'synergy',
      gameId,
      name: s.name,
      names: localizedNames(s.names),
      description: s.description ?? '',
      descriptionHtml: s.description_html ?? '',
      lore: s.lore ?? '',
      notes: s.notes ?? [],
      tiers: s.tiers ?? [],
      abilitySpecial: s.ability_special ? JSON.stringify(s.ability_special) : '',
      icon: imageField(assetId),
    })
  }
  await commit(docs)
  console.log(`✓ synergies: ${docs.length}`)
  return nameToId
}

// ──────────────────────────────────────────────────────────────────
// Units (references synergies by display name → looked up in nameToId)
// ──────────────────────────────────────────────────────────────────
async function migrateUnits(synergyNameToId: Map<string, string>) {
  // units_full carries cost/pool/synergies/names too, so it is now both the
  // "simple" source (s) and the stats/abilities source (f === s here).
  const full = readJson<Record<string, any>>('units_full.json')
  const docs: any[] = []
  for (const [name, s] of Object.entries(full)) {
    const f = full[name] || {}
    const _id = docId.unit(name)
    const synergyRefs = (s.synergies || [])
      .map((synName: string) => synergyNameToId.get(synName))
      .filter(Boolean)
      .map((id: string) => ({_type: 'reference', _ref: id}))
    if ((s.synergies || []).length !== synergyRefs.length) {
      console.warn(`  ! ${name}: unresolved synergies → ${s.synergies}`)
    }
    const iconPath = path.join(ICONS_DIR, 'units', `${unitStem(name)}.png`)
    const assetId = await uploadIcon(iconPath)
    const stats = f.stats || {}
    docs.push({
      _id,
      _type: 'unit',
      gameId: f.id ?? '',
      name,
      cost: s.cost ?? f.cost ?? null,
      pool: s.pool ?? f.pool ?? 'standard',
      attackType: f.attack_type ?? null,
      synergies: synergyRefs,
      names: localizedNames(s.names),
      abilities: f.abilities ? JSON.stringify(f.abilities) : '',
      stats: stats
        ? {
            star1: convertStatBlock(stats['1_star']),
            star2: convertStatBlock(stats['2_star']),
            star3: convertStatBlock(stats['3_star']),
          }
        : undefined,
      icon: imageField(assetId),
    })
  }
  await commit(docs)
  console.log(`✓ units: ${docs.length}`)
}

// Items use lowercase + underscore + apostrophe-stripped names by convention
// (e.g. "Aghanim's Shard" → "aghanims_shard.png").
function itemIconStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '')
}

function convertStatBlock(b: any) {
  if (!b) return undefined
  return {
    hp: b.hp,
    mana: b.mana,
    atk: b.atk,
    armor: b.armor,
    magicResist: b.magic_resist,
    atkRate: b.atk_rate,
    atkRange: b.atk_range,
  }
}

// ──────────────────────────────────────────────────────────────────
// Items — items_full is canonical, items.json marks "curated" subset
// ──────────────────────────────────────────────────────────────────
async function migrateItems() {
  const full = readJson<Record<string, any>>('items_full.json')
  const curatedRaw = readJson<{items: Record<string, any>}>('items.json').items
  // Curated items are keyed by *display name*. Build a name → curated entry map.
  const curatedByName = new Map<string, any>()
  for (const [name, entry] of Object.entries(curatedRaw)) curatedByName.set(name, entry)

  const docs: any[] = []
  for (const [gameId, it] of Object.entries(full)) {
    const _id = docId.item(gameId)
    const curated = curatedByName.get(it.name)
    const iconFilename = curated?.icon || `${itemIconStem(it.name)}.png`
    const iconPath = path.join(ICONS_DIR, 'items', iconFilename)
    const assetId = await uploadIcon(iconPath)
    docs.push({
      _id,
      _type: 'item',
      gameId,
      name: it.name,
      names: localizedNames(it.names),
      description: it.description ?? '',
      lore: it.lore ?? '',
      quality: it.quality ?? '',
      texture: it.texture ?? '',
      tier: curated?.tier ?? null,
      inCuratedSet: !!curated,
      iconFile: curated?.icon ?? null,
      notes: it.notes ?? [],
      icon: imageField(assetId),
    })
  }
  await commit(docs)
  console.log(`✓ items: ${docs.length} (${docs.filter((d) => d.inCuratedSet).length} curated)`)
}

// ──────────────────────────────────────────────────────────────────
// Relics
// ──────────────────────────────────────────────────────────────────
async function migrateRelics() {
  const inner = readJson<{relics: Record<string, any>}>('relics.json').relics
  const docs: any[] = []
  for (const [gameId, r] of Object.entries(inner)) {
    const iconPath = path.join(ICONS_DIR, 'relics', `${relicStem(r.name)}.png`)
    const assetId = await uploadIcon(iconPath)
    docs.push({
      _id: docId.relic(gameId),
      _type: 'relic',
      gameId,
      name: r.name,
      names: localizedNames(r.names),
      description: r.description ?? '',
      lore: r.lore ?? '',
      icon: imageField(assetId),
    })
  }
  await commit(docs)
  console.log(`✓ relics: ${docs.length}`)
}

// ──────────────────────────────────────────────────────────────────
// Talents, Abilities
// ──────────────────────────────────────────────────────────────────
async function migrateTalents() {
  const raw = readJson<Record<string, any>>('talents.json')
  const docs: any[] = Object.entries(raw).map(([slot, t]) => ({
    _id: docId.talent(slot),
    _type: 'talent',
    slot,
    title: t.title,
    titles: localizedNames(t.titles ?? t.names),
    description: t.description ?? '',
  }))
  await commit(docs)
  console.log(`✓ talents: ${docs.length}`)
}

async function migrateAbilities() {
  const raw = readJson<Record<string, any>>('abilities.json')
  const docs: any[] = Object.entries(raw).map(([gameId, a]) => ({
    _id: docId.ability(gameId),
    _type: 'ability',
    gameId,
    name: a.name ?? '',
    names: localizedNames(a.names),
    description: a.description ?? '',
    cooldown: a.cooldown ?? '',
    manaCost: a.mana_cost ?? '',
    castRange: a.cast_range ?? '',
    abilitySpecial: a.ability_special ? JSON.stringify(a.ability_special) : '',
  }))
  await commit(docs)
  console.log(`✓ abilities: ${docs.length}`)
}

// ──────────────────────────────────────────────────────────────────
// Game mode (singleton, references relics by gameId)
// ──────────────────────────────────────────────────────────────────
async function migrateGameMode() {
  const raw = readJson<any>('game_mode.json')
  const dropRefs = (raw.drop_relic_list || []).map((gid: string) => ({
    _type: 'reference',
    _ref: docId.relic(gid),
  }))
  const quest2Refs = (raw.quest_2_relic_list || []).map((gid: string) => ({
    _type: 'reference',
    _ref: docId.relic(gid),
  }))
  await commit([
    {
      _id: docId.gameMode(),
      _type: 'gameMode',
      dropRelicList: dropRefs,
      quest2RelicList: quest2Refs,
      prepareTimer: raw.prepare_timer ?? null,
      battleTimer: raw.battle_timer ?? null,
    },
  ])
  console.log('✓ gameMode (singleton)')
}

// ──────────────────────────────────────────────────────────────────
// Patch notes
// ──────────────────────────────────────────────────────────────────
function buildEntityRefMap(): Map<string, string> {
  const map = new Map<string, string>()
  const slug = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  try {
    const units = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'units_full.json'), 'utf-8'))
    for (const name of Object.keys(units)) map.set(`unit:${slug(name)}`, docId.unit(name))
  } catch {}
  try {
    const items = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'items.json'), 'utf-8'))
    const itemsFull = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'items_full.json'), 'utf-8'))
    const nameToGameId = new Map<string, string>()
    for (const [gameId, v] of Object.entries(itemsFull) as [string, any][]) {
      if (v.name) nameToGameId.set(slug(v.name), gameId)
    }
    for (const name of Object.keys(items.items ?? {})) {
      const gameId = nameToGameId.get(slug(name))
      if (gameId) map.set(`item:${slug(name)}`, docId.item(gameId))
    }
  } catch {}
  try {
    const relics = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'relics.json'), 'utf-8'))
    for (const [gameId, v] of Object.entries(relics.relics ?? {}) as [string, any][]) {
      if (v.name) map.set(`relic:${slug(v.name)}`, docId.relic(gameId))
    }
  } catch {}
  try {
    const synergies = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'synergies.json'), 'utf-8'))
    for (const [gameId, v] of Object.entries(synergies) as [string, any][]) {
      if (v.name) map.set(`synergy:${slug(v.name)}`, docId.synergy(gameId))
    }
  } catch {}
  try {
    const talents = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'talents.json'), 'utf-8'))
    for (const slot of Object.keys(talents)) {
      map.set(`talent:${slot}`, docId.talent(slot))
    }
  } catch {}
  return map
}

function slugifyName(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
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

function buildEntityResolver(refMap: Map<string, string>): (name: string) => string | null {
  return (name: string) => {
    const slug = slugifyName(name)
    if (refMap.has(`item:${slug}`)) return `item:${slug}`
    const slugNoApos = slugifyName(name.replace(/'/g, ''))
    if (slugNoApos !== slug && refMap.has(`item:${slugNoApos}`)) return `item:${slugNoApos}`
    if (refMap.has(`relic:${slug}`)) return `relic:${slug}`

    const bare = name.replace(/\s*-\s+.*$/, '').replace(/\s*\(.*\)$/, '').trim()
    const unitSlug = slugifyName(bare)
    if (refMap.has(`unit:${unitSlug}`)) return `unit:${unitSlug}`
    const aliased = UNIT_SLUG_ALIASES[unitSlug]
    if (aliased && refMap.has(`unit:${aliased}`)) return `unit:${aliased}`
    if (refMap.has(`synergy:${unitSlug}`)) return `synergy:${unitSlug}`

    return null
  }
}

async function migratePatchNotes() {
  const dir = path.join(DATA_DIR, 'patch_notes')
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .sort()
  const refMap = buildEntityRefMap()
  const resolve = buildEntityResolver(refMap)
  const docs: any[] = []
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
    const slug = f.replace(/\.json$/, '')
    docs.push({
      _id: docId.patchNote(slug),
      _type: 'patchNote',
      date: j.date,
      title: j.title,
      slug: {_type: 'slug', current: slug},
      source: j.source ?? null,
      flavor: j.flavor ?? null,
      // Only carry the sync flag when the patch JSON declares it, so legacy
      // patches predating the flag stay untouched (treated as already synced).
      ...(typeof j.entitiesSynced === 'boolean' ? {entitiesSynced: j.entitiesSynced} : {}),
      ...(j.entitiesSyncedAt ? {entitiesSyncedAt: j.entitiesSyncedAt} : {}),
      ...(Array.isArray(j.absorbedDates) && j.absorbedDates.length
        ? {absorbedDates: j.absorbedDates}
        : {}),
      sections: (j.sections || []).map((s: any) => ({
        _type: 'patchSection',
        heading: s.heading,
        entries: (s.entries || []).map((e: any) => {
          const entry: any = {
            _type: 'patchEntry',
            kind: e.kind,
            name: e.name ?? '',
            detail: e.detail ?? '',
          }
          let refKey = e.entity_type && e.entity_slug
            ? `${e.entity_type}:${e.entity_slug}`
            : resolve(e.name ?? '')
          if (refKey) {
            const ref = refMap.get(refKey)
            if (ref) entry.entity = {_type: 'reference', _ref: ref}
          }
          return entry
        }),
      })),
    })
  }
  await commit(docs)
  console.log(`✓ patchNotes: ${docs.length}`)
}

// ──────────────────────────────────────────────────────────────────
// Driver
// ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Migrating from ${DATA_DIR} → Sanity (${client.config().projectId}/${client.config().dataset})`)
  if (args.dryRun) console.log('  [DRY RUN — no writes]')
  if (!args.icons) console.log('  (skipping icon upload — pass --icons to include them)')
  console.log('')

  let synergyMap = new Map<string, string>()
  if (wants('synergies')) synergyMap = await migrateSynergies()
  else {
    // Build the lookup from existing JSON anyway, in case units run alone.
    const raw = readJson<Record<string, any>>('synergies.json')
    for (const [gid, s] of Object.entries(raw)) synergyMap.set(s.name, docId.synergy(gid))
  }
  if (wants('units')) await migrateUnits(synergyMap)
  if (wants('items')) await migrateItems()
  if (wants('relics')) await migrateRelics()
  if (wants('talents')) await migrateTalents()
  if (wants('abilities')) await migrateAbilities()
  if (wants('gameMode')) await migrateGameMode()
  if (wants('patchNotes')) await migratePatchNotes()
  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
