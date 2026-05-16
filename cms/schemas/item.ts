import {defineType, defineField} from 'sanity'

export const item = defineType({
  name: 'item',
  title: 'Item',
  type: 'document',
  fields: [
    defineField({
      name: 'gameId',
      title: 'Game ID',
      description: 'In-game item id, e.g. item_bkb. Stable across patches.',
      type: 'string',
      validation: (r) => r.required(),
      readOnly: true,
    }),
    defineField({
      name: 'name',
      title: 'Display Name (English, canonical key)',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'names',
      title: 'Localized names (from VPK)',
      description:
        'Auto-populated from the VPK on each patch. Edit `nameOverrides` to override per-locale.',
      type: 'localizedNames',
    }),
    defineField({
      name: 'nameOverrides',
      title: 'Localized name overrides',
      description:
        'Optional per-locale overrides. When set, the site renders this in place of the VPK value for that locale. VPK pushes never touch this field.',
      type: 'localizedNames',
    }),
    defineField({
      name: 'description',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'lore',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'quality',
      type: 'string',
      options: {
        list: ['common', 'rare', 'epic', 'legendary', 'consumable', 'artifact', ''],
      },
    }),
    defineField({
      name: 'texture',
      title: 'Texture path',
      description: 'In-game texture id (used to look up icon when extracting).',
      type: 'string',
    }),
    defineField({
      name: 'tier',
      type: 'number',
      description: 'Curated tier from items.json. Optional — only set if listed in items.json.',
      validation: (r) => r.min(1).max(5),
    }),
    defineField({
      name: 'inCuratedSet',
      title: 'Show in items.json (curated set)',
      type: 'boolean',
      description: 'When true, this item is included in the simplified items.json that the app uses.',
      initialValue: false,
    }),
    defineField({
      name: 'iconFile',
      title: 'Icon filename',
      description: 'Filename in data/icons/items/ (e.g. bkb.png). Used by the simplified items.json.',
      type: 'string',
    }),
    defineField({
      name: 'notes',
      type: 'array',
      of: [{type: 'text', rows: 2}],
    }),
    defineField({
      name: 'icon',
      type: 'image',
      options: {accept: 'image/png,image/webp'},
    }),
  ],
  preview: {
    select: {
      name: 'name',
      gameId: 'gameId',
      quality: 'quality',
      tier: 'tier',
      curated: 'inCuratedSet',
      media: 'icon',
    },
    prepare({name, gameId, quality, tier, curated, media}) {
      const tags = [
        curated ? `T${tier ?? '?'}` : null,
        quality || null,
      ]
        .filter(Boolean)
        .join(' · ')
      return {title: name || gameId, subtitle: `${gameId} — ${tags}`, media}
    },
  },
})
