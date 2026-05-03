import {defineType, defineField} from 'sanity'

export const localizedNames = defineType({
  name: 'localizedNames',
  title: 'Localized Names',
  type: 'object',
  fields: [
    defineField({name: 'en', title: 'English', type: 'string'}),
    defineField({name: 'lore', title: 'Lore name', type: 'string'}),
    defineField({name: 'ko', title: 'Korean', type: 'string'}),
    defineField({name: 'ru', title: 'Russian', type: 'string'}),
    defineField({name: 'zhCn', title: 'Chinese (Simplified)', type: 'string'}),
    defineField({name: 'zhTw', title: 'Chinese (Traditional)', type: 'string'}),
  ],
})
