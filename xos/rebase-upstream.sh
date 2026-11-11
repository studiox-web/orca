#!/usr/bin/env bash
# The fork's weekly sync (plan §7): rebase `xos` onto the latest upstream release tag, not main's tip.
# Stops at the first conflict with a report; rerere replays resolutions from earlier weeks.
# --dry-run prints the target and the commits that would move, and changes nothing.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

if [[ "$(git branch --show-current)" != "xos" ]]; then
  echo "Run this on the xos branch." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree has changes. Commit or stash them first." >&2
  exit 1
fi

git fetch upstream --tags
TAG="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
if [[ -z "$TAG" ]]; then
  echo "No upstream release tag found." >&2
  exit 1
fi
echo "Target: $TAG ($(git rev-list --count "$TAG"..HEAD) fork commits on top)"
if [[ "$DRY_RUN" == 1 ]]; then
  git log --oneline "$TAG"..HEAD | head -40
  exit 0
fi

git config rerere.enabled true
git config rerere.autoupdate true
if ! git rebase "$TAG"; then
  echo >&2
  echo "Conflicts rebasing onto $TAG:" >&2
  git diff --name-only --diff-filter=U >&2
  echo "Resolve them, then: git rebase --continue (or git rebase --abort)." >&2
  exit 1
fi

source "$HOME/.nvm/nvm.sh" >/dev/null
nvm use 24 >/dev/null
pnpm install --frozen-lockfile
pnpm tc
pnpm exec vitest run src/main/xos src/renderer/src/components/xos-goals
echo "Rebased onto $TAG. Review, then build with xos/build.sh and push."
