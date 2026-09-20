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


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(command, cwd=ROOT, log=None):
    print('+', ' '.join(map(str, command)), flush=True)
    if log is None:
        subprocess.run(list(map(str, command)), cwd=cwd, check=True)
    else:
        with log.open('w', encoding='utf-8') as output:
            subprocess.run(list(map(str, command)), cwd=cwd, check=True,
                           stdout=output, stderr=subprocess.STDOUT)


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
    asset = f'DepotDownloader-{os_name}-{arch}.zip'
    binary = 'DepotDownloader.exe' if os_name == 'windows' else 'DepotDownloader'
    destination = cache / 'tools' / DOWNLOADER_VERSION / f'{os_name}-{arch}' / binary
    if destination.exists():
        return destination
    url = (f'https://github.com/SteamRE/DepotDownloader/releases/download/'
           f'DepotDownloader_{DOWNLOADER_VERSION}/{asset}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Extract only the executable, never arbitrary archive paths.
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        archive = Path(temporary) / asset
        print(f'Downloading {url}', flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
        with zipfile.ZipFile(archive) as bundle:
            candidates = [i for i in bundle.infolist()
                          if not i.is_dir() and PurePosixPath(i.filename).name == binary]
            if len(candidates) != 1:
                raise RuntimeError(f'Expected one {binary} in {asset}')
            staged = Path(temporary) / binary
            with bundle.open(candidates[0]) as source, staged.open('wb') as output:
                shutil.copyfileobj(source, output)
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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=Path,
                        default=Path.home() / '.cache/dac-tools/workshop')
    parser.add_argument('--depot-downloader', help='Use an installed binary instead of downloading 3.4.0')
    parser.add_argument('--download-only', action='store_true', help='Download the VPK without touching repository content')
    parser.add_argument('--full-checks', action='store_true', help='Also run synergy, patch and web TypeScript checks (requires pnpm install)')
    args = parser.parse_args(argv)
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
        print(f'VPK: {archive}', flush=True)
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
        report.update(status='refreshed', deterministic=True, overlays_preserved=True,
                      full_checks=args.full_checks)
        print('Refresh complete. Review the diff and Lua source; nothing was committed or marked synced.')
        return 0
    except Exception as exc:
        report.update(status='failed', error=str(exc))
        raise
    finally:
        if run_dir is not None:
            report['finished_at'] = datetime.now(timezone.utc).isoformat()
            (run_dir / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        lock.rmdir()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
