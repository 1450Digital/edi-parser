import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

async function makeTempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "edi-parser-cli-"));
}

async function readSample(): Promise<string> {
	return fs.readFile(
		path.join(process.cwd(), "lib", "samples", "835-all-fields.edi"),
		"utf8",
	);
}

function runCli(args: string[]): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", ["run", "./cli/index.ts", ...args], {
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (exitCode) => {
			resolve({
				exitCode: exitCode ?? 1,
				stdout,
				stderr,
			});
		});
	});
}

describe("edi-parser CLI", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directoryPath) =>
				fs.rm(directoryPath, { recursive: true, force: true }),
			),
		);
	});

	it("parses a file to stdout and to an explicit output file", async () => {
		const tempDir = await makeTempDir();
		tempDirs.push(tempDir);

		const configPath = path.join(tempDir, "config.json");
		const inputFile = path.join(tempDir, "sample.edi");
		const outputFile = path.join(tempDir, "parsed.json");
		await fs.writeFile(inputFile, await readSample(), "utf8");

		const stdoutRun = await runCli(["parse", inputFile, "--config", configPath]);
		expect(stdoutRun.exitCode).toBe(0);
		expect(stdoutRun.stdout).not.toMatch(/\u001b\[[0-9;]*m/);
		const stdoutPayload = JSON.parse(stdoutRun.stdout);
		expect(stdoutPayload.file).toBe(inputFile);
		expect(["835", "835I", "835P"]).toContain(stdoutPayload.transactionType);

		const outputRun = await runCli([
			"parse",
			inputFile,
			"--config",
			configPath,
			"--out",
			outputFile,
		]);
		expect(outputRun.exitCode).toBe(0);
		expect(outputRun.stdout).toBe("");
		const outputPayload = JSON.parse(await fs.readFile(outputFile, "utf8"));
		expect(outputPayload.file).toBe(inputFile);
		expect(["835", "835I", "835P"]).toContain(outputPayload.transactionType);
	});

	it("writes batch manifests to stdout and disk", async () => {
		const tempDir = await makeTempDir();
		tempDirs.push(tempDir);

		const configPath = path.join(tempDir, "config.json");
		const inputDir = path.join(tempDir, "batch");
		const outputFile = path.join(tempDir, "batch.json");
		await fs.mkdir(inputDir, { recursive: true });
		await fs.writeFile(path.join(inputDir, "one.edi"), await readSample(), "utf8");
		await fs.writeFile(path.join(inputDir, "two.edi"), await readSample(), "utf8");

		const stdoutRun = await runCli(["batch", inputDir, "--config", configPath]);
		expect(stdoutRun.exitCode).toBe(0);
		expect(JSON.parse(stdoutRun.stdout)).toMatchObject({
			total: 2,
			successCount: 2,
			errorCount: 0,
		});

		const outputRun = await runCli([
			"batch",
			inputDir,
			"--config",
			configPath,
			"--out",
			outputFile,
		]);
		expect(outputRun.exitCode).toBe(0);
		expect(JSON.parse(await fs.readFile(outputFile, "utf8"))).toMatchObject({
			total: 2,
			successCount: 2,
		});
	});

	it("persists config updates and exposes the resolved config path", async () => {
		const tempDir = await makeTempDir();
		tempDirs.push(tempDir);

		const configPath = path.join(tempDir, "nested", "config.json");
		const setRun = await runCli([
			"config",
			"set",
			"defaults.type",
			"835",
			"--config",
			configPath,
		]);
		expect(setRun.exitCode).toBe(0);

		const showRun = await runCli(["config", "show", "--config", configPath]);
		expect(showRun.exitCode).toBe(0);
		expect(JSON.parse(showRun.stdout)).toMatchObject({
			defaults: { type: "835" },
		});

		const pathRun = await runCli(["config", "path", "--config", configPath]);
		expect(pathRun.exitCode).toBe(0);
		expect(pathRun.stdout.trim()).toBe(path.resolve(configPath));
	});

	it("skips unchanged files in deidentify runs and reprocesses changed files", async () => {
		const tempDir = await makeTempDir();
		tempDirs.push(tempDir);

		const configPath = path.join(tempDir, "config.json");
		const inputDir = path.join(tempDir, "input");
		const outputDir = path.join(tempDir, "output");
		const samplePath = path.join(inputDir, "sample.edi");
		await fs.mkdir(inputDir, { recursive: true });
		await fs.mkdir(outputDir, { recursive: true });
		await fs.writeFile(samplePath, await readSample(), "utf8");

		await runCli([
			"config",
			"set",
			"deidentify.inputDir",
			inputDir,
			"--config",
			configPath,
		]);
		await runCli([
			"config",
			"set",
			"deidentify.outputDir",
			outputDir,
			"--config",
			configPath,
		]);

		const firstRun = await runCli([
			"deidentify",
			"run",
			"--config",
			configPath,
		]);
		expect(firstRun.exitCode).toBe(0);
		expect(JSON.parse(firstRun.stdout)).toMatchObject({
			processed: 1,
			skipped: 0,
			failed: 0,
		});

		const secondRun = await runCli([
			"deidentify",
			"run",
			"--config",
			configPath,
		]);
		expect(secondRun.exitCode).toBe(0);
		expect(JSON.parse(secondRun.stdout)).toMatchObject({
			processed: 0,
			skipped: 1,
		});

		await new Promise((resolve) => setTimeout(resolve, 20));
		await fs.writeFile(samplePath, `${await readSample()}\nREF*EA*CLI-UPDATED~`, "utf8");

		const thirdRun = await runCli([
			"deidentify",
			"run",
			"--config",
			configPath,
		]);
		expect(thirdRun.exitCode).toBe(0);
		expect(JSON.parse(thirdRun.stdout)).toMatchObject({
			processed: 1,
			skipped: 0,
		});
	});
});
