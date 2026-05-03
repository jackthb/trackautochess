import {defineType, defineField} from 'sanity'

export const ability = defineType({
  name: 'ability',
  title: 'Ability',
  type: 'document',
  fields: [
    defineField({
      name: 'gameId',
      title: 'Game ID',
      description: 'In-game ability id (key in abilities.json).',
      type: 'string',
      validation: (r) => r.required(),
      readOnly: true,
    }),
    defineField({name: 'name', type: 'string'}),
    defineField({name: 'description', type: 'text', rows: 4}),
    defineField({name: 'cooldown', type: 'string'}),
    defineField({name: 'manaCost', type: 'string'}),
    defineField({name: 'castRange', type: 'string'}),
    defineField({
      name: 'abilitySpecial',
      title: 'Ability Special (raw)',
      type: 'text',
      rows: 4,
      description: 'Stringified JSON blob from VPK.',
    }),
  ],
  preview: {
    select: {name: 'name', gameId: 'gameId'},
    prepare({name, gameId}) {
      return {title: name || gameId, subtitle: gameId}
    },
  },
})
