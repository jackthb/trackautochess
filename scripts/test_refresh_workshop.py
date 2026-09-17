import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
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
            self.assertEqual(report['vpk_sha256'], refresh.sha256(Path(report['vpk_path'])))
            self.assertFalse((root / 'content').exists())
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

    def test_existing_lock_prevents_second_run(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'refresh.lock').mkdir()
            with self.assertRaisesRegex(RuntimeError, 'already running'):
                refresh.main(['--download-only', '--cache-dir', str(root)])
            self.assertTrue((root / 'refresh.lock').exists())


if __name__ == '__main__':
    unittest.main()
