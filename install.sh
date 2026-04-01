#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Open Canvas.app"
DEFAULT_REPO_SLUG="${OPEN_CANVAS_RELEASE_REPO:-Samin12/opencanvas}"
INSTALL_DIR="${OPEN_CANVAS_APPLICATIONS_DIR:-/Applications}"

tmp_dir=""
mount_point=""

usage() {
  cat <<'EOF'
Install Open Canvas on macOS from a GitHub release.

Usage:
  ./install.sh
  ./install.sh https://github.com/Samin12/opencanvas/releases/latest
  ./install.sh https://github.com/Samin12/opencanvas/releases/tag/v0.1.0
  ./install.sh https://github.com/Samin12/opencanvas/releases/download/v0.1.0/Open-Canvas-0.1.0-arm64.dmg
  ./install.sh Samin12/opencanvas

Behavior:
  - Downloads the matching Open Canvas DMG
  - Copies Open Canvas.app into /Applications by default
  - Makes the app available in Finder and Spotlight

Overrides:
  OPEN_CANVAS_RELEASE_REPO     Change the default GitHub repo slug
  OPEN_CANVAS_APPLICATIONS_DIR Install somewhere other than /Applications
EOF
}

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?

  if [[ -n "$mount_point" ]] && mount | grep -Fq "on ${mount_point} "; then
    hdiutil detach "$mount_point" -quiet || true
  fi

  if [[ -n "$tmp_dir" ]] && [[ -d "$tmp_dir" ]]; then
    rm -rf "$tmp_dir"
  fi

  exit "$status"
}

trap cleanup EXIT

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "Open Canvas currently ships as a macOS app only."
fi

case "$(uname -m)" in
  arm64|aarch64)
    asset_arch="arm64"
    ;;
  x86_64)
    asset_arch="x64"
    ;;
  *)
    fail "Unsupported macOS architecture: $(uname -m)"
    ;;
esac

release_input="${1:-}"
dmg_url=""

resolve_release_api_url() {
  local input="$1"

  if [[ -z "$input" ]]; then
    printf 'https://api.github.com/repos/%s/releases/latest\n' "$DEFAULT_REPO_SLUG"
    return 0
  fi

  if [[ "$input" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    printf 'https://api.github.com/repos/%s/releases/latest\n' "$input"
    return 0
  fi

  if [[ "$input" =~ ^https://github\.com/([^/]+/[^/]+)/releases/latest/?$ ]]; then
    printf 'https://api.github.com/repos/%s/releases/latest\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  if [[ "$input" =~ ^https://github\.com/([^/]+/[^/]+)/releases/tag/(.+)$ ]]; then
    printf 'https://api.github.com/repos/%s/releases/tags/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 0
  fi

  return 1
}

if [[ -n "$release_input" ]] && [[ "$release_input" == *.dmg* ]]; then
  dmg_url="$release_input"
else
  release_api_url="$(resolve_release_api_url "$release_input")" || fail "Unsupported release input: ${release_input}"
  log "Resolving Open Canvas release metadata..."

  release_json="$(curl -fsSL "$release_api_url")" || fail "Could not load release metadata from GitHub."
  dmg_candidates="$(
    printf '%s' "$release_json" |
      grep -Eo '"browser_download_url":[[:space:]]*"[^"]+\.dmg"' |
      sed -E 's/^"browser_download_url":[[:space:]]*"([^"]+)"$/\1/'
  )"

  [[ -n "$dmg_candidates" ]] || fail "No DMG asset was found in that release."

  dmg_url="$(printf '%s\n' "$dmg_candidates" | grep -E -- "-${asset_arch}\.dmg$" | head -n 1 || true)"
  if [[ -z "$dmg_url" ]]; then
    dmg_url="$(printf '%s\n' "$dmg_candidates" | head -n 1)"
  fi
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/open-canvas-install.XXXXXX")"
dmg_path="${tmp_dir}/Open-Canvas.dmg"

log "Downloading ${dmg_url}..."
curl -fL "$dmg_url" -o "$dmg_path" || fail "Download failed."

log "Mounting DMG..."
mount_output="$(hdiutil attach -nobrowse "$dmg_path")" || fail "Could not mount the DMG."
mount_point="$(printf '%s\n' "$mount_output" | awk -F '\t' '/\/Volumes\// { print $NF; exit }')"
[[ -n "$mount_point" ]] || fail "Mounted the DMG but could not find its volume."

app_source_path="$(find "$mount_point" -maxdepth 2 -name "$APP_NAME" -print -quit)"
[[ -n "$app_source_path" ]] || fail "Could not find ${APP_NAME} in the mounted DMG."

mkdir -p "$INSTALL_DIR"
target_app_path="${INSTALL_DIR}/${APP_NAME}"

if [[ -e "$target_app_path" ]]; then
  log "Removing existing ${target_app_path}..."
  if [[ -w "$INSTALL_DIR" ]]; then
    rm -rf "$target_app_path"
  else
    sudo rm -rf "$target_app_path"
  fi
fi

log "Installing ${APP_NAME} into ${INSTALL_DIR}..."
if [[ -w "$INSTALL_DIR" ]]; then
  ditto "$app_source_path" "$target_app_path"
else
  sudo ditto "$app_source_path" "$target_app_path"
fi

touch "$target_app_path" || true
if command -v mdimport >/dev/null 2>&1; then
  mdimport "$target_app_path" >/dev/null 2>&1 || true
fi

log "Installed ${APP_NAME} to ${target_app_path}."
log "You can open it from Applications or launch it with Spotlight."
