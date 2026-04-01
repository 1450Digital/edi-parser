#!/usr/bin/env bun

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function decodeOutput(value: Uint8Array | undefined): string {
	return value ? new TextDecoder().decode(value).trim() : "";
}

function getBinaryName(): string {
	return process.platform === "win32" ? "edi-parser.exe" : "edi-parser";
}

function getFallbackGlobalBinDir(): string {
	if (process.platform === "win32") {
		return path.join(process.env.USERPROFILE ?? os.homedir(), ".bun", "bin");
	}

	return path.join(os.homedir(), ".bun", "bin");
}

function resolveGlobalBinDir(): string {
	if (process.env.EDI_PARSER_INSTALL_DIR) {
		return path.resolve(process.env.EDI_PARSER_INSTALL_DIR);
	}

	const bunRuntime = (globalThis as { Bun?: any }).Bun;
	const result = bunRuntime?.spawnSync(["bun", "pm", "bin", "-g"], {
		stdout: "pipe",
		stderr: "pipe",
	});

	if (result && result.exitCode === 0) {
		const output = decodeOutput(result.stdout);
		if (output) return output;
	}

	return getFallbackGlobalBinDir();
}

async function buildCli(repoRoot: string, outputPath: string): Promise<void> {
	const bunRuntime = (globalThis as { Bun?: any }).Bun;
	if (!bunRuntime) {
		throw new Error("The install script must be run with Bun.");
	}

	const result = bunRuntime.spawnSync(
		[
			"bun",
			"build",
			"--compile",
			path.join(repoRoot, "cli", "index.ts"),
			"--outfile",
			outputPath,
		],
		{
			cwd: repoRoot,
			stdout: "inherit",
			stderr: "inherit",
		},
	);

	if (result.exitCode !== 0) {
		throw new Error("Failed to build the CLI executable.");
	}
}

async function installBinary(
	builtBinaryPath: string,
	globalBinDir: string,
): Promise<string> {
	await fs.mkdir(globalBinDir, { recursive: true });
	const targetPath = path.join(globalBinDir, path.basename(builtBinaryPath));

	if (process.platform === "win32") {
		await fs.copyFile(builtBinaryPath, targetPath);
		return targetPath;
	}

	await fs.rm(targetPath, { force: true });
	await fs.symlink(builtBinaryPath, targetPath);
	return targetPath;
}

async function main() {
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	const repoRoot = path.resolve(scriptDir, "..");
	const binaryName = getBinaryName();
	const outputPath = path.join(repoRoot, "dist", binaryName);
	const globalBinDir = resolveGlobalBinDir();

	await buildCli(repoRoot, outputPath);
	const installedPath = await installBinary(outputPath, globalBinDir);

	console.log(`Built CLI: ${outputPath}`);
	console.log(`Installed command: ${installedPath}`);
	console.log("You can now run: edi-parser --help");
}

main().catch((error) => {
	console.error(
		error instanceof Error ? error.message : String(error ?? "Unknown error"),
	);
	process.exit(1);
});
