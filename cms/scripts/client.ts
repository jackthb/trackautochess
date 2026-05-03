/**
 * Shared Sanity client + helpers used by migrate.ts and pull.ts.
 */
import {createClient, type SanityClient} from '@sanity/client'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import 'dotenv/config'

export const CMS_DIR = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(CMS_DIR, '..', '..')
export const DATA_DIR = path.resolve(REPO_ROOT, 'data')
export const ICONS_DIR = path.resolve(DATA_DIR, 'icons')

export function makeClient(opts: {requireToken?: boolean} = {}): SanityClient {
  const projectId = process.env.SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET || 'production'
  const token = process.env.SANITY_TOKEN

  if (!projectId) {
    throw new Error(
      'SANITY_PROJECT_ID is required. Copy cms/.env.example to cms/.env and fill it in.',
    )
  }
  if (opts.requireToken !== false && !token) {
    throw new Error(
      'SANITY_TOKEN is required for write/migrate operations. Create one at sanity.io/manage.',
    )
  }

  return createClient({
    projectId,
    dataset,
    token,
    apiVersion: '2024-10-01',
    useCdn: false,
  })
}

/** Stable, URL-safe slug from a display name (or any string). */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Deterministic Sanity document IDs so migrate is idempotent. */
export const docId = {
  unit: (name: string) => `unit-${slugify(name)}`,
  synergy: (gameId: string) => `synergy-${gameId.replace(/^is_/, '')}`,
  item: (gameId: string) => `item-${gameId.replace(/^item_/, '')}`,
  relic: (gameId: string) => `relic-${gameId.replace(/^item_/, '')}`,
  talent: (slot: string) => `talent-${slot}`,
  ability: (gameId: string) => `ability-${slugify(gameId)}`,
  gameMode: () => 'gameMode-singleton',
  patchNote: (slug: string) => `patchNote-${slugify(slug)}`,
}
