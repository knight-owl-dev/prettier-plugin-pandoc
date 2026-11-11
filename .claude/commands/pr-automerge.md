# PR Auto-Merge Command

Enable auto-merge on a pull request, by the method its history deserves:
**squash** for one unit of work, with a reviewed, consolidated body and **no
subject**, so GitHub keeps the PR title and appends `(#N)`; **rebase** for
independent units, each commit one, landing as written.

## Arguments: $ARGUMENTS

Optional PR number or URL. If omitted, target the PR for the current branch.

## Instructions

### 1. Resolve the PR

If an argument is given, use it. Otherwise find the PR for the current branch:

```bash
gh pr view --json number,title,state,isDraft,mergeable,headRefName,url,body
```

If no PR exists for the branch, stop and tell the user (suggest `/pr-create`).

### 2. Check preconditions

- **Open, not draft** — if `state != OPEN` or `isDraft`, stop.
- **Mergeable** — if `mergeable == CONFLICTING`, stop and report the conflict.
- **Checks** — read the rollup for context:

  ```bash
  gh pr checks <number> 2>/dev/null || true
  ```

  Auto-merge waits for required checks, so PENDING is fine — note it, do not
  block. Warn (do not hard-stop) if a check has already FAILED: auto-merge will
  never complete until it is fixed.

- **Unresolved review threads** — this repo blocks auto-merge until every review
  thread is resolved (Copilot's reviewer opens threads that must be marked
  resolved once addressed; otherwise `--auto` never completes even on green).
  List them:

  ```bash
  gh api graphql -f query='query{repository(owner:"knight-owl-dev",name:"prettier-plugin-pandoc"){pullRequest(number:'"<number>"'){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{author{login} path line body}}}}}}}' \
    --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not)'
  ```

  For each unresolved thread whose feedback is **already addressed**, resolve
  it:

  ```bash
  gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<threadId>
  ```

  Never resolve a thread whose feedback is not yet handled — fix it first, then
  resolve. If any unresolved thread is unaddressed, stop and tell the user.

### 3. Choose the method

Read the commits:

```bash
git log main..HEAD --format='%h %s%n%b'
```

- **Rebase** when the PR bundles independent changes and each commit is one of
  them, whole and worth finding later by `git bisect` or `git blame` (a Pandoc
  bump's ports, each mapping an upstream fix).
- **Squash** otherwise: one change, or commits that iterate on it (review fixes,
  WIP, steps that mean nothing alone). When in doubt, squash.

`fixup!` and `squash!` commits count as the commits they fold into (step 4b).

Recommend one, with a line of evidence (e.g. "14 commits, each one ported
change: rebase"); the user confirms in step 5.

### 4a. Squash: generate the consolidated body

Distill the PR's commits and description into one clean, changelog-style body —
the change and why, grouped conceptually, not a commit-by-commit dump:

```bash
git log main..HEAD --format='%s%n%b'
```

- **No subject line in the body.** GitHub uses the PR title as the squash title
  and appends `(#N)` on merge — do not restate it here.
- Laconic and load-bearing; flowing prose or tight bullets, no drama.
- Keep it consistent with the PR's own Summary/Changes.

### 4b. Rebase: ready the commits

Each commit lands on `main` as it stands. On the PR's branch, checked out
(`gh pr checkout <number>`), fold `fixup!` and `squash!` commits into their
targets, onto the current `main`:

```bash
git fetch origin
git rebase --autosquash origin/main
```

Then stop and report, rather than merge, if any subject reads as a step rather
than a change (`WIP`, `wip`, `tmp`, "address review", "fix tests"), names an
issue number, or any commit carries a `Co-Authored-By` trailer. The rebase stays
local until the user confirms.

### 5. Let the user confirm

Show the method and its evidence, then the squash body verbatim, or for a rebase
the subjects that will land. AskUserQuestion:

- Question: "Enable auto-merge as shown?"
- Options: "Enable as shown", "Switch to the other method", "Edit the body"
  (squash only), "Cancel".

On a switch or an edit, prepare that (step 4a or 4b) and re-confirm.

### 6. Enable auto-merge

```bash
# squash
gh pr merge <number> --auto --squash --body "<approved body>"

# rebase: push the readied commits first; CI runs on the new head
git push --force-with-lease
gh pr merge <number> --auto --rebase
```

For a squash, omit `--subject` deliberately: GitHub defaults the squash title to
the PR title and appends `(#N)`. Passing a subject would override that and drop
the PR-number suffix. A rebase keeps each commit's subject; GitHub still links
the commits to the PR.

### 7. Confirm

Report that auto-merge is enabled, by which method, and that the PR merges once
required checks pass. Show the PR URL.

### Error Handling

- **No PR for the branch** — suggest `/pr-create`.
- **Auto-merge disabled on the repo** — `gh` errors; tell the user to enable it
  (Settings → General → Allow auto-merge) or merge manually.
- **Already enabled** — report it; re-running updates the pending method and
  squash body.
- **Rebase conflicts** — stop with the conflicting files; the user resolves them
  or the PR squashes instead.
