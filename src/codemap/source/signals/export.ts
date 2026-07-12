/** Summarizes signal exports into compact metric rows and candidate tables. */
import { buildSignalExport } from "./build.js";

const SIGNAL_EXPORT_SECTIONS = [
	"relationships",
	"usage",
	"function-lengths",
	"file-profiles",
] as const;

type Row = Record<string, unknown>;

/** Builds the full signal export for a target path. */
export function runSignalsExport(root: string): Row {
	try {
		const payload = buildSignalExport(root, {
			sectionMode: [...SIGNAL_EXPORT_SECTIONS],
		});
		return {
			...payload,
			status: "ok",
		};
	} catch (error) {
		return {
			status: "error",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
