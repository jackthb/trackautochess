import {defineType, defineField} from 'sanity'

export const synergy = defineType({
  name: 'synergy',
  title: 'Synergy',
  type: 'document',
  fields: [
    defineField({
      name: 'gameId',
      title: 'Game ID',
      description: 'Original key from VPK, e.g. is_assassin. Stable across patches.',
      type: 'string',
      validation: (r) => r.required(),
      readOnly: true,
    }),
    defineField({
      name: 'name',
      title: 'Display Name',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'description',
      type: 'text',
      rows: 6,
    }),
    defineField({
      name: 'descriptionHtml',
      title: 'Description (HTML)',
      type: 'text',
      rows: 6,
      description: 'In-game HTML rendition of the description (preserve as-is for tooltip rendering).',
    }),
    defineField({
      name: 'lore',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'notes',
      type: 'array',
      of: [{type: 'text', rows: 2}],
    }),
    defineField({
      name: 'tiers',
      title: 'Active Tiers (counts)',
      type: 'array',
      of: [{type: 'number'}],
    }),
    defineField({
      name: 'abilitySpecial',
      title: 'Ability Special (raw)',
      type: 'text',
      rows: 4,
      description: 'Stringified JSON blob from VPK. Round-trips back to ability_special object.',
    }),
    defineField({
      name: 'icon',
      type: 'image',
      options: {accept: 'image/png,image/webp,image/svg+xml'},
    }),
  ],
  preview: {
    select: {name: 'name', gameId: 'gameId', tiers: 'tiers', media: 'icon'},
    prepare({name, gameId, tiers, media}) {
      const tiersStr = Array.isArray(tiers) && tiers.length ? `(${tiers.join('/')})` : ''
      return {title: name || gameId, subtitle: `${gameId} ${tiersStr}`, media}
    },
  },
})
