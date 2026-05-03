import {defineLocations, type PresentationPluginOptions} from 'sanity/presentation'

// Mirror of web/lib/slugs.ts so the Studio can resolve preview URLs without a
// shared package. Keep these two implementations in sync.
function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const fallback = 'Untitled'

export const locations: PresentationPluginOptions['resolve'] = {
  locations: {
    unit: defineLocations({
      select: {name: 'name'},
      resolve: (doc) => ({
        locations: [
          {title: doc?.name || fallback, href: `/units/${slugifyName(doc?.name || '')}`},
          {title: 'Units', href: '/units'},
        ],
      }),
    }),
    item: defineLocations({
      select: {name: 'name'},
      resolve: (doc) => ({
        locations: [
          {title: doc?.name || fallback, href: `/items/${slugifyName(doc?.name || '')}`},
          {title: 'Items', href: '/items'},
        ],
      }),
    }),
    synergy: defineLocations({
      select: {name: 'name'},
      resolve: (doc) => ({
        locations: [
          {title: doc?.name || fallback, href: `/synergies/${slugifyName(doc?.name || '')}`},
          {title: 'Synergies', href: '/synergies'},
          {title: 'Classes', href: '/classes'},
          {title: 'Species', href: '/species'},
        ],
      }),
    }),
    relic: defineLocations({
      select: {name: 'name'},
      resolve: (doc) => ({
        locations: [
          {title: doc?.name || fallback, href: `/relics/${slugifyName(doc?.name || '')}`},
          {title: 'Relics', href: '/relics'},
        ],
      }),
    }),
    talent: defineLocations({
      select: {title: 'title', slot: 'slot'},
      resolve: (doc) => ({
        locations: [{title: 'Talents', href: '/talents'}],
      }),
    }),
    patchNote: defineLocations({
      select: {title: 'title', slug: 'slug.current'},
      resolve: (doc) => ({
        locations: [
          {title: doc?.title || fallback, href: `/patch-notes/${doc?.slug || ''}`},
          {title: 'Patch Notes', href: '/patch-notes'},
        ],
      }),
    }),
  },
}
