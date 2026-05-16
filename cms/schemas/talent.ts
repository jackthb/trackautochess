import {defineType, defineField} from 'sanity'

export const talent = defineType({
  name: 'talent',
  title: 'Talent',
  type: 'document',
  fields: [
    defineField({
      name: 'slot',
      title: 'Slot',
      description: 'Slot identifier like 1a, 2b, etc.',
      type: 'string',
      validation: (r) => r.required().regex(/^[1-4][ab]$/),
      readOnly: true,
    }),
    defineField({
      name: 'title',
      title: 'Display Title (English, canonical key)',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'titles',
      title: 'Localized titles (from VPK)',
      description:
        'Auto-populated from the VPK on each patch. Edit `titleOverrides` to override per-locale.',
      type: 'localizedNames',
    }),
    defineField({
      name: 'titleOverrides',
      title: 'Localized title overrides',
      description:
        'Optional per-locale overrides. When set, the site renders this in place of the VPK value for that locale. VPK pushes never touch this field.',
      type: 'localizedNames',
    }),
    defineField({name: 'description', type: 'text', rows: 3}),
  ],
  preview: {
    select: {title: 'title', slot: 'slot', desc: 'description'},
    prepare({title, slot, desc}) {
      return {title: `${slot}: ${title}`, subtitle: desc}
    },
  },
})
