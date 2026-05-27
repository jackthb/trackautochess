// GROQ projections matching the /data/*.json shapes that the static loaders
// already consume, so draft-mode reads can drop into the same DisplayX types.
const ICON_PROJECTION = `"icon_url": icon.asset->url,
  "icon_dimensions": icon.asset->metadata.dimensions{width, height}`;

export const ALL_UNITS_QUERY = `
  *[_type == "unit"] | order(name asc) {
    name,
    cost,
    pool,
    "synergies": synergies[]->name,
    ${ICON_PROJECTION}
  }
`;

export const ALL_SYNERGIES_QUERY = `
  *[_type == "synergy"] | order(gameId asc) {
    gameId,
    name,
    description,
    lore,
    ${ICON_PROJECTION}
  }
`;

export const ALL_ITEMS_QUERY = `
  *[_type == "item"] | order(gameId asc) {
    gameId,
    name,
    description,
    lore,
    quality,
    texture,
    tier,
    inCuratedSet,
    iconFile,
    notes,
    ${ICON_PROJECTION}
  }
`;

export const ALL_RELICS_QUERY = `
  *[_type == "relic"] | order(gameId asc) {
    gameId,
    name,
    description,
    lore,
    ${ICON_PROJECTION}
  }
`;

export const PATCH_NOTE_QUERY = `
  *[_type == "patchNote" && slug.current == $slug][0]{
    "slug": slug.current,
    date,
    title,
    source,
    flavor,
    sections[]{
      heading,
      entries[]{
        kind,
        name,
        detail,
        "entityType": entity->_type,
        "entitySlug": select(
          entity->_type == "unit" => entity->name,
          entity->_type == "synergy" => entity->name,
          entity->_type == "item" => entity->name,
          entity->_type == "relic" => entity->name,
          entity->_type == "talent" => entity->slot
        )
      }
    }
  }
`;

export const ALL_PATCH_NOTES_QUERY = `
  *[_type == "patchNote"] | order(date desc) {
    "slug": slug.current,
    date,
    title,
    titles
  }
`;
