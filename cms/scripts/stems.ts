/**
 * Mirrors the stem helpers in shared/game-utils.ts so the migrate script can
 * resolve local icon filenames (data/icons/{units,synergies,relics}/*.png)
 * from canonical display names.
 *
 * The cms/ workspace doesn't depend on @dac/shared so we duplicate the small
 * surface here. Keep in sync with shared/game-utils.ts.
 */

const UNIT_STEM_MAP: Record<string, string> = {
  'Blood Seeker': 'bloodseeker',
  Spectres: 'spectre',
  DarkSeer: 'dark_seer',
}

export function unitStem(name: string): string {
  if (UNIT_STEM_MAP[name]) return UNIT_STEM_MAP[name]
  return name
    .toLowerCase()
    .replace(/ /g, '_')
    .replace(/-/g, '_')
    .replace(/'/g, '')
}

export function relicStem(name: string): string {
  return name.toLowerCase().replace(/ /g, '_').replace(/-/g, '_')
}

const SYN_ICON_MAP: Record<string, string> = {
  'Demon Hunter': 'demonhunter',
  Elemental: 'element',
  Faceless: 'nraqi',
  Pandaren: 'pandaman',
}

export function synIconName(name: string): string {
  if (SYN_ICON_MAP[name]) return SYN_ICON_MAP[name]
  return name.toLowerCase().replace(/ /g, '')
}
