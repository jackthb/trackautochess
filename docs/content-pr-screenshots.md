# Before/after evidence for content PRs

Required evidence for every PR touching `content/**`. Delegate capture and
inspection to a sub-agent. This runbook does not install a GitHub Actions
workflow or provision publishing credentials.

## Trigger and identity

- Run for open PRs whose changed files include `content/**`. Include bot-created
  and draft PRs. Check both `filename` and `previous_filename` so renames into
  or out of `content/` are included, along with additions and deletions.
- Check every page of the changed-files API response and reconcile its count
  with the PR's `changed_files`. GitHub caps this endpoint at 3,000 files.
  If the list is incomplete, derive the complete changed paths from a local
  diff of the exact merge-base and head commits (including both rename paths).
  If neither is available, report incomplete discovery; do not skip the PR
  as non-content or claim full coverage.
- Re-run when head or base-tip SHA changes. Record the full merge-base,
  base-tip, and head SHAs and the PR number.
- Trigger on PR opening, reopening, head updates, readiness, and base-branch
  retargeting. A push to a base branch must also recheck open PRs targeting it;
  do not assume it produces a PR head-update event. If the event integration
  cannot handle base pushes or retargeting, disclose that coverage gap and
  recheck explicitly before merge. This runbook does not configure triggers.
- Use one comment marked `<!-- dac-content-screenshots:v1 -->`. Only update a
  comment owned by the configured publisher account. Never edit a human comment
  merely because it contains a copied marker.
- Before publishing, re-fetch the PR and verify it is still open and head/base-tip SHAs
  match the captured pair. Discard stale results and requeue.
- A matching successful comment for the same revisions is a no-op only when
  its coverage is complete and its images still render. A blocked/partial
  comment must remain retryable after access is restored, even without a new
  commit. Comment events must not trigger more screenshot work.

## Execution preflight

Read the policy and publication instructions from the trusted base revision.
Before building, confirm exact-revision checkout access, isolated build and
browser availability, and the supported attachment publication method. Record
which steps work and which are blocked. If only publication is blocked, retain
completed captures and their revision/coverage manifest in private durable
storage for a later retry; never substitute public image hosting.

An enabled external task is not proof that capture or publication works.
Consider unattended setup verified only after an actual content PR receives
a current, fully covered inline screenshot comment and a subsequent revision
updates that same comment successfully. Until then, describe the setup as
configured but not verified. This documentation PR itself changes no content
and does not require screenshots.

## Capture

1. Fetch exact base-tip and head commits, then compute their merge-base with
   `git merge-base`. Create separate disposable checkouts at the merge-base
   (before) and head (after). Fetch sufficient history to compute the merge-base
   correctly. Never substitute a moving branch or production deployment.
2. Build each checkout with its own committed lockfile. Run the real web viewer,
   regenerate its runtime content, and sync icons. No production database or
   Steam credentials are needed for static content routes.
3. Run both revisions in containers or equivalent isolated jobs without write
   credentials, inherited home directories, SSH agents, or Docker sockets. Stop
   the applications before supplying publication credentials. Never execute PR
   code under `pull_request_target` with a write token.
4. Determine affected visible pages from the diff and each revision's actual
   content loaders/routes. Do not assume a JSON filename equals the route slug.
   Abilities may be visible on unit pages, and synergy details use `/synergies/`.
   Capture changed detail pages and relevant listing/navigation surfaces.
5. Use identical browser version, viewport, color scheme, and locale for each
   pair. Wait for the actual heading and images/fonts, disable animations, and
   exclude time-varying/database-backed elements from comparisons.
6. Navigate via visible controls, then assert the route and heading. Capture
   enough of the page to show the changed content. Long pages need multiple
   readable screenshots, not an unreadable full-page thumbnail.
7. For additions/removals show the real listing/404 state on the missing side
   and identify it. Non-rendered metadata or translations should be described as
   having no visible UI change, backed by an actual relevant page comparison.
   Never create a mock page just to make an invisible content change appear.
8. Inspect the images. A successful screenshot operation alone does not prove
   that the relevant content rendered. Document missing assets or render errors;
   do not publish errors as a successful content comparison.

For large refreshes, group the readable pairs under collapsed sections and state
coverage explicitly. If any changed entity lacks a mapped visible surface,
report that gap rather than silently treating a sample as full coverage.

## Inline publication

The repository is private. Keep images as native private GitHub attachments; do
not publish a public screenshot bucket or commit screenshots into app content.

GitHub CLI 2.99.0 introduced native image attachments:

```bash
gh pr comment "$PR_NUMBER" --repo jackthb/dac-tools \
  --body-file review.md --attach before.png --attach after.png
```

In `review.md`, local image references are rewritten to uploaded GitHub URLs:

```markdown
<!-- dac-content-screenshots:v1 -->
Before (merge-base): FULL_MERGE_BASE_SHA · After (head): FULL_HEAD_SHA
PR base tip: FULL_BASE_TIP_SHA

| Before | After |
| --- | --- |
| ![Before: page name](before.png) | ![After: page name](after.png) |

Coverage: affected pages, invisible changes, and unresolved gaps.
```

The CLI uploader accepts OAuth, classic PAT, and fine-grained PAT credentials
with repository write access. GitHub App installation tokens, including the
standard Actions `GITHUB_TOKEN`, are not supported for attachments. Use a
separate trusted publisher with an appropriate credential or an authenticated
GitHub browser session. Do not weaken this separation to make uploads work.

The CLI only exposes `--edit-last` for updating a comment. Use it only after
verifying that the publisher's last comment is the exact marked screenshot
comment. Otherwise edit the identified comment through the authenticated UI,
or use an uploader that returns attachment URLs and update the known comment
ID through the API. Query all PR comments, locate the publisher-owned marker,
and PATCH `/repos/jackthb/dac-tools/issues/comments/{comment_id}` with the full
body containing actual attachment URLs. Create only when no owned marker
exists. Serialize publication per PR, recheck revisions immediately before
writing, and never execute publication scripts taken from PR head.

Validate the resulting comment and both rendered images while authenticated.
An Actions artifact download link is useful supplementary evidence, but does
not satisfy the inline screenshot requirement. If upload/auth/capture fails,
report the blocker without claiming completion.

## Non-rendered changes

Resolve supported locales and available assets separately at both captured
revisions. For example, a Russian text correction has no visible Russian-page
difference when those revisions expose only English routes. Compare the real
affected page and state that limitation. Likewise, an extractor naming change
does not demonstrate new artwork unless the resulting asset is present and
rendered in the captured head revision. Do not carry assumptions about today's
routes or missing assets into later reviews.

## References

- https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli
- https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
- https://github.com/cli/cli/releases/tag/v2.99.0
- https://github.com/cli/cli/blob/v2.99.0/internal/attachments/client.go

- https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files
