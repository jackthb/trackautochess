# Item Pool Investigation Reminder

Look for where the DAC VPK defines the **actual obtainable item pool** — not just every item definition.

## Goal

Find the source of truth for items players can genuinely pick up/get in-game, then use that to keep the website/CMS item list accurate.

## Places/patterns to investigate in the VPK

- Loot/drop tables
- Item tier pools
- Shop/reward/discover pools
- Creep round item rewards
- Synergy-generated item rewards, especially Mech / Heart of the Machine style logic
- Random item roll functions
- Any arrays/maps of item IDs used by gameplay scripts rather than localization/item definition files

## Current manual fallback

Until the real source is found, manually maintain the CMS item list as the set of items that should exist as obtainable items.

## Related entities note

This should not be item-to-synergy-specific. The CMS needs a generic **related entities** field so any game entity can link to any other relevant entity.

Examples:

- Aqir can link to Spider Leg.
- Dragon can link to Minotaur Horn.
- Items can link to synergies when they grant/count as one.
- Units, synergies, items, or talents can link to relics when a relic directly affects or creates them.

A future schema could look like this:

```json
{
  "relatedEntities": [
    {
      "type": "item",
      "item": "spider-leg",
      "label": "Generated item"
    },
    {
      "type": "relic",
      "relic": "example-relic",
      "label": "Related relic"
    }
  ]
}
```

Use the same entity picker shape as patch-note linked entities where possible: choose a type, then pick from units/items/synergies/relics/talents.
