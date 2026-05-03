import {defineType, defineField} from 'sanity'

export const gameMode = defineType({
  name: 'gameMode',
  title: 'Game Mode',
  type: 'document',
  // Singleton — enforced via desk structure (only one document of this type).
  fields: [
    defineField({
      name: 'dropRelicList',
      title: 'Drop Relic List',
      description: 'Game IDs of relics in the active drop pool.',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'relic'}]}],
      validation: (r) => r.unique(),
    }),
    defineField({
      name: 'quest2RelicList',
      title: 'Quest 2 Relic List',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'relic'}]}],
      validation: (r) => r.unique(),
    }),
    defineField({name: 'prepareTimer', title: 'Prepare Timer (s)', type: 'number'}),
    defineField({name: 'battleTimer', title: 'Battle Timer (s)', type: 'number'}),
  ],
  preview: {
    select: {prep: 'prepareTimer', battle: 'battleTimer'},
    prepare({prep, battle}) {
      return {title: 'Game Mode (singleton)', subtitle: `prep ${prep}s · battle ${battle}s`}
    },
  },
})
