#!/usr/bin/env bash
# The rolling "Development build" prerelease (tag `dev`) that every build of main lands on: desktop installers and
# their updater manifest (the desktop app's Development channel reads releases/download/dev/latest.json) and the
# Android APK. A prerelease, so it is never GitHub's "latest" and the stable channel never sees it.
#
#   scripts/dev-release.sh prepare <version>          create the release if needed, move `dev` to this commit,
#                                                     and say which build it is
#   scripts/dev-release.sh prune <regex>              after uploading: delete this workflow's files (names matching
#                                                     <regex>) left from earlier runs, i.e. uploaded before this
#                                                     run started (file names change with every version)
# Needs GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA and GITHUB_RUN_ID (as in GitHub Actions).
set -euo pipefail
cmd=$1
repo=$GITHUB_REPOSITORY
case "$cmd" in
  prepare)
    version=$2
    # Point the tag at this commit (create or move). The desktop and mobile workflows may both get here at once,
    # so a failed create falls back to the other path.
    move() { gh api -X PATCH "repos/$repo/git/refs/tags/dev" -f sha="$GITHUB_SHA" -F force=true >/dev/null; }
    make() { gh api -X POST "repos/$repo/git/refs" -f ref=refs/tags/dev -f sha="$GITHUB_SHA" >/dev/null; }
    if gh api "repos/$repo/git/ref/tags/dev" >/dev/null 2>&1; then move; else make 2>/dev/null || move; fi
    notes="Development build **$version** from $GITHUB_SHA, rebuilt on every change to main. These builds may have rough edges; the desktop app's Settings → Advanced → Update channel → Development keeps it on them. Releases are the stable channel."
    edit() { gh release edit dev --repo "$repo" --prerelease --latest=false --title "Development build ($version)" --notes "$notes" >/dev/null; }
    if gh release view dev --repo "$repo" >/dev/null 2>&1; then edit
    else gh release create dev --repo "$repo" --prerelease --latest=false --title "Development build ($version)" --notes "$notes" --target "$GITHUB_SHA" >/dev/null 2>&1 || edit
    fi
    echo "dev prerelease: $version at $GITHUB_SHA"
    ;;
  prune)
    pattern=$2
    started=$(gh api "repos/$repo/actions/runs/$GITHUB_RUN_ID" -q .run_started_at)
    id=$(gh api "repos/$repo/releases/tags/dev" -q .id)
    gh api --paginate "repos/$repo/releases/$id/assets" -q '.[] | [.name, .updated_at] | @tsv' | while IFS=$'\t' read -r name updated; do
      if [[ "$updated" < "$started" ]] && printf '%s' "$name" | grep -qE "$pattern"; then
        echo "removing $name (from $updated)"; gh release delete-asset dev "$name" --repo "$repo" --yes
      fi
    done
    ;;
  *) echo "usage: $0 prepare <version> | prune <regex>" >&2; exit 2 ;;
esac
