# Loyalty Reward Home Notification — push/PR hand-off

This cloud session cannot push to `imedkilat/aquaspin-laundry-station` (the
repo isn't in this session's authorized push set, and no tool here can grant
that). Everything is built, tested, and committed locally in the session's
clone at commit `9f27f48713cd0516bb7faae4e41eda63d2e994aa` on branch
`feat/loyalty-home-reward-notification`, based on `main` at `11de7970c45c`
(post PR #28). You just need to get that one commit onto your machine and
push it yourself. Two ways to do that — use whichever is easier.

## Option A — git bundle (recommended: preserves the exact commit/SHA)

File: `loyalty-home-reward-notification.bundle`

On your machine, inside your existing clone of the repo:

```bash
git fetch /path/to/loyalty-home-reward-notification.bundle feat/loyalty-home-reward-notification:feat/loyalty-home-reward-notification
git checkout feat/loyalty-home-reward-notification
git push -u origin feat/loyalty-home-reward-notification
```

(Replace `/path/to/...` with wherever you save the downloaded file.) This
recreates the branch with the identical commit SHA `9f27f48...e994aa` — no
patch re-application, no risk of whitespace/conflict drift.

Then open GitHub Desktop, it will show the branch is ahead of `main` with
nothing further to commit — just click **"Create Pull Request"** (or use the
GitHub web UI) and paste the PR text below.

## Option B — patch file (if the bundle doesn't apply cleanly)

File: `loyalty-home-reward-notification-patch/0001-Add-Loyalty-Reward-Home-notification.patch`

```bash
git checkout main
git pull
git checkout -b feat/loyalty-home-reward-notification
git am /path/to/0001-Add-Loyalty-Reward-Home-notification.patch
git push -u origin feat/loyalty-home-reward-notification
```

This replays the same commit (message, diff and the
`Co-Authored-By`/`Claude-Session` trailer) on top of whatever `main` looks
like on your machine right now. If `main` has moved since PR #28, this is
the more forgiving of the two options.

## After pushing: open the PR

Use this title and description (also usable directly in GitHub Desktop's
"Create Pull Request" dialog):

**Title:** `Add Loyalty Reward Home notification`

**Description:** see `PR-DESCRIPTION.md` in this same output — copy its
contents into the PR body as-is.

Do not merge — the task was to open the PR only, not merge or deploy.
