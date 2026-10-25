#!/usr/bin/env python3
"""Decide whether a Workshop manifest changed, and render the draft PR body.

The workflow reads Steam's published-file time_updated before downloading.
This helper turns that record and the last-seen files into a gate decision,
builds the data-branch commit from the refresh diff, and renders report.json
into the pull request body. It does not merge the pull request.
"""
import argparse
import importlib.util
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


CHANGELOG_URL = 'https://steamcommunity.com/sharedfiles/filedetails/changelog/1613886175'
SUMMARY_KEYS = (
    'status', 'workshop_id', 'manifest_id', 'manifest_created_at', 'manifest_date',
    'time_updated', 'vpk_sha256', 'vpk_bytes', 'lua_files', 'base_commit',
    'downloader_sha256', 'deterministic', 'overlays_preserved', 'full_checks',
    'last_seen', 'started_at', 'finished_at',
)
BOT_NAME = 'github-actions[bot]'
BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com'


def load_refresh():
    path = Path(__file__).resolve().with_name('refresh-workshop.py')
    spec = importlib.util.spec_from_file_location('refresh_workshop', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


refresh = load_refresh()


def read_json(path):
    if path is None:
        return {}
    file = Path(path)
    if not file.is_file():
        return {}
    return json.loads(file.read_text(encoding='utf-8'))


def classify_run(downloaded_manifest, default_manifest, branch_manifest, open_pr, closed_pr=False):
    """Return noop, closed, pr-only, or refresh.

    noop: this manifest is already on the default branch, or an open draft PR
    already records it. closed: a pull request for this same manifest was
    closed, so this run must not open or reopen one. pr-only: the fixed branch
    already has the commit but no open or closed PR (the previous run pushed
    and then failed to open the PR). refresh: the manifest is new.
    """
    if not downloaded_manifest:
        raise RuntimeError('Download did not record a manifest id')
    downloaded_manifest = str(downloaded_manifest)
    if default_manifest and downloaded_manifest == str(default_manifest):
        return 'noop'
    if closed_pr:
        return 'closed'
    if branch_manifest and downloaded_manifest == str(branch_manifest):
        return 'noop' if open_pr else 'pr-only'
    return 'refresh'


def closed_pull_matches(pulls, manifest_id):
    """True when a closed or merged PR already names this manifest."""
    manifest_id = str(manifest_id or '')
    if not manifest_id:
        return False
    for pull in pulls or []:
        if not isinstance(pull, dict):
            continue
        state = str(pull.get('state') or '').upper()
        if state == 'OPEN':
            continue
        text = '\n'.join(str(pull.get(key) or '') for key in ('title', 'body'))
        if manifest_id in text:
            return True
    return False


def is_bot_author(name, email):
    return name == BOT_NAME and email == BOT_EMAIL


def parse_commit_log(text):
    """Parse ``git log --format=COMMIT%x09%an%x09%ae%x09%cn%x09%ce --name-only``."""
    commits = []
    current = None
    for line in text.splitlines():
        if line.startswith('COMMIT\t'):
            parts = line.split('\t')
            if len(parts) < 3:
                continue
            current = {
                'name': parts[1],
                'email': parts[2],
                'committer_name': parts[3] if len(parts) > 3 else '',
                'committer_email': parts[4] if len(parts) > 4 else '',
                'files': [],
            }
            commits.append(current)
            continue
        if current is not None and line.strip():
            current['files'].append(line.strip())
    return commits


def foreign_authors(commits):
    """Author or committer identities that are not the bot.

    An amend, rebase, or cherry-pick can keep the bot as author and still
    record a person as committer. Both have to match.
    """
    found = []
    seen = set()
    for commit in commits:
        author_bot = is_bot_author(commit.get('name'), commit.get('email'))
        committer_bot = is_bot_author(commit.get('committer_name'), commit.get('committer_email'))
        if author_bot and committer_bot:
            continue
        if not author_bot:
            key = ('author', commit.get('name') or '', commit.get('email') or '')
        else:
            key = ('committer', commit.get('committer_name') or '', commit.get('committer_email') or '')
        if key in seen:
            continue
        seen.add(key)
        found.append({'role': key[0], 'name': key[1], 'email': key[2]})
    return found


def effective_manifest(record, published):
    """Manifest id to compare, treating a matching time_updated as this publish."""
    if not isinstance(record, dict) or not record:
        return None
    recorded_time = str(record.get('time_updated') or '')
    current_time = str((published or {}).get('time_updated') or '')
    recorded_manifest = str(record.get('manifest_id') or '')
    current_manifest = str((published or {}).get('hcontent_file') or '')
    if recorded_time and recorded_time == current_time:
        return current_manifest or recorded_manifest or None
    return recorded_manifest or None


def recorded_report(record, published):
    manifest_id = str((published or {}).get('hcontent_file') or record.get('manifest_id') or '')
    created_at = record.get('manifest_created_at')
    manifest_date = record.get('manifest_date')
    if not manifest_date and published and str(published.get('time_updated') or '').isdigit():
        manifest_date = datetime.fromtimestamp(
            int(published['time_updated']), timezone.utc).date().isoformat()
    return {
        'status': 'already-recorded',
        'workshop_id': refresh.WORKSHOP_ID,
        'manifest_id': manifest_id,
        'manifest_created_at': created_at,
        'manifest_date': manifest_date,
        'time_updated': str((published or {}).get('time_updated') or record.get('time_updated') or ''),
        'vpk_sha256': record.get('vpk_sha256'),
        'vpk_bytes': record.get('vpk_bytes'),
        'last_seen': refresh.LAST_SEEN_RELATIVE.as_posix(),
    }


def gate_decision(default_record, branch_record, open_pulls, closed_pulls, published):
    manifest = str(published.get('hcontent_file') or '')
    open_pr = any(str(pull.get('state') or '').upper() == 'OPEN' for pull in open_pulls or [])
    closed = closed_pull_matches(closed_pulls, manifest)
    decision = classify_run(
        manifest,
        effective_manifest(default_record, published),
        effective_manifest(branch_record, published),
        open_pr,
        closed_pr=closed,
    )
    unchanged, lines = refresh.format_published_check(published, [default_record, branch_record])
    # An unchanged publish is never a fresh download, even when the recorded
    # file has no manifest id yet and only time_updated matched.
    if unchanged and decision == 'refresh':
        decision = 'noop'
    return {
        'decision': decision,
        'download': decision == 'refresh',
        'unchanged': unchanged,
        'lines': lines,
        'manifest_id': manifest,
        'time_updated': str(published.get('time_updated') or ''),
        'previous_time_updated': previous_time_updated(default_record),
        'closed': closed,
    }


def previous_time_updated(record):
    """Last merged publish time. The data branch's in-progress record is not this bound."""
    if not isinstance(record, dict):
        return ''
    value = str(record.get('time_updated') or '')
    return value if value.isdigit() else ''


def changelog_url(source_id=None):
    if source_id:
        return f'{CHANGELOG_URL}#{source_id}'
    return CHANGELOG_URL


def source_stamp(entry):
    source_id = str((entry or {}).get('sourceId') or '')
    if not source_id.isdigit():
        return None
    return int(source_id)


def in_update_range(stamp, since, until):
    """Posts after the previous time_updated and through the current one."""
    if stamp is None or until is None:
        return False
    if stamp > until:
        return False
    if since is None:
        return stamp == until
    return stamp > since


def select_changelog(entries, manifest_created_at=None, manifest_date=None, time_updated=None, since=None):
    """Changelog posts in (previous time_updated, current time_updated].

    manifest_created_at and manifest_date stay in the signature so older
    callers still pass them. The range is the two publish times.
    """
    del manifest_created_at, manifest_date
    until = int(time_updated) if str(time_updated or '').isdigit() else None
    lower = int(since) if str(since or '').isdigit() else None
    matched = [
        entry for entry in entries or []
        if in_update_range(source_stamp(entry), lower, until)
    ]
    matched.sort(key=lambda entry: source_stamp(entry) or 0)
    method = 'range' if matched else None
    if not matched and until is not None:
        stamp = datetime.fromtimestamp(until, timezone.utc)
        matched = [{
            'date': stamp.date().isoformat(),
            'time': None,
            'sourceId': str(until),
            'excerpt': None,
            'docsUrl': None,
            'url': changelog_url(until),
            'synthetic': True,
        }]
        method = 'published-file'
    if method is None:
        method = 'none'
    return {'matched': matched, 'method': method, 'since': None if lower is None else str(lower), 'until': None if until is None else str(until)}


def _cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def _excerpt(entry):
    return (entry.get('excerpt') or '').strip()


def _bullet(entries):
    """One bullet. Consecutive posts with the same excerpt share its links."""
    if isinstance(entries, dict):
        entries = [entries]
    links = []
    for entry in entries:
        when = ' '.join(part for part in (entry.get('date'), entry.get('time')) if part)
        label = when or f"update {entry.get('sourceId')}"
        url = entry.get('url') or changelog_url(entry.get('sourceId'))
        links.append(f'[{label}]({url})')
    line = '- ' + ', '.join(links)
    excerpt = _excerpt(entries[0])
    if excerpt:
        line += f' — {_cell(excerpt)}'
    docs = []
    for entry in entries:
        docs_url = entry.get('docsUrl')
        if docs_url and docs_url not in docs:
            docs.append(docs_url)
    for docs_url in docs:
        line += f' ([notes]({docs_url}))'
    return line


def _bullet_lines(entries):
    groups = []
    for entry in entries:
        excerpt = _excerpt(entry)
        if groups and excerpt and excerpt == _excerpt(groups[-1][0]):
            groups[-1].append(entry)
            continue
        groups.append([entry])
    return [_bullet(group) for group in groups]


def _from_saved_notes(entries):
    return any(entry.get('origin') == 'saved-patch-notes' for entry in entries)


def _names(items, limit=40):
    shown, extra = items[:limit], max(0, len(items) - limit)
    lines = []
    for item in shown:
        if isinstance(item, dict):
            lines.append(f"- `{item['file']}` — {_cell(item.get('name') or '')}")
        else:
            lines.append(f'- `{item}`')
    if extra:
        lines.append(f'- …and {extra} more')
    return lines


def render_body(report, selection, run_url=None, changelog_error=None):
    summary = {key: report[key] for key in SUMMARY_KEYS if key in report}
    lines = [
        'Draft for review. This workflow does not merge and does not set `entitiesSynced`.',
        '',
        '## Report',
        '',
        '```json',
        json.dumps(summary, indent=2),
        '```',
        '',
        '## Entity and count changes',
        '',
    ]
    changes = report.get('entity_changes') or {}
    if not changes:
        lines.append('Entity counts were not recomputed for this run.')
    else:
        lines.extend([
            '| Category | Before | After | Added | Removed | Modified |',
            '| --- | ---: | ---: | ---: | ---: | ---: |',
        ])
        for category, info in changes.items():
            lines.append(
                f"| {_cell(category)} | {info['before']} | {info['after']} | "
                f"{len(info['added'])} | {len(info['removed'])} | {len(info['modified'])} |"
            )
        for category, info in changes.items():
            for label, key in (('Added', 'added'), ('Removed', 'removed'), ('Modified', 'modified')):
                if not info[key]:
                    continue
                lines.extend(['', f'### {label} {category}', ''])
                lines.extend(_names(info[key]))
    icons = report.get('icon_changes')
    if icons:
        lines.extend([
            '',
            '## Icons',
            '',
            f"Before {icons['before']}, after {icons['after']}. "
            f"Added {len(icons['added'])}, removed {len(icons['removed'])}, "
            f"modified {len(icons['modified'])}.",
        ])
        for label, key in (('Added icons', 'added'), ('Removed icons', 'removed'), ('Modified icons', 'modified')):
            if icons[key]:
                lines.extend(['', f'### {label}', ''])
                lines.extend(_names(icons[key]))
    lines.extend(['', '## Steam changelog', ''])
    if changelog_error:
        lines.extend([
            'The changelog emit failed. This run did not install a browser.',
            '',
            '```',
            str(changelog_error).strip()[:4000],
            '```',
            '',
        ])
    matched = selection.get('matched') or []
    if matched:
        if _from_saved_notes(matched):
            lines.append(
                'These entries come from patch notes already saved in the repository. '
                'Steam did not return this range, so a newer post may be missing.'
            )
        elif selection.get('method') == 'range' and selection.get('since'):
            lines.append(
                'These changelog entries were posted after the previously recorded update '
                'and through this publish.'
            )
        elif selection.get('method') == 'range':
            lines.append(
                'These changelog entries match this publish. '
                'No earlier recorded update was available, so older posts were left out.'
            )
        elif selection.get('method') == 'published-file':
            lines.append(
                'No changelog paragraph was parsed for this publish. '
                'The published-file update time is the changelog id.'
            )
        lines.append('')
        lines.extend(_bullet_lines(matched))
    else:
        lines.append(
            f'No changelog entry matched this publish. '
            f'Index: {changelog_url()}'
        )
    lines.extend([
        '',
        'The VPK and extracted Lua were not committed and were not uploaded as artifacts.',
    ])
    if run_url:
        lines.extend(['', f'Workflow run: {run_url}'])
    return '\n'.join(lines).rstrip() + '\n'


def substantive_last_seen_change(before, after):
    """True when last-seen changed by more than recorded_at."""
    def normalize(payload):
        if not isinstance(payload, dict):
            return {}
        copy = dict(payload)
        copy.pop('recorded_at', None)
        return copy

    return normalize(before) != normalize(after)


def write_github_output(path, values):
    with Path(path).open('a', encoding='utf-8') as handle:
        for key, value in values.items():
            text = '' if value is None else str(value)
            if '\n' in text:
                raise RuntimeError(f'GitHub output {key} contains a newline')
            handle.write(f'{key}={text}\n')


PATCH_NOTE_EXCLUDES = (
    'content/patch-notes',
    'content/patch-notes/*',
    'content/patch-notes/**',
)
GENERATED_PATHS = ('content', 'data/icons', 'data/workshop-last-seen.json')


def _git(repo, *args, check=True):
    completed = subprocess.run(
        ['git', '-C', str(repo), *args],
        check=False,
        capture_output=True,
    )
    if check and completed.returncode != 0:
        detail = completed.stderr.decode('utf-8', 'replace').strip() or completed.stdout.decode('utf-8', 'replace').strip()
        raise RuntimeError(f"git {' '.join(args)} failed ({completed.returncode}): {detail}")
    return completed


def _text(completed):
    return completed.stdout.decode('utf-8', 'replace')


def remote_ref(branch):
    return f'refs/remotes/origin/{branch}'


def ref_exists(repo, ref):
    return _git(repo, 'rev-parse', '--verify', '--quiet', ref, check=False).returncode == 0


def fetch_branch(repo, branch):
    result = _git(
        repo, 'fetch', 'origin',
        f'+refs/heads/{branch}:refs/remotes/origin/{branch}',
        check=False,
    )
    return result.returncode == 0


def iter_symlinks(root):
    root = Path(root)
    for rel in GENERATED_PATHS:
        path = root / rel
        if path.is_symlink():
            yield rel
            continue
        if path.is_dir():
            for item in path.rglob('*'):
                if item.is_symlink():
                    yield str(item.relative_to(root))


def patch_has_symlink(raw):
    text = raw.decode('utf-8', 'replace')
    return re.search(r'(?m)^(new file mode|deleted file mode|old mode|new mode) 120000$', text) is not None


def forbidden_patch_path(raw):
    text = raw.decode('utf-8', 'replace')
    for line in text.splitlines():
        if not line.startswith('diff --git '):
            continue
        path = line.split(' ')[-1]
        if path.startswith('b/'):
            path = path[2:]
        if path.endswith('.vpk') or path.endswith('.lua'):
            return path
    return None


def staged_names(repo):
    return [line for line in _text(_git(repo, 'diff', '--cached', '--name-only')).splitlines() if line.strip()]


def assert_safe_staged(repo):
    names = staged_names(repo)
    bad = [name for name in names if name.endswith('.vpk') or name.endswith('.lua')]
    if bad:
        raise RuntimeError('Refusing to commit a VPK or extracted Lua:\n' + '\n'.join(bad))
    summary = _text(_git(repo, 'diff', '--cached', '--summary'))
    if re.search(r'mode 120000', summary):
        raise RuntimeError('Refusing to commit a symlink.')
    links = list(iter_symlinks(repo))
    if links:
        raise RuntimeError('Refusing to publish a symlink:\n' + '\n'.join(links))
    unexpected = [
        name for name in names
        if not (name.startswith('content/') or name.startswith('data/icons/') or name == 'data/workshop-last-seen.json')
    ]
    if unexpected:
        raise RuntimeError(
            'Refusing to commit paths outside content, icons, and the last-seen manifest:\n' + '\n'.join(unexpected)
        )
    return names


def _show_json(repo, spec):
    result = _git(repo, 'show', spec, check=False)
    if result.returncode != 0 or not result.stdout.strip():
        return {}
    try:
        payload = json.loads(result.stdout.decode('utf-8'))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def should_commit(repo):
    names = assert_safe_staged(repo)
    if any(name != 'data/workshop-last-seen.json' for name in names):
        return True
    if not names:
        return False
    before = _show_json(repo, 'HEAD:data/workshop-last-seen.json')
    after = _show_json(repo, ':data/workshop-last-seen.json')
    return substantive_last_seen_change(before, after)


def _existing_add_paths(repo):
    return [path for path in GENERATED_PATHS if (Path(repo) / path).exists()]


def _add_generated(repo):
    paths = _existing_add_paths(repo)
    if paths:
        _git(repo, 'add', '-A', '--', *paths)


def _tree_has(repo, tree, path):
    return _git(repo, 'cat-file', '-e', f'{tree}:{path}', check=False).returncode == 0


def _head_has(repo, path):
    return _git(repo, 'cat-file', '-e', f'HEAD:{path}', check=False).returncode == 0


def ensure_bot_identity(repo):
    _git(repo, 'config', 'user.name', BOT_NAME)
    _git(repo, 'config', 'user.email', BOT_EMAIL)


def restore_patch_notes(repo):
    if _head_has(repo, 'content/patch-notes'):
        _git(repo, 'checkout', 'HEAD', '--', 'content/patch-notes')
    elif (Path(repo) / 'content/patch-notes').exists():
        _git(repo, 'rm', '-r', '-q', '--ignore-unmatch', '--', 'content/patch-notes', check=False)


def write_refresh_patch(repo, dest):
    """Diff generated paths against HEAD, leaving patch notes out of the patch."""
    repo = Path(repo)
    links = list(iter_symlinks(repo))
    if links:
        raise RuntimeError('Refusing to publish a symlink:\n' + '\n'.join(links))
    paths = _existing_add_paths(repo)
    if paths:
        _git(repo, 'add', '-A', '--', *paths)
    _git(repo, 'reset', '-q', '--', 'content/patch-notes', check=False)
    try:
        names = staged_names(repo)
        bad = [name for name in names if name.endswith('.vpk') or name.endswith('.lua')]
        if bad:
            raise RuntimeError('Refusing to publish a VPK or extracted Lua:\n' + '\n'.join(bad))
        summary = _text(_git(repo, 'diff', '--cached', '--summary'))
        raw = _git(repo, 'diff', '--cached', '--binary', '--no-renames').stdout
        if re.search(r'mode 120000', summary) or patch_has_symlink(raw) or forbidden_patch_path(raw):
            raise RuntimeError('Refusing a symlink, VPK, or Lua file in the refresh diff.')
        Path(dest).write_bytes(raw)
    finally:
        _git(repo, 'reset', '-q', check=False)


def commit_log(repo, base_ref, head_ref):
    result = _git(
        repo, 'log', '--format=COMMIT%x09%an%x09%ae%x09%cn%x09%ce', '--name-only',
        f'{base_ref}..{head_ref}',
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.decode('utf-8', 'replace').strip()
        raise RuntimeError(f'Could not read {base_ref}..{head_ref}: {detail}')
    return parse_commit_log(_text(result))


def bot_only_history(repo, default_ref, data_ref):
    commits = commit_log(repo, default_ref, data_ref)
    foreign = foreign_authors(commits)
    if foreign:
        names = ', '.join(
            f"{item['role']} {item['name']} <{item['email']}>" for item in foreign
        )
        raise RuntimeError(
            f'The data branch has commits the bot did not both author and commit ({names}). '
            'Not force-pushing and not deleting the branch. '
            'Merge or close the pull request, or remove the non-bot commit, then rerun.'
        )
    if not commits:
        raise RuntimeError(
            'The data branch is not a fast-forward of main and has no commits to attribute. '
            'Not force-pushing and not deleting the branch.'
        )


def _apply_index(repo, patch, three_way):
    command = ['apply', '--index']
    if three_way:
        command.append('--3way')
    for pattern in PATCH_NOTE_EXCLUDES:
        command.append(f'--exclude={pattern}')
    command.append(str(patch))
    return _git(repo, *command, check=False)


def apply_refresh_patch(repo, patch):
    """Apply a refresh diff onto the current worktree, which is main.

    A clean apply is verbatim. ``--3way`` runs only when that apply fails
    because main moved after the patch was cut. This never merges the patch
    into the previous data-branch commit.
    """
    raw = Path(patch).read_bytes()
    if not raw.strip():
        return
    if patch_has_symlink(raw) or forbidden_patch_path(raw):
        raise RuntimeError('Refusing a symlink, VPK, or Lua file in the refresh diff.')
    result = _apply_index(repo, patch, False)
    if result.returncode != 0:
        _git(repo, 'reset', '--hard', 'HEAD', check=False)
        result = _apply_index(repo, patch, True)
    if result.returncode != 0:
        detail = result.stderr.decode('utf-8', 'replace').strip() or result.stdout.decode('utf-8', 'replace').strip()
        raise RuntimeError('Applying the refresh diff onto main failed.\n' + detail)
    restore_patch_notes(repo)
    _add_generated(repo)


def _remove_generated(repo):
    existing = [
        path for path in GENERATED_PATHS
        if _head_has(repo, path) or (Path(repo) / path).exists()
    ]
    if existing:
        _git(repo, 'rm', '-r', '-q', '--ignore-unmatch', '--', *existing)


def stage_replay(repo, data_ref):
    """Replay the data branch's generated files onto HEAD as a single parent.

    Returns False when the data branch has nothing to add. Patch notes stay
    at the HEAD version. Conflicts fail instead of deleting the branch.
    """
    merged = _git(repo, 'merge', '--no-commit', '--no-ff', data_ref, check=False)
    stderr = merged.stderr.decode('utf-8', 'replace')
    stdout = merged.stdout.decode('utf-8', 'replace')
    if 'unrelated histories' in stderr:
        raise RuntimeError(
            'The data branch does not share history with main, so it cannot be rebuilt onto main. '
            'Not deleting the branch.\n' + stderr.strip()
        )
    if merged.returncode != 0:
        merging = _git(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD', check=False).returncode == 0
        if not merging:
            raise RuntimeError('Rebuilding onto main failed. Not deleting the branch.\n' + (stderr or stdout).strip())
        _git(repo, 'checkout', '--ours', '--', 'content/patch-notes', check=False)
        _git(repo, 'add', '--', 'content/patch-notes', check=False)
        unmerged = _text(_git(repo, 'diff', '--name-only', '--diff-filter=U')).strip()
        if unmerged:
            raise RuntimeError(
                'Rebuilding the data branch onto main left conflicts. Not deleting the branch.\n' + unmerged
            )
    elif 'Already up to date' in stdout:
        return False
    tree = _text(_git(repo, 'write-tree')).strip()
    _git(repo, 'reset', '--hard', 'HEAD')
    _remove_generated(repo)
    for path in GENERATED_PATHS:
        if _tree_has(repo, tree, path):
            _git(repo, 'checkout', tree, '--', path)
    restore_patch_notes(repo)
    _add_generated(repo)
    return True


def commit_generated(repo, manifest_id):
    if not should_commit(repo):
        _git(repo, 'reset', '--hard', 'HEAD', check=False)
        return False
    ensure_bot_identity(repo)
    _git(repo, 'commit', '-m', f'Refresh Workshop game data from manifest {manifest_id}')
    return True


def push_plan(repo, workdir, default_ref, data_ref):
    head = _text(_git(workdir, 'rev-parse', 'HEAD')).strip()
    if not ref_exists(repo, data_ref):
        return 'push'
    data_sha = _text(_git(repo, 'rev-parse', data_ref)).strip()
    if head == data_sha:
        return 'skip'
    if _git(repo, 'merge-base', '--is-ancestor', data_sha, head, check=False).returncode == 0:
        return 'push'
    bot_only_history(repo, default_ref, data_ref)
    return f'push-lease:{data_sha}'


def _apply_decision(workdir, decision, patch, data_ref, has_data):
    if decision == 'refresh':
        if patch is None:
            raise RuntimeError('Refresh is missing its diff.')
        apply_refresh_patch(workdir, patch)
        return
    if decision == 'pr-only':
        if not has_data:
            raise RuntimeError('pr-only requires the data branch.')
        stage_replay(workdir, data_ref)
        return
    raise RuntimeError(f'Unsupported decision {decision}')


def _parent_is_main(workdir, repo, default_ref):
    parent = _text(_git(workdir, 'rev-parse', 'HEAD^')).strip()
    main_sha = _text(_git(repo, 'rev-parse', default_ref)).strip()
    return parent == main_sha


def publish_tree(repo, workdir, default_branch, data_branch, decision, manifest_id, patch=None, open_pr=False):
    """Create the commit publish should push.

    The worktree always starts at current main, and the new commit's parent
    is that main. An open draft pull request does not change this. The
    returned action is ``push``, ``push-lease:<expected-sha>``, or ``skip``.
    A lease replaces the data-branch tip only when every commit it drops was
    both authored and committed by the bot. Otherwise this raises and the
    branch is left in place. ``open_pr`` only checks that the branch exists.
    """
    repo = Path(repo)
    workdir = Path(workdir)
    default_ref = remote_ref(default_branch)
    data_ref = remote_ref(data_branch)
    fetch_branch(repo, default_branch)
    has_data = fetch_branch(repo, data_branch)
    if not ref_exists(repo, default_ref):
        raise RuntimeError(f'Missing {default_ref}')
    if open_pr and not has_data:
        raise RuntimeError('An open pull request was expected but the data branch does not exist.')
    if workdir.exists():
        raise RuntimeError(f'Worktree path already exists: {workdir}')
    _git(repo, 'worktree', 'add', '--detach', str(workdir), default_ref)
    before = _text(_git(workdir, 'rev-parse', 'HEAD')).strip()
    _apply_decision(workdir, decision, patch, data_ref, has_data)
    created = commit_generated(workdir, manifest_id)
    if _text(_git(workdir, 'rev-parse', 'HEAD')).strip() != before:
        created = True
    if created:
        fetch_branch(repo, default_branch)
        if not _parent_is_main(workdir, repo, default_ref):
            _git(workdir, 'reset', '--hard', default_ref)
            _apply_decision(workdir, decision, patch, data_ref, has_data)
            if not commit_generated(workdir, manifest_id):
                return 'skip'
            if not _parent_is_main(workdir, repo, default_ref):
                raise RuntimeError(
                    'main moved while the refresh commit was created. '
                    'Not publishing a stale snapshot and not deleting the data branch.'
                )
    if not created:
        return 'skip'
    return push_plan(repo, workdir, default_ref, data_ref)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)

    gate = commands.add_parser('gate')
    gate.add_argument('--default-last-seen', type=Path, required=True)
    gate.add_argument('--branch-last-seen', type=Path, required=True)
    gate.add_argument('--open-prs', type=Path, required=True)
    gate.add_argument('--closed-prs', type=Path, required=True)
    gate.add_argument('--github-output', type=Path, required=True)
    gate.add_argument('--report-output', type=Path)

    closed = commands.add_parser('closed-check')
    closed.add_argument('--manifest', required=True)
    closed.add_argument('--pulls', type=Path, required=True)

    patch = commands.add_parser('write-patch')
    patch.add_argument('--repo', type=Path, required=True)
    patch.add_argument('--output', type=Path, required=True)

    publish = commands.add_parser('publish-tree')
    publish.add_argument('--repo', type=Path, required=True)
    publish.add_argument('--workdir', type=Path, required=True)
    publish.add_argument('--default-branch', required=True)
    publish.add_argument('--data-branch', required=True)
    publish.add_argument('--decision', choices=('refresh', 'pr-only'), required=True)
    publish.add_argument('--manifest', required=True)
    publish.add_argument('--patch', type=Path)
    publish.add_argument('--open-pr', choices=('true', 'false'), required=True)

    render = commands.add_parser('render')
    render.add_argument('--report', type=Path, required=True)
    render.add_argument('--changelog', type=Path)
    render.add_argument('--changelog-error', type=Path)
    render.add_argument('--output', type=Path, required=True)
    render.add_argument('--run-url')

    args = parser.parse_args(argv)
    if args.command == 'gate':
        published = refresh.fetch_published_file()
        default_record = read_json(args.default_last_seen)
        branch_record = read_json(args.branch_last_seen)
        open_pulls = json.loads(args.open_prs.read_text(encoding='utf-8'))
        closed_pulls = json.loads(args.closed_prs.read_text(encoding='utf-8'))
        result = gate_decision(default_record, branch_record, open_pulls, closed_pulls, published)
        for line in result['lines']:
            print(line, flush=True)
        print(
            f"decision={result['decision']} download={'true' if result['download'] else 'false'} "
            f"manifest={result['manifest_id']}",
            flush=True,
        )
        report = recorded_report(branch_record or default_record, published)
        if result['decision'] != 'refresh' and args.report_output:
            args.report_output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        write_github_output(args.github_output, {
            'decision': result['decision'],
            'manifest_id': result['manifest_id'],
            'manifest_date': report.get('manifest_date') or '',
            'manifest_created_at': report.get('manifest_created_at') or '',
            'time_updated': result['time_updated'],
            'previous_time_updated': result['previous_time_updated'],
            'download': 'true' if result['download'] else 'false',
        })
        return 0

    if args.command == 'closed-check':
        pulls = json.loads(args.pulls.read_text(encoding='utf-8'))
        matched = closed_pull_matches(pulls, args.manifest)
        print('closed' if matched else 'openable', flush=True)
        return 0

    if args.command == 'write-patch':
        write_refresh_patch(args.repo, args.output)
        return 0

    if args.command == 'publish-tree':
        action = publish_tree(
            args.repo,
            args.workdir,
            args.default_branch,
            args.data_branch,
            args.decision,
            args.manifest,
            patch=args.patch,
            open_pr=args.open_pr == 'true',
        )
        print(action)
        return 0

    report = read_json(args.report)
    entries = read_json(args.changelog) if args.changelog else []
    if not isinstance(entries, list):
        raise RuntimeError('--changelog must be a JSON list')
    selection = select_changelog(
        entries,
        report.get('manifest_created_at'),
        report.get('manifest_date'),
        report.get('time_updated'),
        since=report.get('previous_time_updated'),
    )
    error = None
    if args.changelog_error and args.changelog_error.is_file():
        error = args.changelog_error.read_text(encoding='utf-8')
    args.output.write_text(
        render_body(report, selection, run_url=args.run_url, changelog_error=error),
        encoding='utf-8',
    )
    print(f"changelog_match={selection['method']} entries={len(selection['matched'])}", flush=True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'ERROR: {error}', file=sys.stderr, flush=True)
        raise SystemExit(1)
