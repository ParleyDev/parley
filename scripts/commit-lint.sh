#!/usr/bin/env sh
# Conventional Commits (https://www.conventionalcommits.org): the subject is `type(scope)!: summary`.
#   types   feat fix perf refactor docs style test build ci chore revert
#   scope   optional, lower case: feat(desktop): …, fix(voice): …
#   !       a breaking change (or a "BREAKING CHANGE: …" footer)
# scripts/version.mjs reads them to pick the next release: feat → minor, fix/perf → patch, breaking → major.
# Releases are `chore(release): X.Y.Z`. Merges, reverts and fixup!/squash! commits pass as git writes them.
#
#   scripts/commit-lint.sh <message file>     (the commit-msg hook)
set -u
subject=$(grep -v '^#' "$1" | sed -n '/[^[:space:]]/{p;q;}')
case "$subject" in
  "Merge "*|"Revert "*|"fixup! "*|"squash! "*|"amend! "*) exit 0 ;;
esac
if printf '%s\n' "$subject" | grep -qE '^(feat|fix|perf|refactor|docs|style|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: [^ ].*'; then exit 0; fi
cat >&2 <<MSG
commit-lint: the subject must follow Conventional Commits, e.g.
  feat(desktop): update channel in Settings
  fix: typing strip blends into every theme
  chore(release): 0.21.0
types: feat fix perf refactor docs style test build ci chore revert (scope optional, ! for breaking)
got: $subject
MSG
exit 1
