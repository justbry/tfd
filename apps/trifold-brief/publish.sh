#!/usr/bin/env bash
# Render the Trifold brief and upload it to the Pages project trifold-brief, then check the password gate.
# Live URL: https://trifold-brief.pages.dev/ (no custom domain)
# Password file (never printed): ~/.config/trifold/brief.env, key BRIEF_PASSWORD (override with BRIEF_ENV).
#
#   ./publish.sh                 render, stage, deploy with --branch main, verify
#   ./publish.sh --stage <dir>   render and stage into <dir> only (for `wrangler pages dev <dir>`); no deploy
#   ./publish.sh --verify-only   check the gate at BRIEF_URL (default the live URL) without deploying
#
# Verify: each page (/, /overview/, /investors/, /firms/, /schools/, /partners/) must answer 401 without the
# password and 200 with it. The Pages project and its BRIEF_PASSWORD secret are created by hand, once.
set -euo pipefail

cd "$(dirname "$0")"
brief_dir="$(pwd)"
project="trifold-brief"
base_url="${BRIEF_URL:-https://trifold-brief.pages.dev}"
base_url="${base_url%/}"
paths=(overview investors firms schools partners)

mode="deploy"
stage_target=""
case "${1:-}" in
  "") ;;
  --stage)
    mode="stage"
    stage_target="${2:?usage: publish.sh --stage <dir>}"
    ;;
  --verify-only) mode="verify" ;;
  *)
    echo "usage: publish.sh [--stage <dir> | --verify-only]" >&2
    exit 2
    ;;
esac

render() {
  local quarto=""
  if [[ -n "${QUARTO:-}" && -x "${QUARTO}" ]]; then
    quarto="$QUARTO"
  elif command -v quarto >/dev/null 2>&1; then
    quarto="$(command -v quarto)"
  elif [[ -x "$HOME/.local/bin/quarto" ]]; then
    quarto="$HOME/.local/bin/quarto"
  fi

  if [[ -n "$quarto" ]]; then
    echo "rendering with $quarto"
    "$quarto" render "$brief_dir"
    return
  fi
  for page in index.html "${paths[@]/%//index.html}"; do
    if [[ ! -f "$brief_dir/$page" ]]; then
      echo "$page is missing and quarto is not available" >&2
      exit 1
    fi
  done
  echo "quarto not found; using the committed HTML"
}

stage_into() {
  local stage="$1"
  mkdir -p "$stage/functions"
  cp "$brief_dir/index.html" "$stage/index.html"
  for name in "${paths[@]}"; do
    mkdir -p "$stage/$name"
    cp "$brief_dir/$name/index.html" "$stage/$name/index.html"
  done
  cp "$brief_dir/_headers" "$brief_dir/_routes.json" "$brief_dir/robots.txt" "$stage/"
  cp "$brief_dir/functions/_middleware.js" "$stage/functions/_middleware.js"
}

# Marker text that only the real page holds, never the 401 form.
marker() {
  if [[ "$1" == "/" ]]; then echo "Choose your path"; else echo 'id="where-next"'; fi
}

verify() {
  local body page code
  body="$(mktemp)"
  for page in / "${paths[@]/#//}"; do
    [[ "$page" == "/" ]] || page="$page/"
    code="$(curl -sS -o "$body" -w "%{http_code}" "$base_url$page")"
    if [[ "$code" != "401" ]]; then
      echo "expected 401 from $base_url$page without a password, got $code" >&2
      rm -f "$body"
      exit 1
    fi
    if grep -q "$(marker "$page")" "$body"; then
      echo "$base_url$page was served without a password" >&2
      rm -f "$body"
      exit 1
    fi
  done
  rm -f "$body"

  local password_file="${BRIEF_ENV:-$HOME/.config/trifold/brief.env}"
  if [[ ! -f "$password_file" ]]; then
    echo "brief: 401 without a password on every page; no local password file, skipped the login check"
    return
  fi

  local form jar login deck authed
  form="$(mktemp)"
  jar="$(mktemp)"
  chmod 600 "$form" "$jar"
  python3 - "$password_file" "$form" << 'PY'
import pathlib, sys, urllib.parse
path, dest = sys.argv[1], sys.argv[2]
password = None
for line in pathlib.Path(path).read_text().splitlines():
    if line.startswith("BRIEF_PASSWORD="):
        password = line.split("=", 1)[1].strip().strip('"').strip("'")
if not password:
    raise SystemExit("BRIEF_PASSWORD is missing from the password file")
pathlib.Path(dest).write_text("next=%2F&password=" + urllib.parse.quote(password, safe=""))
PY
  login="$(curl -sS -o /dev/null -c "$jar" -w "%{http_code}" -X POST \
    -H "content-type: application/x-www-form-urlencoded" \
    --data-binary @"$form" "$base_url/login")"
  rm -f "$form"
  if [[ "$login" != "303" ]]; then
    echo "login expected 303, got $login" >&2
    rm -f "$jar"
    exit 1
  fi

  deck="$(mktemp)"
  for page in / "${paths[@]/#//}"; do
    [[ "$page" == "/" ]] || page="$page/"
    authed="$(curl -sS -o "$deck" -b "$jar" -w "%{http_code}" "$base_url$page")"
    if [[ "$authed" != "200" ]] || ! grep -q "$(marker "$page")" "$deck"; then
      echo "authenticated fetch of $base_url$page failed (status $authed)" >&2
      rm -f "$deck" "$jar"
      exit 1
    fi
    echo "brief: ok $base_url$page (401 without the password, 200 with it)"
  done
  rm -f "$deck" "$jar"
}

case "$mode" in
  stage)
    render
    stage_into "$stage_target"
    echo "staged into $stage_target"
    exit 0
    ;;
  verify)
    verify
    exit 0
    ;;
esac

render
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
stage_into "$stage"

wrangler=()
if command -v wrangler >/dev/null 2>&1; then
  wrangler=("$(command -v wrangler)")
else
  echo "using npx wrangler@4.90.0"
  wrangler=(npx --yes wrangler@4.90.0)
fi

(
  cd "$stage"
  "${wrangler[@]}" pages deploy . \
    --project-name "$project" \
    --branch main \
    --commit-dirty=true \
    --commit-message "Publish the Trifold brief"
)

verify
