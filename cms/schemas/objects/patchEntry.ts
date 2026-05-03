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
          {title: 'Buff', value: 'buff'},
          {title: 'Nerf', value: 'nerf'},
          {title: 'Change', value: 'change'},
          {title: 'New', value: 'new'},
          {title: 'Removed', value: 'removed'},
          {title: 'Note', value: 'note'},
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({name: 'name', type: 'string'}),
    defineField({name: 'detail', type: 'text', rows: 3}),
  ],
  preview: {
    select: {kind: 'kind', name: 'name', detail: 'detail'},
    prepare({kind, name, detail}) {
      return {title: name || '(no name)', subtitle: `${kind || ''}: ${detail || ''}`.slice(0, 80)}
    },
  },
})
