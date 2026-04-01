#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="edi-parser"
VERSION="${CLI_VERSION:-$(cd "$ROOT_DIR" && bun -e 'console.log(require("./package.json").version)')}"
VERSION="${VERSION#v}"
BUILD_MODE="${CLI_BUILD_MODE:-release}"

TARGETS=(
  "linux-x64:bun-linux-x64-baseline:${APP_NAME}"
  "linux-arm64:bun-linux-arm64:${APP_NAME}"
  "darwin-x64:bun-darwin-x64:${APP_NAME}"
  "darwin-arm64:bun-darwin-arm64:${APP_NAME}"
  "windows-x64:bun-windows-x64-baseline:${APP_NAME}.exe"
)

TARGET_FILTER="${CLI_TARGETS:-}"

case "$BUILD_MODE" in
  binaries)
    DIST_DIR="$ROOT_DIR/dist/cli"
    ;;
  release)
    DIST_DIR="$ROOT_DIR/dist/releases"
    ;;
  *)
    echo "Unsupported CLI_BUILD_MODE: $BUILD_MODE" >&2
    exit 1
    ;;
esac

mkdir -p "$DIST_DIR"
rm -rf "$DIST_DIR"/*

if [[ "$BUILD_MODE" == "binaries" ]]; then
  echo "Building ${APP_NAME} binaries for all supported platforms..."
else
  echo "Building ${APP_NAME} v${VERSION} release artifacts..."
fi

built_outputs=()

for target_spec in "${TARGETS[@]}"; do
  IFS=":" read -r release_label bun_target binary_name <<< "$target_spec"

  if [[ -n "$TARGET_FILTER" ]]; then
    case ",$TARGET_FILTER," in
      *",$release_label,"*) ;;
      *) continue ;;
    esac
  fi

  echo "  -> ${release_label} (${bun_target})"
  if [[ "$BUILD_MODE" == "binaries" ]]; then
    if [[ "$binary_name" == *.exe ]]; then
      output_name="${APP_NAME}-${release_label}.exe"
    else
      output_name="${APP_NAME}-${release_label}"
    fi

    binary_path="$DIST_DIR/$output_name"
    bun build --compile --target="${bun_target}" "$ROOT_DIR/cli/index.ts" --outfile "$binary_path"
    built_outputs+=("$binary_path")
  else
    staging_dir="$DIST_DIR/${APP_NAME}-v${VERSION}-${release_label}"
    archive_path="$DIST_DIR/${APP_NAME}-v${VERSION}-${release_label}.tar.gz"
    binary_path="$staging_dir/$binary_name"

    mkdir -p "$staging_dir"

    bun build --compile --target="${bun_target}" "$ROOT_DIR/cli/index.ts" --outfile "$binary_path"
    cp "$ROOT_DIR/cli/README.md" "$staging_dir/README.md"

    (
      cd "$DIST_DIR"
      tar -czf "$archive_path" "$(basename "$staging_dir")"
    )

    rm -rf "$staging_dir"
    built_outputs+=("$archive_path")
  fi
done

if [[ ${#built_outputs[@]} -eq 0 ]]; then
  echo "No targets matched CLI_TARGETS=${TARGET_FILTER:-<all>}." >&2
  exit 1
fi

echo
if [[ "$BUILD_MODE" == "release" ]]; then
  archive_names=()
  for output_path in "${built_outputs[@]}"; do
    archive_names+=("$(basename "$output_path")")
  done

  if command -v shasum >/dev/null 2>&1; then
    (
      cd "$DIST_DIR"
      shasum -a 256 -- "${archive_names[@]}" > SHA256SUMS.txt
    )
  elif command -v sha256sum >/dev/null 2>&1; then
    (
      cd "$DIST_DIR"
      sha256sum -- "${archive_names[@]}" > SHA256SUMS.txt
    )
  else
    echo "Warning: neither shasum nor sha256sum is available; skipping checksum generation." >&2
  fi

  echo "Release artifacts written to $DIST_DIR"
else
  echo "CLI binaries written to $DIST_DIR"
fi

ls -1 "$DIST_DIR"
