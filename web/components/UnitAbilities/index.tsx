import type { UnitAbility } from "@/lib/units";
import styles from "./UnitAbilities.module.css";

function present(value: string): boolean {
  return value.trim().length > 0;
}

function abilityFacts(ability: UnitAbility) {
  return [
    ["Cooldown", ability.cooldown],
    ["Mana", ability.manaCost],
    ["Range", ability.castRange],
  ].filter(([, value]) => present(value));
}

export function UnitAbilities({ abilities }: { abilities: UnitAbility[] }) {
  return (
    <div className={styles.list}>
      {abilities.map((ability) => {
        const facts = abilityFacts(ability);

        return (
          <section key={ability.id} className={styles.ability}>
            <div className={styles.header}>
              <h3 className={styles.name}>{ability.name}</h3>
              {facts.length > 0 && (
                <dl className={styles.facts}>
                  {facts.map(([label, value]) => (
                    <div key={label} className={styles.fact}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            {ability.description && (
              <p className={styles.description}>{ability.description}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
