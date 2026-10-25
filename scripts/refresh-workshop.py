#!/usr/bin/env python3
"""Download and refresh DAC Workshop data without a Steam client or login.

Run from a clean dedicated checkout. Never commits, pushes or marks patches synced.
Requires Python's vpk package; --download-only needs only the standard library.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile


WORKSHOP_ID = '1613886175'
DOWNLOADER_VERSION = '3.4.0'
ROOT = Path(__file__).resolve().parents[1]
# Updated only after a successful refresh. The workflow compares Steam's
# published-file time_updated with this file on the default branch and, when
# that branch exists, on the refresh branch.
LAST_SEEN_RELATIVE = Path('data/workshop-last-seen.json')
MANIFEST_LINE = re.compile(r'^Manifest (\d+) \((.+)\)\s*$', re.MULTILINE)
PUBLISHED_FILE_URL = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/'
# sha256 of the official DepotDownloader 3.4.0 release zips and of the
# executable stored in each zip. The download is rejected unless both match.
DOWNLOADER_ARCHIVES = {
    'linux-x64': {
        'asset': 'DepotDownloader-linux-x64.zip',
        'archive_sha256': 'a999dec66b4850fc961bd50366696d23c2d0fad7b18790e6a5647b2f19097a53',
        'binary_sha256': 'd62a1721564bdb96bacd9285bb5f96180a45202e82a9f85c6a88e5e8ee5f992c',
    },
    'linux-arm64': {
        'asset': 'DepotDownloader-linux-arm64.zip',
        'archive_sha256': 'd9fb612ccebc1db8eeea3b4045d2221ec70431381393ce908fb72f01d4f9c812',
        'binary_sha256': '07190213d6eb59799a59fb2cc763f52f51a59bfe8ad0f72c36044fff0fce9a09',
    },
    'linux-arm': {
        'asset': 'DepotDownloader-linux-arm.zip',
        'archive_sha256': '6cd66cd4f4f1e99ca2b30ca5ce097545d93bdad1fa754d9a74d8738e9e4e1022',
        'binary_sha256': '073bcff152a4a1248e2db7faefa2fa920446de9058ea8c51a359b5d46bffab63',
    },
    'macos-x64': {
        'asset': 'DepotDownloader-macos-x64.zip',
        'archive_sha256': '3214b689564d73e9342a8a4aef693de6ad3d293801b0f300a4466f60ec75befb',
        'binary_sha256': '8433ea659f93fffb3c0da3400c2fd71393238db35d7780cf5a449fe8b8b10dba',
    },
    'macos-arm64': {
        'asset': 'DepotDownloader-macos-arm64.zip',
        'archive_sha256': '60e80c7c496f3f9a079cd3c62036b35d088c27bc0149baf38f009eb57a52f6a5',
        'binary_sha256': 'e5588dff802b7395b22b308ee796dd57bacbbbb2decddb12fd94101cb4f40fa5',
    },
    'windows-x64': {
        'asset': 'DepotDownloader-windows-x64.zip',
        'archive_sha256': '41c9e9f0df54b3ad02e67a11726756e5c73283bd7c2e1b04acfa5ae4c2ed3767',
        'binary_sha256': '6281279efce8f1e20db9532a58e42382f81afb9e3827a8b965ffcb43fbe4531f',
    },
    'windows-arm64': {
        'asset': 'DepotDownloader-windows-arm64.zip',
        'archive_sha256': '1449ba47775e9974036e615bedf00d72bef747cc5b93a78048ed4e0b2c63b2b3',
        'binary_sha256': 'bf0e67c0f2645cc359574b343b8971508aa40680b19a12aa1b837f25653b5d39',
    },
}


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_sha256(path, expected, label):
    digest = sha256(path)
    if digest != expected:
        raise RuntimeError(f'Checksum mismatch for {label}: {digest} != {expected}')
    return digest


def read_json(path):
    if path is None:
        return {}
    file = Path(path)
    if not file.is_file():
        return {}
    payload = json.loads(file.read_text(encoding='utf-8'))
    return payload if isinstance(payload, dict) else {}


def write_github_output(path, values):
    if path is None:
        return
    with Path(path).open('a', encoding='utf-8') as handle:
        for key, value in values.items():
            text = '' if value is None else str(value)
            if '\n' in text:
                raise RuntimeError(f'GitHub output {key} contains a newline')
            handle.write(f'{key}={text}\n')


def run(command, cwd=ROOT, log=None):
    print('+', ' '.join(map(str, command)), flush=True)
    if log is None:
        subprocess.run(list(map(str, command)), cwd=cwd, check=True)
    else:
        with log.open('w', encoding='utf-8') as output:
            subprocess.run(list(map(str, command)), cwd=cwd, check=True,
                           stdout=output, stderr=subprocess.STDOUT)


def downloader_pin(os_name, arch):
    pin = DOWNLOADER_ARCHIVES.get(f'{os_name}-{arch}')
    if pin is None:
        raise RuntimeError(f'No pinned DepotDownloader checksum for {os_name}-{arch}')
    return pin


def downloader(cache, explicit=None):
    if explicit:
        found = shutil.which(explicit)
        path = Path(found or explicit).expanduser().resolve()
        if not path.is_file():
            raise RuntimeError(f'DepotDownloader not found: {explicit}')
        return path
    arch = {'aarch64': 'arm64', 'arm64': 'arm64', 'armv7l': 'arm',
            'x86_64': 'x64', 'amd64': 'x64'}.get(platform.machine().lower())
    os_name = {'Linux': 'linux', 'Darwin': 'macos', 'Windows': 'windows'}.get(platform.system())
    if not arch or not os_name:
        raise RuntimeError('Unsupported host; provide --depot-downloader PATH')
    pin = downloader_pin(os_name, arch)
    asset = pin['asset']
    binary = 'DepotDownloader.exe' if os_name == 'windows' else 'DepotDownloader'
    destination = cache / 'tools' / DOWNLOADER_VERSION / f'{os_name}-{arch}' / binary
    if destination.exists():
        try:
            verify_sha256(destination, pin['binary_sha256'], binary)
            return destination
        except RuntimeError as error:
            print(f'{error}; downloading the pinned archive again', flush=True)
            destination.unlink()
    url = (f'https://github.com/SteamRE/DepotDownloader/releases/download/'
           f'DepotDownloader_{DOWNLOADER_VERSION}/{asset}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Extract only the executable, never arbitrary archive paths.
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        archive = Path(temporary) / asset
        print(f'Downloading {url}', flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
        verify_sha256(archive, pin['archive_sha256'], asset)
        with zipfile.ZipFile(archive) as bundle:
            candidates = [i for i in bundle.infolist()
                          if not i.is_dir() and PurePosixPath(i.filename).name == binary]
            if len(candidates) != 1:
                raise RuntimeError(f'Expected one {binary} in {asset}')
            staged = Path(temporary) / binary
            with bundle.open(candidates[0]) as source, staged.open('wb') as output:
                shutil.copyfileobj(source, output)
            verify_sha256(staged, pin['binary_sha256'], binary)
            staged.chmod(0o755)
            staged.replace(destination)
    return destination


def select_vpk(directory):
    # Dota Workshop publishes one archive. Fail on ambiguity instead of using stale data.
    matches = sorted(directory.rglob('*.vpk'))
    if len(matches) != 1:
        raise RuntimeError(f'Expected one Workshop VPK; found {len(matches)} in {directory}')
    with matches[0].open('rb') as stream:
        if stream.read(4) != b'\x34\x12\xaa\x55':
            raise RuntimeError(f'Invalid VPK header: {matches[0]}')
    return matches[0]


def unpack_scripts(pak, destination):
    count = 0
    for name in pak:
        member = PurePosixPath(name)
        if not name.startswith('scripts/vscripts/') or member.suffix != '.lua':
            continue
        if '..' in member.parts or '\\' in name:
            raise RuntimeError(f'Unsafe VPK member: {name}')
        raw = pak[name].read()
        if raw.startswith((b'\x1bLua', b'\x1bLJ')):
            raise RuntimeError(f'Compiled Lua requires a compatible decompiler: {name}')
        raw.decode('utf-8')  # Refuse lossy decoding of source used for review.
        target = destination.joinpath(*member.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        count += 1
    if not (destination / 'scripts/vscripts/addon_game_mode.lua').is_file():
        raise RuntimeError('Workshop VPK has no readable addon_game_mode.lua')
    return count


def overlays(root):
    result = {}
    game = root / 'content/game'
    for category in ('units', 'items', 'synergies', 'relics'):
        for path in (game / category).glob('*.json'):
            record = json.loads(path.read_text(encoding='utf-8'))
            result[str(path.relative_to(root))] = {
                key: record[key] for key in ('overrides', 'commentary', 'relatedEntities')
                if key in record
            }
    for name in ('curated-items.json', 'item-links.json', 'text-corrections.json'):
        path = game / name
        if path.exists():
            result[str(path.relative_to(root))] = json.loads(path.read_text(encoding='utf-8'))
    return result


def verify_overlays(before, after):
    changed = [path for path, value in before.items() if after.get(path) != value]
    if changed:
        raise RuntimeError('Preserved content changed: ' + ', '.join(changed))


def snapshot(root):
    paths = list((root / 'content').rglob('*')) + list((root / 'data/icons').rglob('*'))
    paths.append(root / 'web/generated/content-data.ts')
    return {str(p.relative_to(root)): sha256(p) for p in paths if p.is_file()}


def parse_manifest_log(text):
    """Read the manifest DepotDownloader prints after a Workshop download.

    The stable line is ``Manifest <id> (<CreationTime>)``. CreationTime on the
    GitHub runner is UTC, month/day/year, 24-hour. Other cultures may use a
    12-hour clock; both are accepted.
    """
    found = [(manifest_id, created.strip()) for manifest_id, created in MANIFEST_LINE.findall(text)]
    if len(found) != 1:
        raise RuntimeError(f'Expected one DepotDownloader manifest line, found {len(found)}')
    manifest_id, created_at = found[0]
    return {
        'manifest_id': manifest_id,
        'manifest_created_at': created_at,
        'manifest_date': manifest_calendar_date(created_at),
    }


def manifest_calendar_date(created_at):
    iso = re.search(r'(\d{4})-(\d{2})-(\d{2})', created_at)
    if iso:
        return _safe_date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
    us = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', created_at)
    if not us:
        return None
    month, day, year = (int(part) for part in us.groups())
    # DepotDownloader's default format is month/day. Swap only when the first
    # number cannot be a month.
    if month > 12 and day <= 12:
        month, day = day, month
    return _safe_date(year, month, day)


def manifest_datetime(created_at):
    date = manifest_calendar_date(created_at)
    if date is None:
        return None
    clock = re.search(r'(\d{1,2}):(\d{2}):(\d{2})(?:\s*([AaPp][Mm]))?', created_at)
    if clock is None:
        return datetime.fromisoformat(f'{date}T00:00:00').replace(tzinfo=timezone.utc)
    hour, minute, second = (int(clock.group(index)) for index in range(1, 4))
    meridiem = clock.group(4)
    if meridiem:
        hour %= 12
        if meridiem.lower() == 'pm':
            hour += 12
    return datetime.fromisoformat(
        f'{date}T{hour:02d}:{minute:02d}:{second:02d}').replace(tzinfo=timezone.utc)


def _safe_date(year, month, day):
    try:
        return datetime(year, month, day, tzinfo=timezone.utc).date().isoformat()
    except ValueError:
        return None


def game_categories(*directories):
    names = set()
    for directory in directories:
        directory = Path(directory)
        if directory.is_dir():
            names.update(path.name for path in directory.iterdir() if path.is_dir() and not path.name.startswith('.'))
    return sorted(names)


def _entity_names(game_dir, categories):
    named = {}
    game_dir = Path(game_dir)
    for category in categories:
        entries = {}
        folder = game_dir / category
        if folder.is_dir():
            for path in sorted(folder.glob('*.json')):
                try:
                    record = json.loads(path.read_text(encoding='utf-8'))
                except (OSError, json.JSONDecodeError):
                    record = {}
                name = record.get('name') if isinstance(record, dict) else None
                entries[path.name] = name or path.stem
        named[category] = entries
    return named


def diff_game_trees(before_game, after_game):
    categories = game_categories(before_game, after_game)
    before = _entity_names(before_game, categories)
    after = _entity_names(after_game, categories)
    before_game = Path(before_game)
    after_game = Path(after_game)
    changes = {}
    for category in categories:
        old = before[category]
        new = after[category]
        modified = []
        for name in sorted(set(old) & set(new)):
            old_path = before_game / category / name
            new_path = after_game / category / name
            if not old_path.is_file() or not new_path.is_file() or sha256(old_path) != sha256(new_path):
                modified.append({'file': name, 'name': new[name]})
        changes[category] = {
            'before': len(old),
            'after': len(new),
            'added': [{'file': name, 'name': new[name]} for name in sorted(set(new) - set(old))],
            'removed': [{'file': name, 'name': old[name]} for name in sorted(set(old) - set(new))],
            'modified': modified,
        }
    return changes


def _icon_index(directory):
    directory = Path(directory) if directory is not None else None
    if directory is None or not directory.exists():
        return {}
    return {
        str(path.relative_to(directory)): sha256(path)
        for path in sorted(directory.rglob('*')) if path.is_file()
    }


def diff_icons(before_dir, after_dir):
    before = _icon_index(before_dir)
    after = _icon_index(after_dir)
    return {
        'before': len(before),
        'after': len(after),
        'added': sorted(set(after) - set(before)),
        'removed': sorted(set(before) - set(after)),
        'modified': sorted(path for path in set(before) & set(after) if before[path] != after[path]),
    }


def last_seen_payload(report):
    payload = {
        'workshop_id': report.get('workshop_id', WORKSHOP_ID),
        'app_id': 570,
        'manifest_id': report['manifest_id'],
        'manifest_created_at': report['manifest_created_at'],
        'manifest_date': report.get('manifest_date'),
        'vpk_sha256': report['vpk_sha256'],
        'vpk_bytes': report['vpk_bytes'],
        'recorded_at': report['finished_at'],
    }
    if report.get('time_updated'):
        payload['time_updated'] = str(report['time_updated'])
    return payload


def fetch_published_file(workshop_id=WORKSHOP_ID, timeout=30):
    """Read Steam's published-file record. This is a few kilobytes, not the VPK."""
    request = urllib.request.Request(
        PUBLISHED_FILE_URL,
        data=f'itemcount=1&publishedfileids[0]={workshop_id}'.encode(),
        headers={'User-Agent': 'dac-tools-workshop-refresh'},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)
    details = payload['response']['publishedfiledetails'][0]
    if details.get('result') != 1 or not details.get('time_updated'):
        raise RuntimeError(f"Published file lookup failed: {details.get('result')}")
    return {
        'workshop_id': str(workshop_id),
        'time_updated': str(details['time_updated']),
        'hcontent_file': str(details.get('hcontent_file') or ''),
        'file_size': details.get('file_size'),
    }


def assess_published_file(published, records):
    """Return whether time_updated (or the recorded manifest) is unchanged.

    ``time_updated`` is the value Steam publishes for item 1613886175. A record
    that predates that field still counts as unchanged when its manifest id is
    the published ``hcontent_file``.
    """
    current_time = str(published.get('time_updated') or '')
    current_manifest = str(published.get('hcontent_file') or '')
    saw_record = False
    for record in records:
        if not isinstance(record, dict) or not record:
            continue
        saw_record = True
        recorded_time = str(record.get('time_updated') or '')
        recorded_manifest = str(record.get('manifest_id') or '')
        if current_time and recorded_time == current_time:
            return True, f'Last recorded time_updated={recorded_time}'
        if current_manifest and recorded_manifest == current_manifest:
            return True, f'Last recorded manifest_id={recorded_manifest} matches hcontent_file'
    if not saw_record:
        return False, 'No last-seen manifest is recorded'
    return False, 'Last recorded time_updated does not match the published file'


def format_published_check(published, records):
    unchanged, detail = assess_published_file(published, records)
    lines = [
        f"Published file {WORKSHOP_ID} time_updated={published.get('time_updated')} "
        f"hcontent_file={published.get('hcontent_file') or ''}",
        detail,
        'Published file is unchanged. Skipping Workshop download.' if unchanged
        else 'Published file changed. Workshop download is required.',
    ]
    return unchanged, lines


def verify_pins():
    """Fail when the workflow env pins drift from the checksums in this file."""
    pin = DOWNLOADER_ARCHIVES['linux-x64']
    checks = {
        'DEPOTDOWNLOADER_VERSION': DOWNLOADER_VERSION,
        'DEPOTDOWNLOADER_LINUX_X64_SHA256': pin['archive_sha256'],
        'DEPOTDOWNLOADER_LINUX_X64_BINARY_SHA256': pin['binary_sha256'],
    }
    for key, expected in checks.items():
        actual = os.environ.get(key)
        if actual != expected:
            raise RuntimeError(f'{key}={actual!r} does not match the pinned DepotDownloader checksum {expected}')
    print(
        f'DepotDownloader {DOWNLOADER_VERSION} pins match '
        f'{pin["archive_sha256"]}',
        flush=True,
    )
    return 0


def check_published(last_seen_paths, github_output=None):
    published = fetch_published_file()
    records = [read_json(path) for path in last_seen_paths]
    unchanged, lines = format_published_check(published, records)
    for line in lines:
        print(line, flush=True)
    write_github_output(github_output, {
        'download': 'false' if unchanged else 'true',
        'time_updated': published.get('time_updated') or '',
        'hcontent_file': published.get('hcontent_file') or '',
    })
    return 0


def write_last_seen(root, report):
    path = Path(root) / LAST_SEEN_RELATIVE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(last_seen_payload(report), indent=2) + '\n', encoding='utf-8')
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=Path,
                        default=Path.home() / '.cache/dac-tools/workshop')
    parser.add_argument('--depot-downloader', help='Use an installed binary instead of downloading 3.4.0')
    parser.add_argument('--download-only', action='store_true', help='Download the VPK without touching repository content')
    parser.add_argument('--full-checks', action='store_true', help='Also run synergy, patch and web TypeScript checks (requires pnpm install)')
    parser.add_argument('--verify-pins', action='store_true',
                        help='Check workflow DepotDownloader checksum env vars against this script')
    args = parser.parse_args(argv)
    if args.verify_pins:
        return verify_pins()
    cache = args.cache_dir.expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True)
    lock = cache / 'refresh.lock'
    try:
        lock.mkdir()
    except FileExistsError:
        raise RuntimeError(f'Refresh already running, or stale lock after interruption: {lock}')
    report = {'status': 'started', 'workshop_id': WORKSHOP_ID,
              'started_at': datetime.now(timezone.utc).isoformat()}
    run_dir = None
    try:
        run_dir = Path(tempfile.mkdtemp(prefix='run-', dir=cache))
        print(f'Run evidence: {run_dir}', flush=True)
        if not args.download_only:
            # Check requirements before spending time on the download.
            vpk = importlib.import_module('vpk')
            if not shutil.which('npm'):
                raise RuntimeError('npm is required for runtime-data generation')
            status = subprocess.check_output(
                ['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT, text=True)
            if status.strip():
                raise RuntimeError('Use a clean dedicated checkout; this script does not reset existing work')
            report['base_commit'] = subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
            published = fetch_published_file()
            report['time_updated'] = published['time_updated']
            report['hcontent_file'] = published['hcontent_file']
            print(
                f"Published file {WORKSHOP_ID} time_updated={published['time_updated']} "
                f"hcontent_file={published['hcontent_file']}",
                flush=True,
            )
        binary = downloader(cache, args.depot_downloader)
        report['downloader_sha256'] = sha256(binary)
        report['downloader_path'] = str(binary)
        run([binary, '--version'], log=run_dir / 'downloader-version.log')
        # Fresh directory per run prevents an old cached archive masquerading as current.
        downloaded = run_dir / 'download'
        downloaded.mkdir()
        run([binary, '-app', '570', '-pubfile', WORKSHOP_ID, '-dir', downloaded, '-validate'],
            log=run_dir / 'download.log')
        archive = select_vpk(downloaded)
        report.update(vpk_path=str(archive), vpk_sha256=sha256(archive), vpk_bytes=archive.stat().st_size)
        report.update(parse_manifest_log((run_dir / 'download.log').read_text(encoding='utf-8', errors='replace')))
        if report.get('hcontent_file') and report['manifest_id'] != report['hcontent_file']:
            raise RuntimeError(
                f"Downloaded manifest {report['manifest_id']} does not match "
                f"published hcontent_file {report['hcontent_file']}"
            )
        print(f'VPK: {archive}', flush=True)
        print(f"Manifest: {report['manifest_id']} ({report['manifest_created_at']})", flush=True)
        print(f"VPK sha256: {report['vpk_sha256']} bytes: {report['vpk_bytes']}", flush=True)
        if args.download_only:
            report['status'] = 'downloaded'
            return 0
        pak = vpk.open(str(archive))
        report['lua_files'] = unpack_scripts(pak, run_dir / 'unpacked')
        before = overlays(ROOT)
        (run_dir / 'overlays-before.json').write_text(json.dumps(before, ensure_ascii=False, indent=2), encoding='utf-8')
        shutil.copytree(ROOT / 'content', run_dir / 'content-before')
        if (ROOT / 'data/icons').exists():
            shutil.copytree(ROOT / 'data/icons', run_dir / 'icons-before')
        for attempt in (1, 2):
            run([sys.executable, ROOT / 'data/extract_vpk.py', archive])
            run(['npm', 'run', 'web:data'])
            verify_overlays(before, overlays(ROOT))
            current = snapshot(ROOT)
            if attempt == 1:
                first = current
            elif current != first:
                raise RuntimeError('Repeat extraction/runtime generation is not deterministic')
        run([sys.executable, '-m', 'unittest', 'discover', '-s', 'data', '-p', 'test_extract_vpk.py'])
        if args.full_checks:
            for command in (['npm', 'run', 'test:synergies'], ['npm', 'run', 'test:patch-notes'],
                            ['npm', 'run', 'validate:patch-notes'], ['pnpm', '--dir', 'web', 'exec', 'tsc', '--noEmit']):
                run(command)
        report['entity_changes'] = diff_game_trees(
            run_dir / 'content-before' / 'game', ROOT / 'content' / 'game')
        icons_before = run_dir / 'icons-before'
        report['icon_changes'] = diff_icons(
            icons_before if icons_before.exists() else None, ROOT / 'data' / 'icons')
        report['last_seen'] = LAST_SEEN_RELATIVE.as_posix()
        report.update(status='refreshed', deterministic=True, overlays_preserved=True,
                      full_checks=args.full_checks)
        print('Refresh complete. Review the diff and Lua source; nothing was committed or marked synced.')
        return 0
    except Exception as exc:
        report.update(status='failed', error=str(exc))
        raise
    finally:
        try:
            if run_dir is not None:
                report['finished_at'] = datetime.now(timezone.utc).isoformat()
                if report.get('status') == 'refreshed':
                    write_last_seen(ROOT, report)
                (run_dir / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        finally:
            lock.rmdir()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
