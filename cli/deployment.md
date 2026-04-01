# CLI Deployment via GitHub Only

This CLI can be shared entirely through GitHub without npm, Homebrew, or another package registry.

## What Gets Published

Use GitHub for two things only:

1. Release assets
   Attach the compiled CLI archives to a GitHub Release.
2. Installer script
   Keep `scripts/install-cli.sh` in the repository and let users fetch it from `raw.githubusercontent.com`.

That gives you:

- A hosted installer script
- Versioned binary downloads
- A "latest" release lookup through the GitHub Releases API

## Current Repo Flow

The current release pipeline is already set up for this:

- Workflow: `.github/workflows/release.yml`
- CLI archive builder: `scripts/build-cli-release.sh`
- Installer script: `scripts/install-cli.sh`

When you push a tag like `v0.1.0`, the workflow builds CLI release artifacts and attaches them to the matching GitHub Release.

Expected release asset names:

- `edi-parser-v0.1.0-linux-x64.tar.gz`
- `edi-parser-v0.1.0-linux-arm64.tar.gz`
- `edi-parser-v0.1.0-darwin-x64.tar.gz`
- `edi-parser-v0.1.0-darwin-arm64.tar.gz`
- `edi-parser-v0.1.0-windows-x64.tar.gz`
- `SHA256SUMS.txt`

These names matter because `scripts/install-cli.sh` resolves the correct file from the user's OS and CPU architecture.

## How To Publish

From the repo root:

```bash
bun run build:cli:release
```

That writes release artifacts to:

```bash
dist/releases/
```

If you want GitHub Actions to publish them automatically, create and push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow will attach the CLI archives and checksum file to the GitHub Release for `v0.1.0`.

## How Users Install From GitHub

Latest version:

```bash
curl -fsSL https://raw.githubusercontent.com/mohamed-aalabou/edi-parser/main/scripts/install-cli.sh | bash
```

Specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/mohamed-aalabou/edi-parser/main/scripts/install-cli.sh | bash -s -- --version 0.1.0
```

Custom install directory:

```bash
curl -fsSL https://raw.githubusercontent.com/mohamed-aalabou/edi-parser/main/scripts/install-cli.sh | bash -s -- --install-dir "$HOME/.local/bin"
```

If you are distributing from a fork or another GitHub repo, set:

```bash
EDI_PARSER_GITHUB_REPO="your-org/your-repo"
```

Example:

```bash
EDI_PARSER_GITHUB_REPO="your-org/your-repo" \
curl -fsSL https://raw.githubusercontent.com/your-org/your-repo/main/scripts/install-cli.sh | bash
```

## What The Installer Does

`scripts/install-cli.sh`:

- Detects OS and architecture
- Resolves `latest` or a requested version through GitHub Releases
- Downloads the matching `.tar.gz` asset from GitHub
- Extracts the binary
- Copies it into the target install directory

No external hosting is required beyond GitHub.

## Manual Sharing Option

If you do not want users to run the install script, you can also send them directly to the GitHub Release page and have them download the matching archive manually.

Release asset URL pattern:

```text
https://github.com/<owner>/<repo>/releases/download/v<version>/edi-parser-v<version>-<platform>.tar.gz
```

Examples:

- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `windows-x64`

## Recommended GitHub-Only Setup

Keep this model:

- Binaries: GitHub Release assets
- Checksums: GitHub Release assets
- Installer: `raw.githubusercontent.com`
- Version source of truth: Git tag like `v0.1.0`

That is enough to distribute the CLI entirely through GitHub.
