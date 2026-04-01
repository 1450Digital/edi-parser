#!/usr/bin/env bash

set -euo pipefail

APP_NAME="edi-parser"
REPO="${EDI_PARSER_GITHUB_REPO:-1450Digital/edi-parser}"
INSTALL_DIR="${EDI_PARSER_INSTALL_DIR:-$HOME/.local/bin}"
REQUESTED_VERSION="${EDI_PARSER_VERSION:-latest}"
RELEASE_BASE_URL="${EDI_PARSER_RELEASE_BASE_URL:-}"

usage() {
  cat <<EOF
Install ${APP_NAME} from GitHub release artifacts.

Usage:
  $0 [--version <version|latest>] [--install-dir <dir>]

Environment variables:
  EDI_PARSER_VERSION           Release version or 'latest'
  EDI_PARSER_INSTALL_DIR       Install directory (default: ~/.local/bin)
  EDI_PARSER_GITHUB_REPO       GitHub repo slug (default: 1450Digital/edi-parser)
  EDI_PARSER_RELEASE_BASE_URL  Override download base URL for testing
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      REQUESTED_VERSION="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd curl
need_cmd tar
need_cmd mktemp

detect_os() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    Darwin) echo "darwin" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)
      echo "Unsupported operating system: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

resolve_release_label() {
  local os arch
  os="$(detect_os)"
  arch="$(detect_arch)"

  case "${os}-${arch}" in
    linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64)
      echo "${os}-${arch}"
      ;;
    windows-arm64)
      echo "No published ${APP_NAME} binary for windows-arm64." >&2
      exit 1
      ;;
    *)
      echo "Unsupported platform: ${os}-${arch}" >&2
      exit 1
      ;;
  esac
}

github_api_get() {
  local url="$1"
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" "$url"
  else
    curl -fsSL -H "Accept: application/vnd.github+json" "$url"
  fi
}

resolve_tag() {
  if [[ -n "$RELEASE_BASE_URL" ]]; then
    local version="${REQUESTED_VERSION#v}"
    echo "v${version}"
    return
  fi

  if [[ "$REQUESTED_VERSION" == "latest" ]]; then
    local response tag
    response="$(github_api_get "https://api.github.com/repos/${REPO}/releases/latest")"
    tag="$(printf '%s' "$response" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
    if [[ -z "$tag" ]]; then
      echo "Failed to resolve the latest release tag from GitHub." >&2
      exit 1
    fi
    echo "$tag"
    return
  fi

  local normalized="${REQUESTED_VERSION#v}"
  echo "v${normalized}"
}

main() {
  local release_label tag version asset_name binary_name download_url tmp_dir archive_path extracted_binary
  release_label="$(resolve_release_label)"
  tag="$(resolve_tag)"
  version="${tag#v}"
  asset_name="${APP_NAME}-v${version}-${release_label}.tar.gz"

  if [[ "$(detect_os)" == "windows" ]]; then
    binary_name="${APP_NAME}.exe"
  else
    binary_name="${APP_NAME}"
  fi

  if [[ -n "$RELEASE_BASE_URL" ]]; then
    download_url="${RELEASE_BASE_URL%/}/${asset_name}"
  else
    download_url="https://github.com/${REPO}/releases/download/${tag}/${asset_name}"
  fi

  tmp_dir="$(mktemp -d)"
  trap "rm -rf '$tmp_dir'" EXIT
  archive_path="$tmp_dir/$asset_name"

  echo "Downloading ${asset_name}..."
  curl -fsSL "$download_url" -o "$archive_path"

  tar -xzf "$archive_path" -C "$tmp_dir"
  extracted_binary="$(find "$tmp_dir" -type f \( -name "${APP_NAME}" -o -name "${APP_NAME}.exe" \) | head -n1)"

  if [[ -z "$extracted_binary" ]]; then
    echo "Failed to locate the extracted ${APP_NAME} binary." >&2
    exit 1
  fi

  mkdir -p "$INSTALL_DIR"
  cp "$extracted_binary" "$INSTALL_DIR/$binary_name"
  chmod +x "$INSTALL_DIR/$binary_name" 2>/dev/null || true

  echo "Installed ${APP_NAME} ${tag} to ${INSTALL_DIR}/${binary_name}"

  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      echo
      echo "Add ${INSTALL_DIR} to your PATH to run '${APP_NAME}' directly."
      ;;
  esac

  echo
  echo "Verify:"
  echo "  ${INSTALL_DIR}/${binary_name} --help"
}

main
