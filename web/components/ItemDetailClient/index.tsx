"use client";

import { useEffect, useMemo, useState } from "react";
import { EntityDetail, type RelatedEntity } from "@/components/EntityDetail";
import { EntityCommentaryList } from "@/components/PatchCommentary";
import { Markdown } from "@/components/Markdown";
import { parseItemDescription } from "@/lib/itemDescription";
import type { EntityCommentary } from "@/lib/patchCommentaryTypes";
import type { ItemTranslation } from "@/lib/items";
import { cleanText } from "@/lib/text";
import styles from "./ItemDetailClient.module.css";

const STORAGE_KEY = "dac:item-text-locale";

interface ItemDetailClientProps {
  item: {
    slug: string;
    name: string;
    iconUrl: string;
    commentary: string;
    notes: string[];
    translations?: ItemTranslation[];
  };
  tierLabel: string;
  tierColor: string;
  relatedTitle: string;
  related: RelatedEntity[];
  extraRelatedTitle?: string;
  extraRelated?: RelatedEntity[];
  accentColor: string;
  patchCommentary: EntityCommentary[];
}

function pickTranslation(
  translations: ItemTranslation[],
  locale: string,
): ItemTranslation {
  return (
    translations.find((entry) => entry.locale === locale) ??
    translations.find((entry) => entry.locale === "en") ??
    translations[0]
  );
}

export function ItemDetailClient({
  item,
  tierLabel,
  tierColor,
  relatedTitle,
  related,
  extraRelatedTitle,
  extraRelated,
  accentColor,
  patchCommentary,
}: ItemDetailClientProps) {
  const sourceTranslations = item.translations ?? [];
  const translations = sourceTranslations.length
    ? sourceTranslations
    : [
        {
          locale: "en",
          label: "EN",
          name: item.name,
          description: "",
          lore: "",
        },
      ];
  const [locale, setLocale] = useState(translations[0].locale);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && translations.some((entry) => entry.locale === saved)) {
      setLocale(saved);
    }
  }, [translations]);

  const selected = pickTranslation(translations, locale);
  const { active, stats } = useMemo(
    () => parseItemDescription(selected.description),
    [selected.description],
  );

  function selectLocale(nextLocale: string) {
    setLocale(nextLocale);
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
  }

  const bodySections = [
    ...(active ? [{ title: "Active Ability", body: active }] : []),
    ...(stats ? [{ title: "Stats", body: stats }] : []),
  ];

  return (
    <EntityDetail
      variant="item"
      name={selected.name || item.name}
      iconSrc={item.iconUrl}
      bodySections={bodySections}
      commentary={
        item.commentary || patchCommentary.length > 0 ? (
          <>
            {item.commentary ? <Markdown>{item.commentary}</Markdown> : null}
            {patchCommentary.length > 0 ? (
              <EntityCommentaryList entries={patchCommentary} />
            ) : null}
          </>
        ) : undefined
      }
      notes={item.notes.map(cleanText)}
      lore={selected.lore ? cleanText(selected.lore) : undefined}
      tag={{ label: tierLabel, color: tierColor }}
      heroAddon={
        translations.length > 1 ? (
          <div className={styles.switcher} role="group" aria-label="Item language">
            {translations.map((entry) => (
              <button
                key={entry.locale}
                type="button"
                className={`${styles.option} ${
                  entry.locale === selected.locale ? styles.optionActive : ""
                }`}
                aria-pressed={entry.locale === selected.locale}
                onClick={() => selectLocale(entry.locale)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
      relatedTitle={relatedTitle}
      related={related}
      extraRelatedTitle={extraRelatedTitle}
      extraRelated={extraRelated}
      accentColor={accentColor}
    />
  );
}
