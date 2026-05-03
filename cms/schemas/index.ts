import {unit} from './unit'
import {synergy} from './synergy'
import {item} from './item'
import {relic} from './relic'
import {talent} from './talent'
import {ability} from './ability'
import {gameMode} from './gameMode'
import {patchNote} from './patchNote'
import {unitStats} from './objects/unitStats'
import {localizedNames} from './objects/localizedNames'
import {patchSection} from './objects/patchSection'
import {patchEntry} from './objects/patchEntry'

export const schemaTypes = [
  // documents
  unit,
  synergy,
  item,
  relic,
  talent,
  ability,
  gameMode,
  patchNote,
  // shared objects
  unitStats,
  localizedNames,
  patchSection,
  patchEntry,
]
