import {defineType, defineField} from 'sanity'

export const unitStats = defineType({
  name: 'unitStats',
  title: 'Unit Stats',
  type: 'object',
  fields: [
    defineField({name: 'hp', type: 'number'}),
    defineField({name: 'mana', type: 'number'}),
    defineField({
      name: 'atk',
      title: 'Attack [min, max]',
      type: 'array',
      of: [{type: 'number'}],
      validation: (r) => r.length(2).warning('Attack should be a [min, max] pair'),
    }),
    defineField({name: 'armor', type: 'number'}),
    defineField({name: 'magicResist', type: 'number'}),
    defineField({name: 'atkRate', type: 'number'}),
    defineField({name: 'atkRange', type: 'number'}),
  ],
})
