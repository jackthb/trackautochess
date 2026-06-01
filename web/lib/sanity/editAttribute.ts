import { createDataAttribute } from "@sanity/visual-editing/create-data-attribute";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const baseUrl = process.env.NEXT_PUBLIC_SANITY_STUDIO_URL;

/** A document carrying enough identity to build an edit link. Draft loaders
 *  surface `_id`/`_type`; the published JSON loaders don't, so this is a no-op
 *  outside draft mode. */
export interface EditableDoc {
  _id?: string;
  _type?: string;
}

/**
 * Build a `data-sanity` attribute for click-to-edit on a field whose stega
 * markers were stripped by text processing (descriptions, lore, notes — see
 * parseSynergyDescription/cleanText/etc.). Stega survives on raw fields and
 * powers their overlays automatically; processed fields need this explicit
 * attribute instead.
 *
 * Returns `undefined` when not applicable (published mode, or missing config),
 * and React then omits the attribute — so it's safe to call unconditionally.
 */
export function editAttribute(
  doc: EditableDoc | null | undefined,
  path: string
): string | undefined {
  if (!doc?._id || !doc?._type || !baseUrl || !projectId || !dataset) {
    return undefined;
  }
  return createDataAttribute({
    baseUrl,
    projectId,
    dataset,
    id: doc._id,
    type: doc._type,
    path,
  }).toString();
}
