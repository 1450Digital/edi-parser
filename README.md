# EDI Parser CLI

The CLI supports:

- Parsing a single EDI file to JSON
- Parsing multiple files into one manifest
- Running de-identification and writing redacted EDIs to disk
- Persisting CLI settings in a local config file

## Prerequisites

- For installed CLI usage: no Bun required
- For building from source: [Bun](https://bun.sh/) installed
- If building from source, install dependencies in the repo root:

```bash
npm install
```

## Running the CLI

Recommended: install from a published GitHub release and run the CLI by name:

```bash
curl -fsSL https://raw.githubusercontent.com/1450Digital/edi-parser/main/scripts/install-cli.sh | bash
edi-parser --help
```

If you want to build and install the command from source:

```bash
bun run install:cli
edi-parser --help
```

If you only want a compiled executable for your current machine without installing it on your `PATH`:

```bash
bun run build:cli:local
./dist/edi-parser --help
```

If you want compiled executables for every supported platform:

```bash
bun run build:cli
```

This writes binaries to `dist/cli/`.

If you want release archives for GitHub Releases:

```bash
bun run build:cli:release
```

This writes `.tar.gz` archives and `SHA256SUMS.txt` to `dist/releases/`.

## Config File

By default the CLI stores config in a user-level file:

- macOS/Linux: `$XDG_CONFIG_HOME/edi-parser/config.json`
- fallback on macOS/Linux: `~/.config/edi-parser/config.json`
- Windows: `%APPDATA%/edi-parser/config.json`

State is stored next to it in `state.json`.

You can override the config location for any command:

```bash
edi-parser config show --config /tmp/edi-config.json
```

## Commands

### Parse One File

Parse one file and print JSON to stdout:

```bash
edi-parser parse ./lib/samples/835-all-fields.edi
```

Force a type:

```bash
edi-parser parse ./lib/samples/835-all-fields.edi --type 835
```

Write output to a file:

```bash
edi-parser parse ./lib/samples/835-all-fields.edi --out /tmp/parsed.json
```

Redact PHI in the parsed JSON output:

```bash
edi-parser parse ./lib/samples/835-all-fields.edi --redact-json
```

### Parse Many Files

Parse a directory:

```bash
edi-parser batch ./lib/samples
```

Parse multiple inputs:

```bash
edi-parser batch ./file-a.edi ./file-b.edi
```

Write the manifest to disk:

```bash
edi-parser batch ./lib/samples --out /tmp/batch-manifest.json
```

`batch` accepts files, directories, and glob-like inputs.

### De-identify Files

First configure the input and output directories:

```bash
edi-parser config set deidentify.inputDir /tmp/edi-in
edi-parser config set deidentify.outputDir /tmp/edi-out
```

Then run the job:

```bash
edi-parser deidentify run
```

What it does:

- Reads EDI files from the configured input directory
- Redacts PHI from the raw EDI text
- Writes `*-redacted.*` files to the configured output directory
- Writes a timestamped log file to the output directory
- Tracks processed files in `state.json`

Override directories for a single run:

```bash
edi-parser deidentify run --input-dir /tmp/edi-in --output-dir /tmp/edi-out
```

Reprocess files even if they were already tracked:

```bash
edi-parser deidentify run --force
```

Inspect current status:

```bash
edi-parser deidentify status
```

### Config Commands

Show config:

```bash
edi-parser config show
```

Show resolved config path:

```bash
edi-parser config path
```

Set supported values:

```bash
edi-parser config set defaults.type 835
edi-parser config set deidentify.inputDir /tmp/edi-in
edi-parser config set deidentify.outputDir /tmp/edi-out
```

Supported `defaults.type` values:

- `auto`
- `835`
- `835I`
- `835P`
- `837D`
- `837P`
- `837I`

## Output Behavior

- Machine-readable JSON is written to `stdout`
- Styled banners and summary boxes are written to `stderr`
- Use `--no-style` to disable styled output

Example:

```bash
edi-parser parse ./lib/samples/835-all-fields.edi --no-style
```

## Typical Workflow

Quick parse:

```bash
edi-parser parse ./lib/samples/835-all-fields.edi
```

Batch parse to a manifest:

```bash
edi-parser batch ./incoming-edis --out /tmp/manifest.json
```

De-identify a folder:

```bash
mkdir -p /tmp/edi-in /tmp/edi-out
cp ./lib/samples/835-all-fields.edi /tmp/edi-in/sample.edi

edi-parser config set deidentify.inputDir /tmp/edi-in
edi-parser config set deidentify.outputDir /tmp/edi-out
edi-parser deidentify run
```

## Tests

Run the CLI integration tests:

```bash
npx vitest run cli/cli.test.ts
```

## Release Artifacts

To build release archives for:

- Linux x64
- Linux ARM64
- macOS Intel
- macOS Apple Silicon
- Windows x64

run:

```bash
bun run build:cli:release
```

This writes `.tar.gz` archives and `SHA256SUMS.txt` to `dist/releases/`.
