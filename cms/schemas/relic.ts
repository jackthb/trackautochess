import {defineType, defineField} from 'sanity'

export const relic = defineType({
  name: 'relic',
  title: 'Relic',
  type: 'document',
  fields: [
    defineField({
      name: 'gameId',
      title: 'Game ID',
      description: 'In-game relic id, e.g. item_upgrade_lootbox.',
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
    defineField({name: 'description', type: 'text', rows: 4}),
    defineField({name: 'lore', type: 'text', rows: 3}),
    defineField({
      name: 'icon',
      type: 'image',
      options: {accept: 'image/png,image/webp'},
    }),
  ],
  preview: {
    select: {name: 'name', gameId: 'gameId', media: 'icon'},
    prepare({name, gameId, media}) {
      return {title: name, subtitle: gameId, media}
    },
  },
})
