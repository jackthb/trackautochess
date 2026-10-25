import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    'workshop_refresh_pr', Path(__file__).with_name('workshop-refresh-pr.py'))
pr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pr)


MANIFEST = '5678485005516802387'
CREATED = '10/21/2026 09:20:25'


def _git(repo, *args, check=True, env=None):
    completed = subprocess.run(
        ['git', '-C', str(repo), *args],
        check=False,
        capture_output=True,
        env=env,
    )
    if check and completed.returncode != 0:
        detail = completed.stderr.decode() or completed.stdout.decode()
        raise RuntimeError(detail)
    return completed


def _git_init(repo):
    repo.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(['git', 'init', '-b', 'main', str(repo)])
    _git(repo, 'config', 'user.email', 'dev@example.com')
    _git(repo, 'config', 'user.name', 'Dev')
    (repo / 'content' / 'game').mkdir(parents=True)
    (repo / 'content' / 'patch-notes').mkdir(parents=True)
    (repo / 'data').mkdir(parents=True)
    (repo / 'content' / 'game' / 'old.json').write_text('{"v":1}\n', encoding='utf-8')
    (repo / 'README').write_text('base\n', encoding='utf-8')


def _commit_all(repo, message, bot=False):
    env = os.environ.copy()
    if bot:
        env.update({
            'GIT_AUTHOR_NAME': 'github-actions[bot]',
            'GIT_AUTHOR_EMAIL': '41898282+github-actions[bot]@users.noreply.github.com',
            'GIT_COMMITTER_NAME': 'github-actions[bot]',
            'GIT_COMMITTER_EMAIL': '41898282+github-actions[bot]@users.noreply.github.com',
        })
    _git(repo, 'add', '-A')
    _git(repo, 'commit', '-m', message, env=env)


def _rev(repo, ref='HEAD'):
    return _git(repo, 'rev-parse', ref).stdout.decode().strip()


def _origin_and_clone(root):
    origin = root / 'origin.git'
    subprocess.check_call(['git', 'init', '--bare', '-b', 'main', str(origin)])
    full = root / 'full'
    _git_init(full)
    _git(full, 'remote', 'add', 'origin', str(origin))
    return origin, full


def report(**extra):
    payload = {
        'status': 'refreshed',
        'workshop_id': '1613886175',
        'manifest_id': MANIFEST,
        'manifest_created_at': CREATED,
        'manifest_date': '2026-10-21',
        'vpk_sha256': 'abc',
        'vpk_bytes': 10,
        'lua_files': 4,
        'base_commit': '07cc8cac',
        'deterministic': True,
        'overlays_preserved': True,
        'full_checks': True,
        'last_seen': 'data/workshop-last-seen.json',
        'entity_changes': {
            'units': {
                'before': 2, 'after': 2,
                'added': [], 'removed': [], 'modified': [],
            },
        },
        'icon_changes': {
            'before': 1, 'after': 1, 'added': [], 'removed': [], 'modified': [],
        },
    }
    payload.update(extra)
    return payload


class PullRequestHelperTests(unittest.TestCase):
    def test_classify_refreshes_until_an_open_pr_records_the_manifest(self):
        self.assertEqual(pr.classify_run(MANIFEST, None, None, False), 'refresh')
        self.assertEqual(pr.classify_run(MANIFEST, None, MANIFEST, True), 'noop')
        self.assertEqual(pr.classify_run(MANIFEST, None, MANIFEST, False), 'pr-only')
        self.assertEqual(pr.classify_run(MANIFEST, MANIFEST, None, False), 'noop')
        self.assertEqual(pr.classify_run(MANIFEST, '1', '2', True), 'refresh')
        self.assertEqual(pr.classify_run(MANIFEST, None, MANIFEST, False, closed_pr=True), 'closed')
        self.assertEqual(pr.classify_run(MANIFEST, MANIFEST, MANIFEST, False, closed_pr=True), 'noop')
        with self.assertRaisesRegex(RuntimeError, 'manifest id'):
            pr.classify_run('', None, None, False)

    def test_closed_pr_for_the_same_manifest_is_not_reopened(self):
        pulls = [
            {'state': 'CLOSED', 'title': f'Refresh (manifest {MANIFEST})', 'body': 'old'},
            {'state': 'CLOSED', 'title': 'Refresh (manifest 111)', 'body': 'manifest 111'},
        ]
        self.assertTrue(pr.closed_pull_matches(pulls, MANIFEST))
        self.assertFalse(pr.closed_pull_matches(pulls, '222'))
        self.assertFalse(pr.closed_pull_matches(
            [{'state': 'OPEN', 'title': f'manifest {MANIFEST}', 'body': ''}], MANIFEST))
        published = {'time_updated': '1792574438', 'hcontent_file': MANIFEST}
        decision = pr.gate_decision(
            {},
            {'manifest_id': MANIFEST, 'time_updated': '1792574438'},
            [],
            pulls,
            published,
        )
        self.assertEqual(decision['decision'], 'closed')
        self.assertFalse(decision['download'])
        self.assertTrue(decision['unchanged'])

    def test_matching_time_updated_does_not_download(self):
        published = {'time_updated': '1792574438', 'hcontent_file': MANIFEST}
        decision = pr.gate_decision(
            {'time_updated': '1792574438', 'manifest_id': MANIFEST},
            {},
            [],
            [],
            published,
        )
        self.assertEqual(decision['decision'], 'noop')
        self.assertFalse(decision['download'])
        self.assertTrue(any('Skipping Workshop download' in line for line in decision['lines']))
        changed = pr.gate_decision(
            {'time_updated': '1', 'manifest_id': '1'},
            {},
            [],
            [],
            {'time_updated': '1793000000', 'hcontent_file': '999'},
        )
        self.assertEqual(changed['decision'], 'refresh')
        self.assertTrue(changed['download'])

    def test_bot_history_requires_the_committer_as_well_as_the_author(self):
        bot = 'github-actions[bot]\t41898282+github-actions[bot]@users.noreply.github.com'
        commits = pr.parse_commit_log(
            f'COMMIT\t{bot}\t{bot}\n'
            'content/game/u.json\n'
            '\n'
            f'COMMIT\t{bot}\tJack\tjack@x\n'
            'content/game/u.json\n'
            '\n'
            'COMMIT\tAda Lovelace\tada@example.com\tAda Lovelace\tada@example.com\n'
            'content/game/units/manual.json\n'
        )
        self.assertEqual(pr.foreign_authors(commits), [
            {'role': 'committer', 'name': 'Jack', 'email': 'jack@x'},
            {'role': 'author', 'name': 'Ada Lovelace', 'email': 'ada@example.com'},
        ])

    def test_changelog_range_includes_every_post_since_the_previous_update(self):
        ids = ['1792566239', '1792571846', '1792573504', '1792573595', '1792574438']
        entries = [
            {'date': '2026-10-21', 'time': '12:03am', 'sourceId': '1792566239',
             'excerpt': 'Now you can activate your steam battle pass', 'url': pr.changelog_url('1792566239')},
            {'date': '2026-10-21', 'time': '1:37am', 'sourceId': '1792571846',
             'excerpt': 'Fixed a number of bugs', 'url': pr.changelog_url('1792571846')},
            {'date': '2026-10-21', 'time': '2:05am', 'sourceId': '1792573504',
             'excerpt': 'Fixed a number of bugs', 'url': pr.changelog_url('1792573504')},
            {'date': '2026-10-21', 'time': '2:06am', 'sourceId': '1792573595',
             'excerpt': 'Fixed a number of bugs', 'url': pr.changelog_url('1792573595')},
            {'date': '2026-10-21', 'time': '2:20am', 'sourceId': '1792574438',
             'excerpt': 'Fix bug!', 'url': pr.changelog_url('1792574438')},
            {'date': '2026-10-21', 'time': '2:22am', 'sourceId': '1792574538',
             'excerpt': 'later', 'url': pr.changelog_url('1792574538')},
        ]
        selection = pr.select_changelog(
            entries, CREATED, '2026-10-21', time_updated='1792574438', since='1792566238',
        )
        self.assertEqual(selection['method'], 'range')
        self.assertEqual([entry['sourceId'] for entry in selection['matched']], ids)
        self.assertNotIn('same_day', selection)
        body = pr.render_body(
            report(time_updated='1792574438', previous_time_updated='1792566238'),
            selection,
        )
        for source_id in ids:
            self.assertIn(source_id, body)
        self.assertIn('steam battle pass', body)
        self.assertIn('Fix bug!', body)
        self.assertEqual(body.count('Fixed a number of bugs'), 1)
        self.assertNotIn('1792574538', body)
        self.assertNotIn('earlier publishes', body)
        bugfix = next(line for line in body.splitlines() if 'Fixed a number of bugs' in line)
        self.assertIn('1792571846', bugfix)
        self.assertIn('1792573504', bugfix)
        self.assertIn('1792573595', bugfix)
        self.assertNotIn('1792574438', bugfix)
        excluded = pr.select_changelog(
            entries, time_updated='1792574438', since='1792566239',
        )
        self.assertNotIn('1792566239', [entry['sourceId'] for entry in excluded['matched']])
        self.assertEqual(excluded['matched'][0]['sourceId'], '1792571846')

    def test_identical_excerpts_share_one_bullet_and_saved_notes_are_labeled(self):
        fix = 'Fix bug!'
        ids = ['1792571846', '1792573504', '1792573595', '1792574438']
        entries = [
            {'date': '2026-10-21', 'time': '12:03am', 'sourceId': '1792566239',
             'excerpt': 'Now you can activate your steam battle pass',
             'url': pr.changelog_url('1792566239'), 'origin': 'saved-patch-notes'},
        ]
        for source_id, clock in zip(ids, ('1:37am', '2:05am', '2:06am', '2:20am')):
            entries.append({
                'date': '2026-10-21', 'time': clock, 'sourceId': source_id,
                'excerpt': fix, 'url': pr.changelog_url(source_id),
                'origin': 'saved-patch-notes',
            })
        selection = pr.select_changelog(
            entries, time_updated='1792574438', since='1792566238',
        )
        body = pr.render_body(
            report(time_updated='1792574438', previous_time_updated='1792566238'),
            selection,
        )
        self.assertEqual(body.count(fix), 1)
        self.assertEqual(body.count('\n- '), 2)
        self.assertIn('saved in the repository', body)
        self.assertIn('may be missing', body)
        self.assertNotIn('were posted after the previously recorded update', body)
        bug_line = next(line for line in body.splitlines() if fix in line)
        for source_id in ids:
            self.assertIn(source_id, bug_line)
        self.assertNotIn('1792566239', bug_line)

    def test_published_file_time_is_a_fallback_link(self):
        selection = pr.select_changelog([], CREATED, '2026-10-21', time_updated='1792574438')
        self.assertEqual(selection['method'], 'published-file')
        self.assertEqual(selection['matched'][0]['url'], pr.changelog_url('1792574438'))
        missing = pr.select_changelog([], CREATED, '2026-10-21', time_updated='')
        self.assertEqual(missing['method'], 'none')
        self.assertEqual(missing['matched'], [])

    def test_body_includes_the_report_counts_and_changelog_link(self):
        selection = pr.select_changelog([
            {'date': '2026-10-21', 'time': '2:20am', 'sourceId': '1792574438',
             'excerpt': 'Fix bug!', 'url': pr.changelog_url('1792574438')},
        ], CREATED, '2026-10-21', time_updated='1792574438')
        body = pr.render_body(report(), selection, run_url='https://example.test/run/1')
        self.assertIn('"manifest_id": "5678485005516802387"', body)
        self.assertIn('| units | 2 | 2 | 0 | 0 | 0 |', body)
        self.assertIn('https://steamcommunity.com/sharedfiles/filedetails/changelog/1613886175#1792574438', body)
        self.assertIn('Fix bug!', body)
        self.assertIn('does not merge', body)
        self.assertIn('were not committed', body)
        self.assertNotIn('vpk_path', body)
        self.assertNotIn('did not parse', body)

    def test_render_uses_the_report_time_without_calling_steam(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'report.json').write_text(json.dumps(report(time_updated='1792574438')), encoding='utf-8')
            (root / 'changelog.json').write_text('[]\n', encoding='utf-8')
            (root / 'error.txt').write_text('Steam changelog page 1 is not a usable Steam page (missing-paging-header).\n', encoding='utf-8')
            output = root / 'body.md'

            def explode(*_args, **_kwargs):
                raise AssertionError('steam')

            original = pr.refresh.fetch_published_file
            pr.refresh.fetch_published_file = explode
            try:
                self.assertEqual(pr.main([
                    'render', '--report', str(root / 'report.json'),
                    '--changelog', str(root / 'changelog.json'),
                    '--changelog-error', str(root / 'error.txt'),
                    '--output', str(output),
                ]), 0)
            finally:
                pr.refresh.fetch_published_file = original
            body = output.read_text(encoding='utf-8')
            self.assertIn('#1792574438', body)
            self.assertIn('missing-paging-header', body)
            self.assertIn('did not install a browser', body)
            self.assertNotIn('did not parse', body)

    def test_recorded_at_alone_is_not_a_substantive_change(self):
        before = {'manifest_id': MANIFEST, 'recorded_at': 't1', 'time_updated': '1792574438'}
        after = {'manifest_id': MANIFEST, 'recorded_at': 't2', 'time_updated': '1792574438'}
        self.assertFalse(pr.substantive_last_seen_change(before, after))
        after['manifest_id'] = '999'
        self.assertTrue(pr.substantive_last_seen_change(before, after))

    def test_previous_time_updated_comes_from_the_default_branch_record(self):
        self.assertEqual(pr.previous_time_updated({'time_updated': '1792566238', 'manifest_id': '1'}), '1792566238')
        self.assertEqual(pr.previous_time_updated({'manifest_id': '1'}), '')
        self.assertEqual(pr.previous_time_updated({}), '')

    def test_workflow_refuses_artifacts_and_auto_merge(self):
        workflow = Path(__file__).resolve().parents[1] / '.github/workflows/workshop-refresh.yml'
        text = workflow.read_text(encoding='utf-8')
        self.assertIn('workflow_dispatch:', text)
        self.assertIn('cron: "0 */6 * * *"', text)
        self.assertIn('workshop-data-refresh', text)
        self.assertIn('--full-checks', text)
        self.assertIn('--draft', text)
        self.assertIn('data/workshop-last-seen.json', text)
        self.assertNotIn('actions/upload-artifact@v', text)
        self.assertNotIn('gh pr merge', text)
        self.assertNotIn('gh pr reopen', text)
        self.assertNotIn('automerge', text)
        self.assertNotRegex(text, r'push --force(?!-with-lease)')
        self.assertNotRegex(text, r'(?<!-)push -f(\s|$)')
        self.assertIn('force-with-lease', text)
        self.assertNotIn('persist-credentials: true', text)
        self.assertEqual(text.count('persist-credentials: false'), 2)
        self.assertEqual(text.count('contents: write'), 1)
        self.assertEqual(text.count('pull-requests: write'), 1)
        self.assertNotIn('rsync', text)
        self.assertNotIn('|| true', text)
        self.assertNotIn('npx playwright', text)
        self.assertNotIn('playwright install', text)
        self.assertNotIn('PLAYWRIGHT_', text)
        self.assertIn('content/patch-notes', text)
        self.assertIn('--since=', text)
        self.assertIn('--until=', text)
        self.assertNotIn('--around=', text)
        self.assertNotIn('around-stamps', text)
        self.assertNotIn('content-excludes', text)
        self.assertIn('previous_time_updated', text)
        self.assertIn('time_updated', text)
        self.assertIn('--state closed', text)
        self.assertIn('gh auth setup-git', text)
        self.assertIn('upload-artifact', text)
        self.assertIn('download-artifact', text)
        self.assertIn('Automatically delete head branches', text)
        publish = text.split('publish:', 1)[1]
        prepare = text.split('publish:', 1)[0]
        self.assertIn('contents: write', publish)
        self.assertNotIn('contents: write', prepare)
        self.assertNotIn('actions: write', text)
        self.assertNotIn('actions: read', text)
        self.assertNotIn('does not delete the branch or its previous commits', text)
        self.assertIn('committed by github-actions[bot]', text)
        self.assertIn('Merge or close the pull request, or remove the non-bot commit', text)
        self.assertLess(prepare.index('gh auth setup-git'), prepare.index('git fetch'))
        self.assertLess(publish.index('gh auth setup-git'), publish.index('git fetch'))
        self.assertIn('fetch-depth: 0', publish)
        self.assertNotIn('fetch-depth: 1', publish)
        self.assertIn('fetch-depth: 1', prepare)
        self.assertIn('GH_TOKEN: ${{ github.token }}', publish)
        self.assertIn('GH_TOKEN: ${{ github.token }}', prepare)
        pin = pr.refresh.DOWNLOADER_ARCHIVES['linux-x64']
        self.assertIn(pin['archive_sha256'], text)
        self.assertIn(pin['binary_sha256'], text)
        self.assertIn('021a40fa28eece9909dfce6f2b55abfd39fff22ac4a4a18ddf7a10afa4c1232f', text)
        self.assertIn('9b943b94bc8f55efb993aad8e44b538e6b091e60a9e4a944dcde869855f233e3', text)
        self.assertIn('1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce', text)
        self.assertNotIn('e58a0612f6156ad287ff392c681f6e1154d0c938feccf631d0c5d7abf3bbf81a', text)
        self.assertNotIn('88817c574c1838a39f88fda0bbd043b4481fd385fb10e92c323e230844d636ce', text)
        self.assertNotIn('ebc74fc5b94830176a3c2914ae96bd8bc7f6a91f4f33890230f84a172ee61ccc', text)

    def test_shallow_publish_fails_and_full_history_rebuilds_from_main(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            origin, full = _origin_and_clone(root)
            _commit_all(full, 'old main')
            _git(full, 'push', 'origin', 'main')
            _git(full, 'checkout', '-b', 'workshop-data-refresh')
            (full / 'content' / 'game' / 'old.json').write_text('{"v":2}\n', encoding='utf-8')
            (full / 'data' / 'workshop-last-seen.json').write_text(
                json.dumps({'manifest_id': MANIFEST, 'recorded_at': 't1'}) + '\n', encoding='utf-8')
            _commit_all(full, 'Refresh Workshop game data from manifest ' + MANIFEST, bot=True)
            stale = _rev(full)
            _git(full, 'push', 'origin', 'workshop-data-refresh')
            _git(full, 'checkout', 'main')
            (full / 'content' / 'patch-notes' / 'note.json').write_text('{}\n', encoding='utf-8')
            (full / 'content' / 'game' / 'from-main.json').write_text('{"from":"main"}\n', encoding='utf-8')
            _commit_all(full, 'newer main')
            new_main = _rev(full)
            _git(full, 'push', 'origin', 'main')

            shallow = root / 'shallow'
            subprocess.check_call(['git', 'clone', '--depth', '1', '--branch', 'main', f'file://{origin}', str(shallow)])
            self.assertEqual(_git(shallow, 'rev-parse', '--is-shallow-repository').stdout.decode().strip(), 'true')
            _git(shallow, 'fetch', '--depth', '1', 'origin',
                 '+refs/heads/workshop-data-refresh:refs/remotes/origin/workshop-data-refresh')
            _git(shallow, 'worktree', 'add', '--detach', str(root / 'shallow-work'), 'origin/workshop-data-refresh')
            merged = _git(root / 'shallow-work', 'merge', '--no-edit', 'origin/main', check=False)
            self.assertNotEqual(merged.returncode, 0)
            self.assertIn('unrelated histories', merged.stderr.decode())
            committed = _git(root / 'shallow-work', 'commit', '--no-edit', check=False)
            self.assertNotEqual(committed.returncode, 0)

            publish = root / 'publish'
            subprocess.check_call(['git', 'clone', f'file://{origin}', str(publish)])
            action = pr.publish_tree(
                publish, root / 'pr-branch', 'main', 'workshop-data-refresh',
                'pr-only', MANIFEST, open_pr=False,
            )
            self.assertTrue(action.startswith('push-lease:'), action)
            expected = action.split(':', 1)[1]
            self.assertEqual(expected, stale)
            _git(
                root / 'pr-branch', 'push',
                f'--force-with-lease=refs/heads/workshop-data-refresh:{expected}',
                'origin', 'HEAD:refs/heads/workshop-data-refresh',
            )
            work = root / 'pr-branch'
            self.assertEqual(_rev(work, 'HEAD^'), new_main)
            self.assertEqual((work / 'content' / 'game' / 'old.json').read_text(encoding='utf-8'), '{"v":2}\n')
            self.assertTrue((work / 'content' / 'game' / 'from-main.json').is_file())
            self.assertTrue((work / 'content' / 'patch-notes' / 'note.json').is_file())
            self.assertEqual(_git(origin, 'cat-file', '-t', stale).stdout.decode().strip(), 'commit')
            self.assertNotEqual(_rev(origin, 'refs/heads/workshop-data-refresh'), stale)
            self.assertEqual(
                _git(work, 'log', '-1', '--format=%an %ae').stdout.decode().strip(),
                'github-actions[bot] 41898282+github-actions[bot]@users.noreply.github.com',
            )
            log = Path('/opt/cursor/artifacts/publish-rebuild.log')
            if log.parent.is_dir():
                log.write_text(
                    '\n'.join([
                        'shallow clone of main plus depth-1 fetch of workshop-data-refresh',
                        f'shallow merge rc={merged.returncode}',
                        merged.stderr.decode().strip(),
                        f'git commit --no-edit rc={committed.returncode}',
                        (committed.stdout.decode().strip() or committed.stderr.decode().strip()),
                        f'stale={stale}',
                        f'main={new_main}',
                        f'rebuild_parent={_rev(work, "HEAD^")}',
                        f'rebuild_tip={_rev(work)}',
                        f'action={action}',
                        'old commit still in the bare repo; the branch ref was moved and not deleted',
                        f'cat-file={_git(origin, "cat-file", "-t", stale).stdout.decode().strip()}',
                    ]) + '\n',
                    encoding='utf-8',
                )

    def test_open_bot_pull_request_rebuilds_the_new_refresh_from_main(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            origin, full = _origin_and_clone(root)
            (full / 'content' / 'game' / 'u.json').write_text('{"a":1}\n', encoding='utf-8')
            _commit_all(full, 'base')
            _git(full, 'push', 'origin', 'main')
            main_sha = _rev(full)
            _git(full, 'checkout', '-b', 'workshop-data-refresh')
            (full / 'content' / 'game' / 'u.json').write_text('{"a":2}\n', encoding='utf-8')
            (full / 'data' / 'workshop-last-seen.json').write_text(
                '{"manifest_id":"111","time_updated":"1"}\n', encoding='utf-8')
            _commit_all(full, 'bot refresh', bot=True)
            data_sha = _rev(full)
            _git(full, 'push', 'origin', 'workshop-data-refresh')
            _git(full, 'checkout', 'main')
            (full / 'content' / 'game' / 'u.json').write_text('{"a":3}\n', encoding='utf-8')
            (full / 'data').mkdir(parents=True, exist_ok=True)
            (full / 'data' / 'workshop-last-seen.json').write_text(
                '{"manifest_id":"222","time_updated":"2"}\n', encoding='utf-8')
            patch = root / 'refresh.patch'
            pr.write_refresh_patch(full, patch)
            publish = root / 'publish'
            subprocess.check_call(['git', 'clone', f'file://{origin}', str(publish)])
            action = pr.publish_tree(
                publish, root / 'pr-branch', 'main', 'workshop-data-refresh',
                'refresh', '222', patch=patch, open_pr=True,
            )
            self.assertTrue(action.startswith('push-lease:'), action)
            self.assertEqual(action.split(':', 1)[1], data_sha)
            work = root / 'pr-branch'
            self.assertEqual((work / 'content' / 'game' / 'u.json').read_text(encoding='utf-8'), '{"a":3}\n')
            self.assertIn('"manifest_id":"222"', (work / 'data' / 'workshop-last-seen.json').read_text(encoding='utf-8'))
            self.assertEqual(_rev(work, 'HEAD^'), main_sha)
            self.assertEqual(_rev(origin, 'refs/heads/workshop-data-refresh'), data_sha)

    def test_amended_bot_commit_is_not_force_pushed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            origin, full = _origin_and_clone(root)
            (full / 'content' / 'game' / 'u.json').write_text('{"a":1}\n', encoding='utf-8')
            (full / 'content' / 'game' / 'v.json').write_text('{"b":1}\n', encoding='utf-8')
            _commit_all(full, 'base')
            _git(full, 'push', 'origin', 'main')
            _git(full, 'checkout', '-b', 'workshop-data-refresh')
            (full / 'data' / 'workshop-last-seen.json').write_text(
                '{"manifest_id":"111","time_updated":"1"}\n', encoding='utf-8')
            _commit_all(full, 'bot refresh', bot=True)
            (full / 'content' / 'game' / 'u.json').write_text('{"a":42,"hand":"fix"}\n', encoding='utf-8')
            _git(full, 'add', '-A')
            _git(full, 'commit', '--amend', '--no-edit')
            amended = _rev(full)
            _git(full, 'push', 'origin', 'workshop-data-refresh')
            _git(full, 'checkout', 'main')
            (full / 'content' / 'game' / 'v.json').write_text('{"b":2}\n', encoding='utf-8')
            (full / 'data').mkdir(parents=True, exist_ok=True)
            (full / 'data' / 'workshop-last-seen.json').write_text(
                '{"manifest_id":"222","time_updated":"2"}\n', encoding='utf-8')
            patch = root / 'refresh.patch'
            pr.write_refresh_patch(full, patch)
            publish = root / 'publish'
            subprocess.check_call(['git', 'clone', f'file://{origin}', str(publish)])
            with self.assertRaisesRegex(
                RuntimeError,
                r'committer Dev <dev@example.com>.*Merge or close the pull request, or remove the non-bot commit',
            ):
                pr.publish_tree(
                    publish, root / 'pr-branch', 'main', 'workshop-data-refresh',
                    'refresh', '222', patch=patch, open_pr=False,
                )
            self.assertEqual(_rev(origin, 'refs/heads/workshop-data-refresh'), amended)
            kept = _git(origin, 'show', f'{amended}:content/game/u.json').stdout.decode()
            self.assertIn('"hand":"fix"', kept)

    def test_human_commit_on_an_open_pull_request_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            origin, full = _origin_and_clone(root)
            (full / 'content' / 'game' / 'u.json').write_text('{"a":1}\n', encoding='utf-8')
            _commit_all(full, 'base')
            _git(full, 'push', 'origin', 'main')
            _git(full, 'checkout', '-b', 'workshop-data-refresh')
            (full / 'content' / 'game' / 'u.json').write_text('{"a":2}\n', encoding='utf-8')
            _commit_all(full, 'bot refresh', bot=True)
            (full / 'content' / 'game' / 'u.json').write_text('{"a":42}\n', encoding='utf-8')
            _commit_all(full, 'human edit', bot=False)
            human = _rev(full)
            _git(full, 'push', 'origin', 'workshop-data-refresh')
            _git(full, 'checkout', 'main')
            (full / 'content' / 'game' / 'u.json').write_text('{"a":3}\n', encoding='utf-8')
            patch = root / 'refresh.patch'
            pr.write_refresh_patch(full, patch)
            publish = root / 'publish'
            subprocess.check_call(['git', 'clone', f'file://{origin}', str(publish)])
            with self.assertRaisesRegex(
                RuntimeError,
                'Merge or close the pull request, or remove the non-bot commit',
            ):
                pr.publish_tree(
                    publish, root / 'pr-branch', 'main', 'workshop-data-refresh',
                    'refresh', MANIFEST, patch=patch, open_pr=True,
                )
            self.assertEqual(_rev(origin, 'refs/heads/workshop-data-refresh'), human)

    def test_non_bot_history_without_an_open_pr_is_left_in_place(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            origin, full = _origin_and_clone(root)
            _commit_all(full, 'base')
            _git(full, 'push', 'origin', 'main')
            _git(full, 'checkout', '-b', 'workshop-data-refresh')
            (full / 'content' / 'game' / 'old.json').write_text('{"v":2}\n', encoding='utf-8')
            _commit_all(full, 'human edit', bot=False)
            human = _rev(full)
            _git(full, 'push', 'origin', 'workshop-data-refresh')
            publish = root / 'publish'
            subprocess.check_call(['git', 'clone', f'file://{origin}', str(publish)])
            with self.assertRaisesRegex(
                RuntimeError,
                'Merge or close the pull request, or remove the non-bot commit',
            ):
                pr.publish_tree(
                    publish, root / 'pr-branch', 'main', 'workshop-data-refresh',
                    'pr-only', MANIFEST, open_pr=False,
                )
            self.assertEqual(_rev(origin, 'refs/heads/workshop-data-refresh'), human)

    def test_recorded_at_patch_skips_the_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            origin, full = _origin_and_clone(root)
            (full / 'data' / 'workshop-last-seen.json').write_text(
                json.dumps({'manifest_id': MANIFEST, 'recorded_at': 't1'}) + '\n', encoding='utf-8')
            _commit_all(full, 'base')
            _git(full, 'push', 'origin', 'main')
            base = _rev(full)
            seen = json.loads((full / 'data' / 'workshop-last-seen.json').read_text(encoding='utf-8'))
            seen['recorded_at'] = 't2'
            (full / 'data' / 'workshop-last-seen.json').write_text(json.dumps(seen) + '\n', encoding='utf-8')
            _git(full, 'add', 'data/workshop-last-seen.json')
            patch = root / 'refresh.patch'
            patch.write_bytes(_git(full, 'diff', '--cached', '--binary', '--no-renames').stdout)
            publish = root / 'publish'
            subprocess.check_call(['git', 'clone', f'file://{origin}', str(publish)])
            action = pr.publish_tree(
                publish, root / 'pr-branch', 'main', 'workshop-data-refresh',
                'refresh', MANIFEST, patch=patch, open_pr=False,
            )
            self.assertEqual(action, 'skip')
            self.assertEqual(_rev(origin, 'refs/heads/main'), base)

    def test_write_patch_leaves_patch_notes_out(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo = root / 'repo'
            _git_init(repo)
            (repo / 'content' / 'game' / 'old.json').write_text('{"v":1}\n', encoding='utf-8')
            (repo / 'content' / 'patch-notes' / 'note.json').write_text('{}\n', encoding='utf-8')
            _commit_all(repo, 'base')
            (repo / 'content' / 'game' / 'old.json').write_text('{"v":2}\n', encoding='utf-8')
            (repo / 'content' / 'patch-notes' / 'note.json').write_text('{"changed":true}\n', encoding='utf-8')
            dest = root / 'refresh.patch'
            pr.write_refresh_patch(repo, dest)
            text = dest.read_text(encoding='utf-8')
            self.assertIn('content/game/old.json', text)
            self.assertNotIn('content/patch-notes/note.json', text)
            self.assertEqual((repo / 'content' / 'patch-notes' / 'note.json').read_text(encoding='utf-8'), '{"changed":true}\n')
            self.assertEqual(_git(repo, 'diff', '--cached', '--name-only').stdout, b'')

    def test_symlink_diff_is_rejected(self):
        raw = b'diff --git a/content/game/link.json b/content/game/link.json\nnew file mode 120000\n'
        self.assertTrue(pr.patch_has_symlink(raw))
        with self.assertRaisesRegex(RuntimeError, 'symlink'):
            with tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / 'bad.patch'
                path.write_bytes(raw)
                pr.apply_refresh_patch(Path(temp), path)


if __name__ == '__main__':
    unittest.main()
