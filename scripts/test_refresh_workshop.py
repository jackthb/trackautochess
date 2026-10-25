import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('refresh_workshop', Path(__file__).with_name('refresh-workshop.py'))
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class RefreshTests(unittest.TestCase):
    def fake_downloader(self, root, fail=False):
        binary = root / 'DepotDownloader'
        binary.write_text(
            '#!' + sys.executable + '\n'
            'import sys\nfrom pathlib import Path\n'
            'if "--version" in sys.argv:\n print("fixture")\n sys.exit(0)\n'
            'assert sys.argv[1:5] == ["-app", "570", "-pubfile", "1613886175"]\n'
            'assert "-username" not in sys.argv and "-password" not in sys.argv\n'
            + ('sys.exit(9)\n' if fail else
               'print("Manifest 5678485005516802387 (10/21/2026 09:20:25)")\n'
               'out = Path(sys.argv[sys.argv.index("-dir") + 1])\n'
               '(out / "1613886175.vpk").write_bytes(bytes.fromhex("3412aa55") + b"fixture")\n'),
            encoding='utf-8',
        )
        binary.chmod(0o755)
        return binary

    def test_download_only_uses_anonymous_latest_workshop_and_records_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            binary = self.fake_downloader(root)
            with patch.object(refresh, 'ROOT', root):
                self.assertEqual(refresh.main(['--download-only', '--cache-dir', str(root / 'cache'),
                                               '--depot-downloader', str(binary)]), 0)
            report = json.loads(next((root / 'cache').glob('run-*/report.json')).read_text())
            self.assertEqual(report['status'], 'downloaded')
            self.assertEqual(report['manifest_id'], '5678485005516802387')
            self.assertEqual(report['manifest_date'], '2026-10-21')
            self.assertEqual(report['vpk_sha256'], refresh.sha256(Path(report['vpk_path'])))
            self.assertFalse((root / 'content').exists())
            self.assertFalse((root / 'data/workshop-last-seen.json').exists())
            self.assertFalse((root / 'cache/refresh.lock').exists())

    def test_download_failure_does_not_reuse_previous_vpk(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = root / 'cache'
            cache.mkdir()
            (cache / 'old.vpk').write_bytes(bytes.fromhex('3412aa55'))
            binary = self.fake_downloader(root, fail=True)
            with patch.object(refresh, 'ROOT', root), self.assertRaises(Exception):
                refresh.main(['--download-only', '--cache-dir', str(cache), '--depot-downloader', str(binary)])
            report = json.loads(next(cache.glob('run-*/report.json')).read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertNotIn('vpk_path', report)
            self.assertFalse((cache / 'refresh.lock').exists())

    def test_rejects_ambiguous_or_invalid_archives(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'one.vpk').write_bytes(b'not a vpk')
            with self.assertRaisesRegex(RuntimeError, 'Invalid VPK'):
                refresh.select_vpk(root)
            (root / 'two.vpk').touch()
            with self.assertRaisesRegex(RuntimeError, 'found 2'):
                refresh.select_vpk(root)

    def test_compiled_lua_and_traversal_are_rejected(self):
        class Entry:
            def __init__(self, data): self.data = data
            def read(self): return self.data
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(RuntimeError, 'Compiled Lua'):
                refresh.unpack_scripts({'scripts/vscripts/addon_game_mode.lua': Entry(b'\x1bLua')}, root)
            with self.assertRaisesRegex(RuntimeError, 'Unsafe VPK'):
                refresh.unpack_scripts({'scripts/vscripts/../../../escape.lua': Entry(b'hello')}, root)
            self.assertEqual(refresh.unpack_scripts(
                {'scripts/vscripts/addon_game_mode.lua': Entry(b'-- source\n')}, root), 1)

    def test_preserved_fields_cannot_be_removed_or_changed(self):
        before = {'unit.json': {'commentary': 'manual'}}
        refresh.verify_overlays(before, {**before, 'new.json': {}})
        for after in ({}, {'unit.json': {'commentary': 'changed'}}):
            with self.assertRaisesRegex(RuntimeError, 'Preserved content changed'):
                refresh.verify_overlays(before, after)

    def test_manifest_log_uses_the_depotdownloader_summary_line(self):
        log = (
            'Got manifest request code for depot 570 from app 570, '
            'manifest 5678485005516802387, result: 1\n'
            'Manifest 5678485005516802387 (10/21/2026 09:20:25)\n'
            'Downloading depot 570\n'
        )
        parsed = refresh.parse_manifest_log(log)
        self.assertEqual(parsed['manifest_id'], '5678485005516802387')
        self.assertEqual(parsed['manifest_created_at'], '10/21/2026 09:20:25')
        self.assertEqual(parsed['manifest_date'], '2026-10-21')
        self.assertEqual(
            refresh.manifest_datetime(parsed['manifest_created_at']).isoformat(),
            '2026-10-21T09:20:25+00:00')
        self.assertEqual(
            refresh.manifest_datetime('10/21/2026 1:02:03 PM').isoformat(),
            '2026-10-21T13:02:03+00:00')
        with self.assertRaisesRegex(RuntimeError, 'found 0'):
            refresh.parse_manifest_log('Downloading depot 570\n')
        with self.assertRaisesRegex(RuntimeError, 'found 2'):
            refresh.parse_manifest_log(log + 'Manifest 2 (10/22/2026 00:00:00)\n')

    def test_entity_and_icon_diffs_count_adds_removes_and_edits(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            before = root / 'before'
            after = root / 'after'
            for name, body in {
                'units/kept.json': {'name': 'Kept'},
                'units/edited.json': {'name': 'Edited'},
                'units/gone.json': {'name': 'Gone'},
            }.items():
                path = before / 'game' / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(body), encoding='utf-8')
            for name, body in {
                'units/kept.json': {'name': 'Kept'},
                'units/edited.json': {'name': 'Edited v2'},
                'units/new.json': {'name': 'New'},
            }.items():
                path = after / 'game' / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(body), encoding='utf-8')
            (before / 'icons' / 'old.png').parent.mkdir(parents=True)
            (before / 'icons' / 'old.png').write_bytes(b'old')
            (before / 'icons' / 'same.png').write_bytes(b'same')
            (after / 'icons').mkdir()
            (after / 'icons' / 'same.png').write_bytes(b'same')
            (after / 'icons' / 'new.png').write_bytes(b'new')
            changes = refresh.diff_game_trees(before / 'game', after / 'game')
            units = changes['units']
            self.assertEqual((units['before'], units['after']), (3, 3))
            self.assertEqual(units['added'], [{'file': 'new.json', 'name': 'New'}])
            self.assertEqual(units['removed'], [{'file': 'gone.json', 'name': 'Gone'}])
            self.assertEqual(units['modified'], [{'file': 'edited.json', 'name': 'Edited v2'}])
            icons = refresh.diff_icons(before / 'icons', after / 'icons')
            self.assertEqual(icons['added'], ['new.png'])
            self.assertEqual(icons['removed'], ['old.png'])
            self.assertEqual(icons['modified'], [])
            self.assertEqual((icons['before'], icons['after']), (2, 2))

    def test_last_seen_is_written_from_the_report(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = refresh.write_last_seen(root, {
                'manifest_id': '5678485005516802387',
                'manifest_created_at': '10/21/2026 09:20:25',
                'manifest_date': '2026-10-21',
                'vpk_sha256': 'abc',
                'vpk_bytes': 5,
                'finished_at': '2026-10-24T18:00:00+00:00',
            })
            self.assertEqual(path, root / 'data/workshop-last-seen.json')
            saved = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(saved['manifest_id'], '5678485005516802387')
            self.assertEqual(saved['workshop_id'], refresh.WORKSHOP_ID)
            self.assertEqual(saved['app_id'], 570)
            saved = json.loads(refresh.write_last_seen(root, {
                'manifest_id': '5678485005516802387',
                'manifest_created_at': '10/21/2026 09:20:25',
                'manifest_date': '2026-10-21',
                'vpk_sha256': 'abc',
                'vpk_bytes': 5,
                'finished_at': '2026-10-24T18:00:00+00:00',
                'time_updated': '1792574438',
            }).read_text(encoding='utf-8'))
            self.assertEqual(saved['time_updated'], '1792574438')

    def test_unchanged_time_updated_skips_the_download(self):
        published = {
            'workshop_id': refresh.WORKSHOP_ID,
            'time_updated': '1792574438',
            'hcontent_file': '5678485005516802387',
            'file_size': 10,
        }
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            last_seen = root / 'last.json'
            last_seen.write_text(json.dumps({
                'time_updated': '1792574438',
                'manifest_id': '5678485005516802387',
            }), encoding='utf-8')
            output = root / 'github.out'
            with patch.object(refresh, 'fetch_published_file', return_value=published), \
                    patch.object(refresh, 'downloader', side_effect=AssertionError('downloaded')):
                self.assertEqual(refresh.check_published([last_seen], output), 0)
            self.assertIn('download=false\n', output.read_text(encoding='utf-8'))
            self.assertFalse((root / 'cache').exists())

    def test_changed_time_updated_still_does_not_download_during_the_check(self):
        published = {
            'time_updated': '1793000000',
            'hcontent_file': '999',
        }
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            last_seen = root / 'last.json'
            last_seen.write_text(json.dumps({'time_updated': '1792574438'}), encoding='utf-8')
            output = root / 'github.out'
            with patch.object(refresh, 'fetch_published_file', return_value=published), \
                    patch.object(refresh, 'downloader', side_effect=AssertionError('downloaded')):
                self.assertEqual(refresh.check_published([last_seen], output), 0)
            text = output.read_text(encoding='utf-8')
            self.assertIn('download=true\n', text)
            self.assertIn('time_updated=1793000000\n', text)

    def test_downloader_rejects_an_archive_that_misses_the_pin(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr('DepotDownloader', b'not-the-real-binary')
            payload = archive.read_bytes()

            class Response:
                def __init__(self):
                    self._offset = 0

                def read(self, size=-1):
                    if size is None or size < 0:
                        size = len(payload) - self._offset
                    chunk = payload[self._offset:self._offset + size]
                    self._offset += len(chunk)
                    return chunk

                def __enter__(self):
                    return self

                def __exit__(self, *_args):
                    return False

            with patch.object(refresh.urllib.request, 'urlopen', lambda *_args, **_kwargs: Response()):
                with self.assertRaisesRegex(RuntimeError, 'Checksum mismatch'):
                    refresh.downloader(root / 'cache')
            self.assertFalse(any((root / 'cache').rglob('DepotDownloader')))

    def test_verify_pins_checks_the_workflow_env(self):
        pin = refresh.DOWNLOADER_ARCHIVES['linux-x64']
        matched = {
            'DEPOTDOWNLOADER_VERSION': refresh.DOWNLOADER_VERSION,
            'DEPOTDOWNLOADER_LINUX_X64_SHA256': pin['archive_sha256'],
            'DEPOTDOWNLOADER_LINUX_X64_BINARY_SHA256': pin['binary_sha256'],
        }
        with patch.dict('os.environ', matched, clear=False):
            self.assertEqual(refresh.main(['--verify-pins']), 0)
        drifted = dict(matched)
        drifted['DEPOTDOWNLOADER_LINUX_X64_SHA256'] = '0' * 64
        with patch.dict('os.environ', drifted, clear=False):
            with self.assertRaisesRegex(RuntimeError, 'does not match'):
                refresh.main(['--verify-pins'])

    def test_existing_lock_prevents_second_run(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'refresh.lock').mkdir()
            with self.assertRaisesRegex(RuntimeError, 'already running'):
                refresh.main(['--download-only', '--cache-dir', str(root)])
            self.assertTrue((root / 'refresh.lock').exists())


if __name__ == '__main__':
    unittest.main()
