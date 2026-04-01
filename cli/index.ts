#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";
import { defineCommand, runMain } from "citty";
import { parseBatchEdi, parseSingleEdi } from "../lib/app-services/edi";
import {
	loadConfig,
	loadState,
	resolveCliPaths,
	saveConfig,
	saveState,
	setCliConfigValue,
} from "../lib/app-services/cli-config";
import { runDeidentificationJob } from "../lib/app-services/deidentify";
import {
	SUPPORTED_TRANSACTION_TYPES,
	isCliTransactionType,
} from "../lib/app-services/types";
import type {
	BatchManifestEntry,
	CliTransactionType,
	ParseSingleResult,
} from "../lib/app-services/types";
import pkg from "../package.json";
import { createNodeDeidentificationFs } from "./node-fs";
import { printBanner, printErrorMessage, printSummaryBox } from "./ui";

type CommandArgs = Record<string, unknown> & {
	noStyle?: boolean;
	config?: string;
	_?: unknown[];
};

type BunGlobRuntime = {
	Glob: new (pattern: string) => {
		scan(options?: {
			cwd?: string;
			onlyFiles?: boolean;
		}): AsyncIterable<string>;
	};
};

const CLI_TRANSACTION_TYPE_OPTIONS = [
	"auto",
	...SUPPORTED_TRANSACTION_TYPES,
] as const;

const commonArgs = {
	config: {
		type: "string" as const,
		description: "Path to the CLI config file.",
		alias: ["c"],
	},
	"no-style": {
		type: "boolean" as const,
		description: "Disable banner and framed stderr output.",
		default: false,
	},
};

function getBunRuntime(): BunGlobRuntime {
	const runtime = (globalThis as { Bun?: BunGlobRuntime }).Bun;
	if (!runtime) {
		throw new Error("This CLI must be run with Bun.");
	}
	return runtime;
}

function getNoStyle(args: CommandArgs): boolean {
	return Boolean(args.noStyle ?? args["no-style"]);
}

function readCliTransactionType(
	value: unknown,
	label: string,
): CliTransactionType | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !isCliTransactionType(value)) {
		throw new Error(`${label} must be one of: ${CLI_TRANSACTION_TYPE_OPTIONS.join(", ")}`);
	}
	return value;
}

function hasGlobPattern(value: string): boolean {
	return /[*?[\]{}]/.test(value);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function toSerializableParseResult(
	filePath: string,
	result: ParseSingleResult,
	redactJson = false,
) {
	return {
		file: filePath,
		transactionType: result.transactionType,
		selectedType: result.selectedType,
		usedType: result.usedType,
		warning: result.warning,
		parsed: redactJson ? (result.redactedParsed ?? result.parsed) : result.parsed,
	};
}

function toSerializableBatchEntry(
	filePath: string,
	entry: BatchManifestEntry,
): Record<string, unknown> {
	if (entry.status === "error") {
		return {
			file: filePath,
			status: entry.status,
			error: entry.error,
		};
	}

	return {
		file: filePath,
		status: entry.status,
		transactionType: entry.transactionType,
		selectedType: entry.selectedType,
		usedType: entry.usedType,
		warning: entry.warning,
		parsed: entry.parsed,
	};
}

async function writeOutput(payload: unknown, outPath?: string): Promise<void> {
	const serialized =
		typeof payload === "string"
			? payload.endsWith("\n")
				? payload
				: `${payload}\n`
			: `${JSON.stringify(payload, null, 2)}\n`;

	if (outPath) {
		const resolved = path.resolve(outPath);
		await fs.mkdir(path.dirname(resolved), { recursive: true });
		await fs.writeFile(resolved, serialized, "utf8");
		return;
	}

	process.stdout.write(serialized);
}

function initializeCommand(args: CommandArgs) {
	printBanner(getNoStyle(args));
}

async function statPath(targetPath: string) {
	return fs.stat(targetPath).catch(() => null);
}

async function scanDirectory(directoryPath: string): Promise<string[]> {
	const runtime = getBunRuntime();
	const glob = new runtime.Glob("**/*");
	const matches: string[] = [];

	for await (const relativePath of glob.scan({
		cwd: directoryPath,
		onlyFiles: true,
	})) {
		matches.push(path.resolve(directoryPath, relativePath));
	}

	return matches;
}

function splitGlobPattern(pattern: string): { cwd: string; pattern: string } {
	const absolute = path.resolve(pattern);
	const root = path.parse(absolute).root;
	const relativeToRoot = absolute.slice(root.length);
	const segments = relativeToRoot.split(path.sep).filter(Boolean);
	const baseSegments: string[] = [];
	const patternSegments: string[] = [];
	let patternStarted = false;

	for (const segment of segments) {
		if (!patternStarted && !hasGlobPattern(segment)) {
			baseSegments.push(segment);
			continue;
		}

		patternStarted = true;
		patternSegments.push(segment);
	}

	if (!patternStarted) {
		return {
			cwd: path.dirname(absolute),
			pattern: path.basename(absolute),
		};
	}

	return {
		cwd: path.join(root, ...baseSegments),
		pattern: patternSegments.join("/"),
	};
}

async function expandInputPatterns(inputs: string[]): Promise<string[]> {
	const runtime = getBunRuntime();
	const collected = new Set<string>();

	for (const input of inputs) {
		if (hasGlobPattern(input)) {
			const { cwd, pattern } = splitGlobPattern(input);
			const glob = new runtime.Glob(pattern);
			for await (const relativePath of glob.scan({ cwd, onlyFiles: true })) {
				collected.add(path.resolve(cwd, relativePath));
			}
			continue;
		}

		const resolved = path.resolve(input);
		const stats = await statPath(resolved);
		if (!stats) {
			throw new Error(`Input not found: ${input}`);
		}
		if (stats.isDirectory()) {
			for (const filePath of await scanDirectory(resolved)) {
				collected.add(filePath);
			}
			continue;
		}
		if (!stats.isFile()) {
			throw new Error(`Input is not a readable file: ${input}`);
		}
		collected.add(resolved);
	}

	return [...collected].sort((left, right) => left.localeCompare(right));
}

function collectPositionalInputs(args: CommandArgs, firstKey: string): string[] {
	const values: string[] = [];
	const firstValue = args[firstKey];
	if (typeof firstValue === "string" && firstValue.length > 0) {
		values.push(firstValue);
	}

	for (const value of args._ ?? []) {
		if (typeof value === "string") {
			values.push(value);
		}
	}

	return values;
}

const parseCommand = defineCommand({
	meta: {
		name: "parse",
		description: "Parse a single EDI file.",
	},
	args: {
		...commonArgs,
		file: {
			type: "positional" as const,
			description: "Path to the EDI file.",
			required: true,
		},
		type: {
			type: "string" as const,
			description: "Transaction type to use instead of auto-detection.",
		},
		out: {
			type: "string" as const,
			description: "Write the parse result JSON to this file.",
		},
		"redact-json": {
			type: "boolean" as const,
			description: "Redact PHI in the parsed JSON output.",
			default: false,
		},
	},
	async run({ args }) {
		initializeCommand(args as CommandArgs);

		const { configPath } = resolveCliPaths(
			args.config ? String(args.config) : undefined,
		);
		const config = await loadConfig(configPath, { strict: true });
		const filePath = path.resolve(String(args.file));
		const content = await fs.readFile(filePath, "utf8");
		const commandType = readCliTransactionType(args.type, "type");
		const result = parseSingleEdi(content, {
			type: commandType ?? config.defaults.type,
			redactJson: Boolean(args.redactJson),
		});
		const payload = toSerializableParseResult(
			filePath,
			result,
			Boolean(args.redactJson),
		);

		await writeOutput(payload, args.out ? String(args.out) : undefined);
		printSummaryBox(
			"Parse complete",
			[
				`File: ${filePath}`,
				`Detected type: ${result.transactionType}`,
				`Used type: ${result.usedType}`,
				result.warning ? `Warning: ${result.warning}` : undefined,
			],
			getNoStyle(args as CommandArgs),
		);
	},
});

const batchCommand = defineCommand({
	meta: {
		name: "batch",
		description: "Parse multiple EDI files into one manifest.",
	},
	args: {
		...commonArgs,
		input: {
			type: "positional" as const,
			description: "A file, directory, or glob pattern.",
			required: true,
		},
		type: {
			type: "string" as const,
			description: "Transaction type to use instead of auto-detection.",
		},
		out: {
			type: "string" as const,
			description: "Write the batch manifest JSON to this file.",
		},
	},
	async run({ args }) {
		initializeCommand(args as CommandArgs);

		const { configPath } = resolveCliPaths(
			args.config ? String(args.config) : undefined,
		);
		const config = await loadConfig(configPath, { strict: true });
		const inputs = collectPositionalInputs(args as CommandArgs, "input");
		const filePaths = await expandInputPatterns(inputs);
		if (filePaths.length === 0) {
			throw new Error("No files matched the provided inputs.");
		}
		const commandType = readCliTransactionType(args.type, "type");

		const batchFiles = await Promise.all(
			filePaths.map(async (filePath) => ({
				path: filePath,
				filename: path.basename(filePath),
				content: await fs.readFile(filePath, "utf8"),
			})),
		);
		const manifest = parseBatchEdi(
			batchFiles.map((file) => ({
				filename: file.filename,
				content: file.content,
			})),
			{
				type: commandType ?? config.defaults.type,
			},
		);
		const payload = {
			total: manifest.total,
			successCount: manifest.successCount,
			errorCount: manifest.errorCount,
			selectedType: manifest.selectedType,
			entries: manifest.entries.map((entry, index) =>
				toSerializableBatchEntry(batchFiles[index]!.path, entry),
			),
		};

		await writeOutput(payload, args.out ? String(args.out) : undefined);
		printSummaryBox(
			"Batch complete",
			[
				`Matched files: ${manifest.total}`,
				`Successful parses: ${manifest.successCount}`,
				manifest.errorCount ? `Failed parses: ${manifest.errorCount}` : undefined,
			],
			getNoStyle(args as CommandArgs),
		);

		if (manifest.errorCount > 0) {
			process.exitCode = 1;
		}
	},
});

const deidentifyRunCommand = defineCommand({
	meta: {
		name: "run",
		description: "De-identify files from the configured input directory.",
	},
	args: {
		...commonArgs,
		"input-dir": {
			type: "string" as const,
			description: "Override the configured input directory for this run.",
		},
		"output-dir": {
			type: "string" as const,
			description: "Override the configured output directory for this run.",
		},
		type: {
			type: "string" as const,
			description: "Override the configured parser type for this run.",
		},
		force: {
			type: "boolean" as const,
			description: "Ignore the processed-file state and reprocess every file.",
			default: false,
		},
	},
	async run({ args }) {
		initializeCommand(args as CommandArgs);

		const { configPath, statePath } = resolveCliPaths(
			args.config ? String(args.config) : undefined,
		);
		const config = await loadConfig(configPath, { strict: true });
		const state = await loadState(statePath);
		const commandType = readCliTransactionType(args.type, "type");
		const result = await runDeidentificationJob(
			createNodeDeidentificationFs(),
			config,
			state,
			{
				inputDir: args.inputDir ? path.resolve(String(args.inputDir)) : undefined,
				outputDir: args.outputDir
					? path.resolve(String(args.outputDir))
					: undefined,
				type: commandType,
				force: Boolean(args.force),
				now: new Date(),
			},
		);

		await saveState(statePath, result.state);
		await writeOutput({
			processed: result.processed,
			skipped: result.skipped,
			failed: result.failed,
			logFile: result.logFile,
			logPath: result.logPath,
			outputDir: result.outputDir,
			files: result.fileResults,
		});
		printSummaryBox(
			"De-identification complete",
			[
				`Config: ${configPath}`,
				`Processed: ${result.processed}`,
				result.skipped ? `Skipped: ${result.skipped}` : undefined,
				result.failed ? `Failed: ${result.failed}` : undefined,
				`Log: ${result.logPath}`,
			],
			getNoStyle(args as CommandArgs),
		);

		if (result.failed > 0) {
			process.exitCode = 1;
		}
	},
});

const deidentifyStatusCommand = defineCommand({
	meta: {
		name: "status",
		description: "Show de-identification config and last run information.",
	},
	args: {
		...commonArgs,
	},
	async run({ args }) {
		initializeCommand(args as CommandArgs);

		const { configPath, statePath } = resolveCliPaths(
			args.config ? String(args.config) : undefined,
		);
		const config = await loadConfig(configPath, { strict: true });
		const state = await loadState(statePath);
		const processedFileCount = Object.keys(state.processedFiles).length;

		await writeOutput({
			configPath,
			statePath,
			config,
			lastRunAt: state.lastRunAt,
			lastRunSummary: state.lastRunSummary,
			processedFileCount,
		});
		printSummaryBox(
			"De-identification status",
			[
				`Config: ${configPath}`,
				`Input dir: ${config.deidentify.inputDir || "(not set)"}`,
				`Output dir: ${config.deidentify.outputDir || "(not set)"}`,
				`Tracked files: ${processedFileCount}`,
			],
			getNoStyle(args as CommandArgs),
		);
	},
});

const configShowCommand = defineCommand({
	meta: {
		name: "show",
		description: "Print the active CLI config.",
	},
	args: {
		...commonArgs,
	},
	async run({ args }) {
		initializeCommand(args as CommandArgs);

		const { configPath } = resolveCliPaths(
			args.config ? String(args.config) : undefined,
		);
		const config = await loadConfig(configPath, { strict: true });

		await writeOutput(config);
		printSummaryBox(
			"Config loaded",
			[`Config: ${configPath}`],
			getNoStyle(args as CommandArgs),
		);
	},
});

const configSetCommand = defineCommand({
	meta: {
		name: "set",
		description: "Update a supported config value.",
	},
	args: {
		...commonArgs,
		key: {
			type: "positional" as const,
			description: "Config key to update.",
			required: true,
		},
		value: {
			type: "positional" as const,
			description: "Value to write.",
			required: true,
		},
	},
	async run({ args }) {
		initializeCommand(args as CommandArgs);

		const key = String(args.key) as
			| "defaults.type"
			| "deidentify.inputDir"
			| "deidentify.outputDir";
		if (
			key !== "defaults.type" &&
			key !== "deidentify.inputDir" &&
			key !== "deidentify.outputDir"
		) {
			throw new Error(`Unsupported config key: ${key}`);
		}

		const { configPath } = resolveCliPaths(
			args.config ? String(args.config) : undefined,
		);
		const config = await loadConfig(configPath, { strict: true });
		const rawValue = String(args.value);
		const normalizedValue =
			key === "defaults.type" ? rawValue : path.resolve(rawValue);
		const nextConfig = setCliConfigValue(config, key, normalizedValue);

		await saveConfig(configPath, nextConfig);
		await writeOutput(nextConfig);
		printSummaryBox(
			"Config updated",
			[`Config: ${configPath}`, `Updated: ${key}`],
			getNoStyle(args as CommandArgs),
		);
	},
});

const configPathCommand = defineCommand({
	meta: {
		name: "path",
		description: "Print the resolved config file path.",
	},
	args: {
		...commonArgs,
	},
	async run({ args }) {
		initializeCommand(args as CommandArgs);

		const { configPath } = resolveCliPaths(
			args.config ? String(args.config) : undefined,
		);

		await writeOutput(configPath);
		printSummaryBox(
			"Config path",
			[`Config: ${configPath}`],
			getNoStyle(args as CommandArgs),
		);
	},
});

const main = defineCommand({
	meta: {
		name: "edi-parser",
		version: pkg.version,
		description: "CLI for EDI parsing and de-identification.",
	},
	args: {
		...commonArgs,
	},
	subCommands: {
		parse: parseCommand,
		batch: batchCommand,
		deidentify: defineCommand({
			meta: {
				name: "deidentify",
				description: "Run or inspect the de-identification pipeline.",
			},
			args: {
				...commonArgs,
			},
			subCommands: {
				run: deidentifyRunCommand,
				status: deidentifyStatusCommand,
			},
		}),
		config: defineCommand({
			meta: {
				name: "config",
				description: "Show or update CLI configuration.",
			},
			args: {
				...commonArgs,
			},
			subCommands: {
				show: configShowCommand,
				set: configSetCommand,
				path: configPathCommand,
			},
		}),
	},
});

runMain(main).catch((error) => {
	printErrorMessage(toErrorMessage(error));
	process.exit(1);
});
