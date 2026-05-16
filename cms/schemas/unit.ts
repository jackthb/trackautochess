import {defineType, defineField} from 'sanity'

export const unit = defineType({
  name: 'unit',
  title: 'Unit',
  type: 'document',
  fields: [
    defineField({
      name: 'gameId',
      title: 'Game ID',
      description: 'In-game piece id, e.g. chess_aa.',
      type: 'string',
      readOnly: true,
    }),
    defineField({
      name: 'name',
      title: 'Display Name (English, canonical key)',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'cost',
      type: 'number',
      validation: (r) => r.min(1).max(5),
    }),
    defineField({
      name: 'pool',
      type: 'string',
      options: {
        list: ['standard', 'undead', 'lord', 'special'],
      },
    }),
    defineField({
      name: 'attackType',
      type: 'string',
      options: {
        list: ['melee', 'ranged'],
      },
    }),
    defineField({
      name: 'synergies',
      title: 'Synergies (references)',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'synergy'}]}],
      validation: (r) => r.unique(),
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
      name: 'abilities',
      title: 'Abilities (raw, JSON)',
      description:
        'JSON-encoded list of {id,name,description} pulled from the VPK, or empty when the unit has no special ability. Round-trips back to the abilities[] array in units_full.json.',
      type: 'text',
      rows: 6,
    }),
    defineField({
      name: 'stats',
      title: 'Stats per star',
      type: 'object',
      fields: [
        defineField({name: 'star1', title: '★', type: 'unitStats'}),
        defineField({name: 'star2', title: '★★', type: 'unitStats'}),
        defineField({name: 'star3', title: '★★★', type: 'unitStats'}),
      ],
    }),
    defineField({
      name: 'icon',
      type: 'image',
      options: {accept: 'image/png,image/webp'},
    }),
  ],
  preview: {
    select: {name: 'name', cost: 'cost', pool: 'pool', media: 'icon'},
    prepare({name, cost, pool, media}) {
      const poolStr = pool && pool !== 'standard' ? ` [${pool}]` : ''
      return {title: name || '(no name)', subtitle: `★${cost ?? '?'}${poolStr}`, media}
    },
  },
})
