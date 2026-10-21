#!/usr/bin/env sh
# Identity guard: every commit in this repository is authored and committed by the project identity only, and
# nothing in a commit (message, trailers, beads export) references any other person or tool account.
#
#   scripts/identity-guard.sh pre-commit          staged changes + author/committer identity
#   scripts/identity-guard.sh commit-msg <file>   message trailers and mentions
#   scripts/identity-guard.sh pre-push            every commit about to be pushed (reads git's pre-push stdin)
#
# Extra forbidden patterns (names, emails, handles; one extended regex per line) live OUTSIDE the repo in
# .git/info/identity-denylist so the list itself is never committed.
set -u
ALLOWED_NAME="ParleyDev"
ALLOWED_EMAIL="4f520ac6@gmail.com"
ALLOWED_IDENT="$ALLOWED_NAME <$ALLOWED_EMAIL>"
GIT_DIR=$(git rev-parse --git-common-dir)
DENYLIST="$GIT_DIR/info/identity-denylist"
fail=0
err() { echo >&2 "identity-guard: $*"; fail=1; }

# Lines on stdin that match the local denylist (case-insensitive).
deny_hits() {
  [ -s "$DENYLIST" ] || { cat >/dev/null; return 0; }
  grep -viE '^[[:space:]]*(#|$)' "$DENYLIST" > "$GIT_DIR/info/.identity-denylist.active" 2>/dev/null
  [ -s "$GIT_DIR/info/.identity-denylist.active" ] || { cat >/dev/null; return 0; }
  grep -iE -f "$GIT_DIR/info/.identity-denylist.active"
}

# Commit message rules: no person/agent trailers, no foreign emails, nothing from the denylist.
# Checks read a file (not a pipe): a function at the end of a pipeline runs in a subshell and could not set $fail.
TMP=$(mktemp) || exit 1
trap 'rm -f "$TMP"' EXIT

check_message() { # $1 = label, $2 = file holding the message
  msg=$(cat "$2")
  t=$(printf '%s\n' "$msg" | grep -iE '^[[:space:]]*(co-authored-by|signed-off-by|reviewed-by|acked-by|tested-by|reported-by|suggested-by|helped-by|assisted-by|generated-by|executed-by|agent|on-behalf-of)[[:space:]]*:' )
  [ -n "$t" ] && err "$1: person/agent trailer not allowed: $(printf '%s' "$t" | head -1)"
  e=$(printf '%s\n' "$msg" | grep -oiE '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' | grep -viF "$ALLOWED_EMAIL" | head -1)
  [ -n "$e" ] && err "$1: message mentions an email other than $ALLOWED_EMAIL: $e"
  d=$(printf '%s\n' "$msg" | deny_hits | head -1)
  [ -n "$d" ] && err "$1: message matches the identity denylist: $d"
}

# Beads export identity fields must name the project identity only. Reads JSONL (or diff lines) on stdin.
check_beads() { # $1 = label, $2 = file holding the export
  bad=$(grep -oE '"(owner|created_by|assignee|author|actor|closed_by|updated_by|sender)":"[^"]*"' \
    "$2" | grep -vE "\":\"(@?$ALLOWED_NAME|$ALLOWED_EMAIL)?\"$" | sort -u | head -3)
  [ -n "$bad" ] && err "$1: beads export names another identity: $(printf '%s' "$bad" | tr '\n' ' ')
  (fix the beads database, not just the export: the pre-commit hook re-exports it on every commit)"
}

check_ident() { # $1 = label, $2 = role, $3 = "Name <email>"
  [ "$3" = "$ALLOWED_IDENT" ] || err "$1: $2 is '$3', must be '$ALLOWED_IDENT' (check git config user.name/user.email and any -c overrides)"
}

case "${1:-}" in
  pre-commit)
    check_ident "commit" "author" "$(git var GIT_AUTHOR_IDENT | sed 's/ [0-9]* [-+][0-9]*$//')"
    check_ident "commit" "committer" "$(git var GIT_COMMITTER_IDENT | sed 's/ [0-9]* [-+][0-9]*$//')"
    added=$(git diff --cached --no-color -U0 | grep -E '^\+' | grep -vE '^\+\+\+ ')
    d=$(printf '%s\n' "$added" | deny_hits | head -1 | cut -c1-160)
    [ -n "$d" ] && err "staged changes match the identity denylist: $d"
    if git diff --cached --name-only | grep -qx '.beads/issues.jsonl'; then
      git show :.beads/issues.jsonl > "$TMP" 2>/dev/null && check_beads "staged .beads/issues.jsonl" "$TMP"
    fi
    ;;
  commit-msg)
    # Ignore git's comment lines (the commit template), then check what will be stored.
    grep -vE '^#' "$2" > "$TMP"; check_message "commit message" "$TMP"
    ;;
  pre-push)
    zero=0000000000000000000000000000000000000000
    while read -r lref lsha rref rsha; do
      [ "$lsha" = "$zero" ] && continue # branch deletion
      if [ "$rsha" = "$zero" ]; then range=$(git rev-list "$lsha" --not --remotes 2>/dev/null)
      else range=$(git rev-list "$rsha..$lsha" 2>/dev/null || git rev-list "$lsha" --not --remotes); fi
      for c in $range; do
        short=$(git rev-parse --short "$c")
        check_ident "$short" "author" "$(git log -1 --format='%an <%ae>' "$c")"
        check_ident "$short" "committer" "$(git log -1 --format='%cn <%ce>' "$c")"
        git log -1 --format=%B "$c" > "$TMP"; check_message "$short" "$TMP"
        d=$(git show --format= --no-color -U0 "$c" | grep -E '^\+' | grep -vE '^\+\+\+ ' | deny_hits | head -1 | cut -c1-160)
        [ -n "$d" ] && err "$short: changes match the identity denylist: $d"
        git show "$c:.beads/issues.jsonl" > "$TMP" 2>/dev/null && check_beads "$short .beads/issues.jsonl" "$TMP"
      done
    done
    ;;
  *) echo >&2 "usage: $0 pre-commit | commit-msg <file> | pre-push"; exit 2 ;;
esac
if [ "$fail" -ne 0 ]; then
  echo >&2 "identity-guard: blocked. Only '$ALLOWED_IDENT' may appear in this repository's history."
  exit 1
fi
exit 0
