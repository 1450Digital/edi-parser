import boxen from "boxen";
import { render } from "cfonts";

export function shouldUseStyledOutput(noStyle?: boolean): boolean {
	return !noStyle && Boolean(process.stderr.isTTY);
}

export function printBanner(noStyle?: boolean) {
	if (!shouldUseStyledOutput(noStyle)) return;

	const output = render("EDI Parser", {
		font: "tiny",
		align: "left",
		colors: ["green"],
		letterSpacing: 1,
	});
	if (!output) return;

	process.stderr.write(`${output.string}\n`);
}

export function printSummaryBox(
	title: string,
	lines: Array<string | undefined>,
	noStyle?: boolean,
) {
	if (!shouldUseStyledOutput(noStyle)) return;

	const content = [title, ...lines.filter(Boolean)].join("\n");
	process.stderr.write(
		`${boxen(content, {
			padding: 1,
			borderStyle: "round",
			borderColor: "green",
		})}\n`,
	);
}

export function printErrorMessage(message: string, noStyle?: boolean) {
	if (!shouldUseStyledOutput(noStyle)) {
		process.stderr.write(`${message}\n`);
		return;
	}

	process.stderr.write(
		`${boxen(message, {
			padding: 1,
			borderStyle: "round",
			borderColor: "red",
		})}\n`,
	);
}
