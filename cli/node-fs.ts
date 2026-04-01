import fs from "node:fs/promises";
import path from "node:path";
import type { DeidentificationFileSystem } from "../lib/app-services/types";

export function createNodeDeidentificationFs(): DeidentificationFileSystem {
	return {
		readDir: async (directoryPath) => {
			const entries = await fs.readdir(directoryPath, { withFileTypes: true });

			return Promise.all(
				entries.map(async (entry) => {
					const fullPath = path.join(directoryPath, entry.name);
					const stats = await fs.stat(fullPath).catch(() => null);

					return {
						name: entry.name,
						path: fullPath,
						isDirectory: entry.isDirectory(),
						size: stats?.size,
						mtimeMs: stats?.mtimeMs,
					};
				}),
			);
		},
		readTextFile: async (filePath) => fs.readFile(filePath, "utf8"),
		writeTextFile: async (filePath, data) => {
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, data, "utf8");
		},
		stat: async (filePath) => {
			const stats = await fs.stat(filePath);
			return {
				size: stats.size,
				mtimeMs: stats.mtimeMs,
			};
		},
		joinPath: (...parts) => path.join(...parts),
		mkdir: async (directoryPath) => {
			await fs.mkdir(directoryPath, { recursive: true });
		},
	};
}
