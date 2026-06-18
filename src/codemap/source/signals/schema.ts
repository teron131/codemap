/** Defines shared row shapes for signal payload construction and rendering. */
export type SignalRow = Record<string, unknown>;

export type SignalLanguage = "python" | "typescript";

export type LanguageRows<T extends SignalRow = SignalRow> = Record<
	SignalLanguage,
	T[]
>;

export type FileSignalCounters = {
	defines?: number;
	imports_local?: number;
	exports?: number;
	reexports_local?: number;
	extends?: number;
	inherits?: number;
	jsx_components?: number;
	decorators?: number;
};

export type DenseFileRow = SignalRow &
	FileSignalCounters & {
		file: string;
		total: number | null | undefined;
		total_label?: "signals" | "lines";
		lines?: number | null;
		samples?: string[];
	};

export type FileProfileRow = DenseFileRow &
	Required<FileSignalCounters> & {
		total: number;
		lines: number;
		samples: string[];
	};

export type DefinitionRow = SignalRow & {
	name?: string;
	identifier?: string;
	file?: string;
	count?: number;
	lines?: number;
	line?: number;
	exported?: boolean;
	moduleLevel?: boolean;
	refactorCandidate?: boolean;
	language?: SignalLanguage;
};

export type NameFrequencyRow = SignalRow & {
	name: string;
	count: number;
	language?: SignalLanguage;
};

export type FunctionLengthItem = SignalRow & {
	identifier: string;
	count: number;
};

export type FunctionLengthSection<
	TItem extends SignalRow = FunctionLengthItem,
> = SignalRow & {
	count: number;
	median: number;
	p90: number;
	max: number;
	items: TItem[];
};

export type FileCountRow = SignalRow & {
	file: unknown;
	count: number;
};

export type SignalFocusEntry = SignalRow & {
	score: number;
	file: string;
	role: string;
	defines: number;
	imports_local: number;
	exports: number;
	reexports_local: number;
	samples?: unknown;
	doc_preview?: unknown;
};
