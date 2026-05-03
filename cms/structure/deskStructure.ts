import type {StructureBuilder} from 'sanity/structure'

// Singleton list-item helper for Game Mode — only ever one document.
const SINGLETONS = ['gameMode']

export const deskStructure = (S: StructureBuilder) =>
  S.list()
    .title('Game Data')
    .items([
      S.listItem()
        .title('Units')
        .schemaType('unit')
        .child(S.documentTypeList('unit').title('Units')),
      S.listItem()
        .title('Synergies')
        .schemaType('synergy')
        .child(S.documentTypeList('synergy').title('Synergies')),
      S.listItem()
        .title('Items')
        .schemaType('item')
        .child(S.documentTypeList('item').title('Items')),
      S.listItem()
        .title('Relics')
        .schemaType('relic')
        .child(S.documentTypeList('relic').title('Relics')),
      S.listItem()
        .title('Talents')
        .schemaType('talent')
        .child(S.documentTypeList('talent').title('Talents')),
      S.listItem()
        .title('Abilities')
        .schemaType('ability')
        .child(S.documentTypeList('ability').title('Abilities')),
      S.divider(),
      S.listItem()
        .title('Game Mode')
        .child(
          S.editor().id('gameMode-singleton').schemaType('gameMode').documentId('gameMode-singleton'),
        ),
      S.divider(),
      S.listItem()
        .title('Patch Notes')
        .schemaType('patchNote')
        .child(
          S.documentTypeList('patchNote')
            .title('Patch Notes')
            .defaultOrdering([{field: 'date', direction: 'desc'}]),
        ),
      S.divider(),
      ...S.documentTypeListItems().filter(
        (li) => !['unit', 'synergy', 'item', 'relic', 'talent', 'ability', 'gameMode', 'patchNote'].includes(li.getId() || ''),
      ),
    ])
