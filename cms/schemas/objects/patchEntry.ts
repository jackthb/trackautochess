import {defineType, defineField} from 'sanity'

export const patchEntry = defineType({
  name: 'patchEntry',
  title: 'Patch Entry',
  type: 'object',
  fields: [
    defineField({
      name: 'kind',
      type: 'string',
      options: {
        list: [
          {title: 'Added', value: 'added'},
          {title: 'Removed', value: 'removed'},
          {title: 'Buff', value: 'buff'},
          {title: 'Nerf', value: 'nerf'},
          {title: 'Change', value: 'change'},
          {title: 'Rework', value: 'rework'},
          {title: 'Fix', value: 'fix'},
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({name: 'name', type: 'string'}),
    defineField({name: 'detail', type: 'text', rows: 3}),
    defineField({
      name: 'entity',
      title: 'Linked Entity',
      type: 'reference',
      to: [
        {type: 'unit'},
        {type: 'item'},
        {type: 'relic'},
        {type: 'synergy'},
        {type: 'talent'},
      ],
    }),
  ],
  preview: {
    select: {kind: 'kind', name: 'name', detail: 'detail'},
    prepare({kind, name, detail}) {
      return {title: name || '(no name)', subtitle: `${kind || ''}: ${detail || ''}`.slice(0, 80)}
    },
  },
})
