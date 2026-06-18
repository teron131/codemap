/** Checks compact signal export summaries. */
import { describe, expect, it } from "vitest";
import { signalMetrics } from "../src/codemap/source/signals/export.js";

describe("signal export metrics", () => {
	it("uses source-only variable rows for noisy variable overview metrics", () => {
		const metrics = signalMetrics({
			status: "ok",
			sections: {
				usage_signals: {
					tables: {
						python_variables: [{ name: "testOnly", count: 99 }],
						source_python_variables: [{ name: "sourceOnly", count: 7 }],
						typescript_variables: [{ name: "testOnlyTs", count: 88 }],
						source_typescript_variables: [{ name: "sourceOnlyTs", count: 6 }],
					},
				},
			},
		});

		expect(metrics.usageSignals).toMatchObject({
			noisyVariables: {
				python: [{ name: "sourceOnly", count: 7 }],
				typescript: [{ name: "sourceOnlyTs", count: 6 }],
			},
		});
	});

	it("does not use all-file variable rows when source rows are absent", () => {
		const metrics = signalMetrics({
			status: "ok",
			sections: {
				usage_signals: {
					tables: {
						python_variables: [{ name: "allFilePy", count: 2 }],
						typescript_variables: [{ name: "allFileTs", count: 3 }],
					},
				},
			},
		});

		expect(metrics.usageSignals).toMatchObject({
			noisyVariables: {
				python: [],
				typescript: [],
			},
		});
	});
});
