import {defineType, defineField} from 'sanity'

// A single piece of evidence backing a patch-entry commentary. The official
// patch text is often vague or machine-translated; evidence records *where*
// your interpretation comes from (VPK values, in-game testing, a dev post).
export const patchEvidence = defineType({
  name: 'patchEvidence',
  title: 'Evidence',
  type: 'object',
  fields: [
    defineField({
      name: 'source',
      title: 'Source',
      type: 'string',
      description: 'Where this evidence comes from.',
      options: {
        list: [
          {title: 'VPK / game files', value: 'vpk'},
          {title: 'In-game testing', value: 'testing'},
          {title: 'Dev / official post', value: 'dev'},
          {title: 'Community', value: 'community'},
          {title: 'Other', value: 'other'},
        ],
      },
      initialValue: 'vpk',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'detail',
      title: 'Detail',
      type: 'text',
      rows: 3,
      description: 'What the evidence actually shows — e.g. the raw VPK values or a quote.',
    }),
    defineField({
      name: 'url',
      title: 'Link',
      type: 'url',
      description: 'Optional link to the source (commit, post, thread).',
    }),
  ],
  preview: {
    select: {source: 'source', detail: 'detail'},
    prepare({source, detail}) {
      return {title: source || 'evidence', subtitle: (detail || '').slice(0, 80)}
    },
  },
})
