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

## VPK timing/state-dependent rewards investigation

Extracted from the Steam Workshop VPK VScripts on 2026-06-09 using `scripts/extract_vscripts.py`. The extracted Lua is intentionally gitignored; findings below summarize behavior from `data/vscripts/scripts/vscripts/addon_game_mode.lua`.

### Mango Tree / Enchanted Mango

- **Enchanted Mango** (`item_mangguo`, `ItemMangguo`) grants a random amount of both courier gold and courier XP from **1 to current courier level**.
  - Value is based on level at **use time**, not drop time.
  - Practical timing: holding mangoes until courier level 9-10+ increases expected value; use earlier only for tempo, stabilization, or an important level/shop timing.
- **Mango Tree** (`item_mangotree`, `DropMangoAndUpdateLastBattle`) drops an Enchanted Mango when the current home battle result differs from the previous home battle result.
  - Results are tracked distinctly as win, loss, and draw.
  - First battle after selecting the relic only seeds the previous-result state.
  - Repeating the same result gives no mango.
  - Each qualifying drop decrements tree HP/relic charges.
- The tree starts with 8 HP/charges.
  - On the 8th qualifying result change, it drops the final Enchanted Mango, then breaks.
  - The script comment notes Golden Mango generation was moved away from the break path.
- On relic removal/expiration (`RemoveRelic`), if the Mango Tree still exists and has HP > 0, it drops `item_pingguo`, which corresponds to the Golden Mango protection effect.
  - Golden Mango prevents fatal courier damage for that round by setting incoming player damage to 0 and spending a charge.
  - The round is still counted as a loss.
- I did not see a separate forced Mango Tree expiration reward on match end. The Golden Mango reward is tied to relic removal/expiration/replacement, so if the game ends before that path runs, there may be no meaningful expiration payout.

### Other item/relic rewards where timing matters

| Thing | Timing/state dependency | Practical implication |
| --- | --- | --- |
| **Human 6 reward** | Queued XP item grants roughly `courier level - 2` XP. | Higher courier level makes the payout better. |
| **Mech 6 reward** | Gold version chance scales with courier level: roughly `(level - 5) * 25%`. | Stronger at higher courier levels. |
| **Leafy Essence** (`item_both_leaves`) | Talent tiers depend on current round/talent unlock tier. | Later use can immediately unlock more talent value. |
| **Magic Seed** (`item_bench_contract`) | Sprout growth chance is `_G.battle_round * 2 + 20%` each prepare while active. | Later rounds are better; holding sprouts longer can increase sell value, but uses bench space. |
| **Doubloon** (`item_double_coin`) | Converts 20% of the higher of current HP/gold into the lower resource. | Best when HP/gold gap is large; weak/wasted if values are equal. |
| **The Great Vault / More Interest** (`item_more_interest`) | Interest continues above 40 gold while active. | Banking above 40 gold matters more than normal. |
| **Greevil Egg** (`item_egg`) | Egg grows each prepare with 50% chance up to 9, consuming matching chess pool pieces. | Wait for 3 or 9 count breakpoints before hatching when possible. |
| **Magic Box** (`item_magic_box`) | Boxed chess transforms at next prepare; cost/star are preserved. | Use before round transition; outcome depends on the stored unit. |
| **Weaponsmith** (`item_upgrade_lootbox`) | Has 2 upgrade charges during its relic window. | Spend upgrades on higher-value item rerolls before expiry. |
| **Chiaroscuro Certainty** (`item_streak_plus`) | Banks streak state and pays lootbox tier on removal/expiry based on highest streak and relic history count. | Better during or near a big win/loss streak. |
| **Second Chance** (`item_second_chance`) | Affects shop/loot choices while active. | Open/use relevant loot boxes during its TTL. |
| **Gaoler's Master Key** (`item_free_ban`) | Can refund an existing paid ban and makes future bans free while active. | Best after paying a ban or immediately before an expensive ban. |
| **Time-Space Replica** (`item_repeat_relic`) | Repeats prior relic from relic history. | Value is entirely history-dependent. |
| **Malefic Rapture** (`item_malefic_rapture`) | Grants courier XP equal to final incoming player damage. | Reward depends on actual post-modifier damage taken; no benefit on 0 damage. |
| **Defiant Shell** (`item_rank_damage`) | Player damage adjustment depends on current rank/placement. | Can alter both survival math and Malefic Rapture XP. |
| **March of the Beasts** (`item_more_creep`) | Only affects PVE/neutral wave loading. | Value/risk depends on the current neutral wave. |

### Synergy/talent/quest timing notes

| System | Timing/state dependency | Practical implication |
| --- | --- | --- |
| **Base economy** | Income snapshots current gold, streak, and interest at prepare start. | Spending before income can cost interest. |
| **Win/Lose streaks** | Streak bonus: 2-4 = +1, 5-9 = +2, 10+ = +3. | Streak preservation/break timing changes economy. |
| **Pandaman fishing** | Depends on current Panda count, Wizard virtual count, lucky item count, and pity/history. | Board state before prepare changes odds. |
| **Shaman evolve** | Evolve target is capped by courier level. | Higher courier level improves possible evolved unit. |
| **Demon** | Buff stacks depend on friendly demons and enemy Demon Hunters. | Opponent board can change effective synergy value. |
| **Kobold** | Pairing logic depends on exact duplicate/star distribution on board. | Board composition and star levels matter. |
| **6 Orc** | HP bonus scales with missing courier HP. | Stronger when courier HP is low. |
| **Priest** | Mind-control is limited by population gap; 2 Priest reward needs nonlethal damage. | Full boards and lethal/nonlethal damage state matter. |
| **Talent 2a discount** | Shop discount depends on already owning a level-one copy of the chess. | Roll/buy/combine order can affect prices. |
| **Talent 2b promotion** | Shop odds can use courier level +1. | More valuable as courier level rises. |
| **Talent 4a IO** | Uses pity/history state. | Misses improve odds; hits reduce/reset value. |
| **Talent 4b level cap** | Raises courier level cap to 16. | Makes late-scaling rewards like mangoes better. |

### Current practical guidance

- Treat Enchanted Mango as a level-scaling consumable. Best normal use window is **courier level 9-10+**, or later if reaching 12-16 is realistic.
- Treat Mango Tree as a choice between:
  - maximizing Enchanted Mango drops by alternating battle results, or
  - preserving tree HP so it can drop Golden Mango on relic expiration/removal.
- For website/CMS commentary, explicitly distinguish **drop conditions** from **use-time scaling**, since Mango's reward amount is not fixed when it drops.

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
