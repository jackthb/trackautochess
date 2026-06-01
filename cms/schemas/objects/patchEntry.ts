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
    defineField({
      name: 'commentary',
      title: 'Commentary',
      type: 'text',
      rows: 4,
      description:
        'Your take on this specific change, in plain language. Appears inline ' +
        "under this entry on the patch page, and as one dated, attributed item " +
        "in the linked entity's commentary history (it does not affect other patches).",
    }),
    defineField({
      name: 'evidence',
      title: 'Evidence',
      type: 'array',
      of: [{type: 'patchEvidence'}],
      description: 'What your commentary is based on (VPK values, testing, dev posts).',
    }),
  ],
  preview: {
    select: {kind: 'kind', name: 'name', detail: 'detail', commentary: 'commentary'},
    prepare({kind, name, detail, commentary}) {
      const note = commentary ? ' 💬' : ''
      return {
        title: `${name || '(no name)'}${note}`,
        subtitle: `${kind || ''}: ${detail || ''}`.slice(0, 80),
      }
    },
  },
})
