#!/usr/bin/env python3
"""Push the contents of /data/*.json to the Sanity CMS.

Mirrors cms/scripts/migrate.ts (TypeScript) but in Python so the VPK
extraction pipeline can push directly without spawning Node.

Reads env (or .env in repo root):
  SANITY_PROJECT_ID
  SANITY_DATASET   (default: production)
  SANITY_TOKEN     (write-scoped)

Usage as a script:
  python data/cms_push.py                      # push everything (no icons)
  python data/cms_push.py --only synergies units
  python data/cms_push.py --dry-run

Usage as a module:
  from cms_push import push_all
  push_all(data_dir=Path('/path/to/data'))

Icon upload is not implemented in Python — use the Node migrate script with
`pnpm migrate -- --icons` when icons need refreshing. The VPK pipeline only
pushes structured data; icons rarely change between patches.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


# ── env loading (lightweight; avoids forcing a python-dotenv dep) ────────
def _load_dotenv(root: Path) -> None:
    """Load .env from a few likely locations, without overwriting real env."""
    for candidate in [root / '.env', root / 'cms' / '.env']:
        if not candidate.exists():
            continue
        for line in candidate.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)


# ── slugify / id helpers (must match cms/scripts/client.ts) ──────────────
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(s: str) -> str:
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("'", '').replace('’', '')
    s = _SLUG_STRIP.sub('-', s).strip('-')
    return s


def doc_id(kind: str, key: str) -> str:
    if kind == 'unit':
        return f'unit-{slugify(key)}'
    if kind == 'synergy':
        return f'synergy-{key.removeprefix("is_")}'
    if kind == 'item':
        return f'item-{key.removeprefix("item_")}'
    if kind == 'relic':
        return f'relic-{key.removeprefix("item_")}'
    if kind == 'talent':
        return f'talent-{key}'
    if kind == 'ability':
        return f'ability-{slugify(key)}'
    if kind == 'gameMode':
        return 'gameMode-singleton'
    if kind == 'patchNote':
        return f'patchNote-{slugify(key)}'
    raise ValueError(f'unknown kind {kind}')


# ── Sanity HTTP client ───────────────────────────────────────────────────
class SanityClient:
    def __init__(self, project_id: str, dataset: str, token: str, dry_run: bool = False):
        self.project_id = project_id
        self.dataset = dataset
        self.token = token
        self.dry_run = dry_run
        self.base = f'https://{project_id}.api.sanity.io/v2024-10-01/data/mutate/{dataset}'

    def commit(self, docs: list[dict[str, Any]]) -> None:
        if self.dry_run:
            print(f'  [dry] would write {len(docs)} doc(s)')
            return
        if not docs:
            return
        # Sanity allows up to ~500 mutations per tx; keep batches small for safety.
        CHUNK = 100
        for i in range(0, len(docs), CHUNK):
            batch = docs[i:i + CHUNK]
            payload = {'mutations': [{'createOrReplace': d} for d in batch]}
            self._post_with_retry(payload)

    def _post_with_retry(self, payload: dict[str, Any], attempts: int = 4) -> None:
        body = json.dumps(payload).encode('utf-8')
        last: Exception | None = None
        for n in range(attempts):
            req = urlrequest.Request(
                self.base,
                data=body,
                headers={
                    'Authorization': f'Bearer {self.token}',
                    'Content-Type': 'application/json',
                },
                method='POST',
            )
            try:
                with urlrequest.urlopen(req, timeout=60) as resp:
                    resp.read()
                return
            except HTTPError as e:
                # Read body for the diagnostic.
                try:
                    msg = e.read().decode('utf-8', errors='replace')
                except Exception:
                    msg = ''
                last = RuntimeError(f'HTTP {e.code}: {msg}')
                # 4xx — don't retry, the request is bad.
                if 400 <= e.code < 500:
                    raise last
            except URLError as e:
                last = e
            time.sleep(2 ** n)
        if last:
            raise last


# ── Per-kind transformers (must produce the same docs as migrate.ts) ─────
def _stat_block(b: dict[str, Any] | None) -> dict[str, Any] | None:
    if not b:
        return None
    return {
        'hp': b.get('hp'),
        'mana': b.get('mana'),
        'atk': b.get('atk'),
        'armor': b.get('armor'),
        'magicResist': b.get('magic_resist'),
        'atkRate': b.get('atk_rate'),
        'atkRange': b.get('atk_range'),
    }


def _localized(names: dict[str, Any] | None) -> dict[str, Any] | None:
    if not names:
        return None
    return {
        'en': names.get('en'),
        'lore': names.get('lore'),
        'ko': names.get('ko'),
        'ru': names.get('ru'),
        'zhCn': names.get('zh-cn'),
        'zhTw': names.get('zh-tw'),
    }


def _abilities_str(a: Any) -> str:
    """Round-trip the units_full.json `abilities` field via a JSON string.

    The shape in the VPK is `null` (no ability) or a list of
    {id, name, description} dicts. We serialise as JSON so it round-trips
    exactly through Sanity's text field.
    """
    if a is None or a == '':
        return ''
    return json.dumps(a, ensure_ascii=False)


def _build_synergy_docs(raw: dict[str, Any]) -> tuple[list[dict], dict[str, str]]:
    docs: list[dict] = []
    name_to_id: dict[str, str] = {}
    for game_id, s in raw.items():
        _id = doc_id('synergy', game_id)
        name_to_id[s.get('name', '')] = _id
        docs.append({
            '_id': _id,
            '_type': 'synergy',
            'gameId': game_id,
            'name': s.get('name', ''),
            'names': _localized(s.get('names')),
            'description': s.get('description', ''),
            'descriptionHtml': s.get('description_html', ''),
            'lore': s.get('lore', ''),
            'notes': s.get('notes', []),
            'tiers': s.get('tiers', []),
            'abilitySpecial': json.dumps(s['ability_special']) if s.get('ability_special') else '',
        })
    return docs, name_to_id


def _build_unit_docs(simple: dict[str, Any], full: dict[str, Any], name_to_id: dict[str, str]) -> list[dict]:
    docs: list[dict] = []
    for name, s in simple.items():
        f = full.get(name, {})
        refs = []
        for syn in s.get('synergies', []):
            sid = name_to_id.get(syn)
            if not sid:
                print(f'  ! {name}: unresolved synergy ref → {syn}', file=sys.stderr)
                continue
            refs.append({'_type': 'reference', '_ref': sid})
        stats = f.get('stats')
        docs.append({
            '_id': doc_id('unit', name),
            '_type': 'unit',
            'gameId': f.get('id', ''),
            'name': name,
            'cost': s.get('cost', f.get('cost')),
            'pool': s.get('pool', f.get('pool', 'standard')),
            'attackType': f.get('attack_type'),
            'synergies': refs,
            'names': _localized(s.get('names')),
            'abilities': _abilities_str(f.get('abilities')),
            'stats': {
                'star1': _stat_block((stats or {}).get('1_star')),
                'star2': _stat_block((stats or {}).get('2_star')),
                'star3': _stat_block((stats or {}).get('3_star')),
            } if stats else None,
        })
    return docs


def _build_item_docs(full: dict[str, Any], curated: dict[str, Any]) -> list[dict]:
    by_name = {v['name']: (k, v) for k, v in full.items()}
    curated_by_name = curated  # already keyed by name
    docs: list[dict] = []
    for game_id, it in full.items():
        cur = curated_by_name.get(it.get('name'))
        docs.append({
            '_id': doc_id('item', game_id),
            '_type': 'item',
            'gameId': game_id,
            'name': it.get('name', ''),
            'names': _localized(it.get('names')),
            'description': it.get('description', ''),
            'lore': it.get('lore', ''),
            'quality': it.get('quality', ''),
            'texture': it.get('texture', ''),
            'tier': cur.get('tier') if cur else None,
            'inCuratedSet': bool(cur),
            'iconFile': cur.get('icon') if cur else None,
            'notes': it.get('notes', []),
        })
    # Suppress lints for now; by_name unused but kept for diagnostic future use.
    _ = by_name
    return docs


def _build_relic_docs(inner: dict[str, Any]) -> list[dict]:
    return [
        {
            '_id': doc_id('relic', game_id),
            '_type': 'relic',
            'gameId': game_id,
            'name': r.get('name', ''),
            'names': _localized(r.get('names')),
            'description': r.get('description', ''),
            'lore': r.get('lore', ''),
        }
        for game_id, r in inner.items()
    ]


def _build_talent_docs(raw: dict[str, Any]) -> list[dict]:
    return [
        {
            '_id': doc_id('talent', slot),
            '_type': 'talent',
            'slot': slot,
            'title': t.get('title', ''),
            'titles': _localized(t.get('titles') or t.get('names')),
            'description': t.get('description', ''),
        }
        for slot, t in raw.items()
    ]


def _build_ability_docs(raw: dict[str, Any]) -> list[dict]:
    return [
        {
            '_id': doc_id('ability', game_id),
            '_type': 'ability',
            'gameId': game_id,
            'name': a.get('name', ''),
            'names': _localized(a.get('names')),
            'description': a.get('description', ''),
            'cooldown': a.get('cooldown', ''),
            'manaCost': a.get('mana_cost', ''),
            'castRange': a.get('cast_range', ''),
            'abilitySpecial': json.dumps(a['ability_special']) if a.get('ability_special') else '',
        }
        for game_id, a in raw.items()
    ]


def _build_game_mode_doc(raw: dict[str, Any]) -> dict:
    return {
        '_id': doc_id('gameMode', ''),
        '_type': 'gameMode',
        'dropRelicList': [
            {'_type': 'reference', '_ref': doc_id('relic', g)} for g in raw.get('drop_relic_list', [])
        ],
        'quest2RelicList': [
            {'_type': 'reference', '_ref': doc_id('relic', g)} for g in raw.get('quest_2_relic_list', [])
        ],
        'prepareTimer': raw.get('prepare_timer'),
        'battleTimer': raw.get('battle_timer'),
    }


# ── public API ───────────────────────────────────────────────────────────
KINDS = ['synergies', 'units', 'items', 'relics', 'talents', 'abilities', 'gameMode']


def push_all(
    data_dir: Path,
    only: set[str] | None = None,
    dry_run: bool = False,
    client: SanityClient | None = None,
) -> None:
    """Push structured data from the JSON files in `data_dir` to Sanity."""
    repo_root = data_dir.parent
    _load_dotenv(repo_root)
    if client is None:
        project_id = os.environ.get('SANITY_PROJECT_ID')
        dataset = os.environ.get('SANITY_DATASET', 'production')
        token = os.environ.get('SANITY_TOKEN')
        if not project_id or not token:
            raise RuntimeError(
                'SANITY_PROJECT_ID and SANITY_TOKEN must be set (env or cms/.env). '
                'See cms/README.md.'
            )
        client = SanityClient(project_id, dataset, token, dry_run=dry_run)

    def want(k: str) -> bool:
        return only is None or k in only

    def read(name: str) -> Any:
        return json.loads((data_dir / name).read_text(encoding='utf-8'))

    name_to_id: dict[str, str] = {}
    if want('synergies'):
        docs, name_to_id = _build_synergy_docs(read('synergies.json'))
        client.commit(docs)
        print(f'✓ synergies: {len(docs)}')
    elif want('units'):
        # Need the lookup even if not migrating synergies.
        _, name_to_id = _build_synergy_docs(read('synergies.json'))

    if want('units'):
        simple = read('units.json').get('units', {})
        full = read('units_full.json')
        docs = _build_unit_docs(simple, full, name_to_id)
        client.commit(docs)
        print(f'✓ units: {len(docs)}')

    if want('items'):
        full = read('items_full.json')
        curated = read('items.json').get('items', {})
        docs = _build_item_docs(full, curated)
        client.commit(docs)
        print(f'✓ items: {len(docs)} ({sum(1 for d in docs if d["inCuratedSet"])} curated)')

    if want('relics'):
        inner = read('relics.json').get('relics', {})
        docs = _build_relic_docs(inner)
        client.commit(docs)
        print(f'✓ relics: {len(docs)}')

    if want('talents'):
        docs = _build_talent_docs(read('talents.json'))
        client.commit(docs)
        print(f'✓ talents: {len(docs)}')

    if want('abilities'):
        docs = _build_ability_docs(read('abilities.json'))
        client.commit(docs)
        print(f'✓ abilities: {len(docs)}')

    if want('gameMode'):
        client.commit([_build_game_mode_doc(read('game_mode.json'))])
        print('✓ gameMode (singleton)')


def main() -> None:
    p = argparse.ArgumentParser(description='Push /data JSONs to Sanity CMS.')
    p.add_argument('--data-dir', default=str(Path(__file__).parent),
                   help='Directory holding the JSON files (default: this script\'s dir).')
    p.add_argument('--only', nargs='+', choices=KINDS,
                   help='Only push the listed kinds.')
    p.add_argument('--dry-run', action='store_true',
                   help='Do not POST anything, just summarise.')
    args = p.parse_args()

    push_all(
        data_dir=Path(args.data_dir),
        only=set(args.only) if args.only else None,
        dry_run=args.dry_run,
    )


if __name__ == '__main__':
    main()
