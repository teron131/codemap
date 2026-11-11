/** Section vocabulary for `signals` and the row shapes its payload builders and text renderers exchange. */
import type { NumericStats } from "../math-utils.js";

/** Section names the `signals` command accepts, and the order the all-section payload emits. */
export const SIGNAL_SECTION_CHOICES = [
  "all",
  "top",
  "relationships",
  "files",
  "lengths",
  "functions",
  "variables",
  "usage",
  "docstring-signals",
  "docstrings",
] as const;

export type SignalSection = (typeof SIGNAL_SECTION_CHOICES)[number];

export function isSignalSection(value: string): value is SignalSection {
  return (SIGNAL_SECTION_CHOICES as readonly string[]).includes(value);
}

export type SignalRow = Record<string, unknown>;

export type SignalLanguage = "python" | "typescript";

export type LanguageRows<T extends SignalRow = SignalRow> = Record<SignalLanguage, T[]>;

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
    total_label?: "declarations" | "lines";
    lines?: number | null;
    samples?: string[];
  };

export type FileProfileRow = DenseFileRow &
  Required<FileSignalCounters> & {
    total: number;
    lines: number;
    samples: string[];
  };

/** One defined function or variable; `count` is its mention count, and `lines` is set for functions while `moduleLevel` is set for variables. */
export type DefinitionRow = SignalRow & {
  name: string;
  identifier: string;
  file: string;
  count: number;
  line: number;
  exported: boolean;
  lines?: number;
  moduleLevel?: boolean;
};

export type NameFrequencyRow = {
  name: string;
  count: number;
};

export type FunctionLengthItem = SignalRow & {
  identifier: string;
  count: number;
};

export type FunctionLengthSection<TItem extends SignalRow = FunctionLengthItem> = NumericStats & {
  items: TItem[];
};

export type FileCountRow = {
  file: string;
  count: number;
};

export type UsageSection = {
  bins: Record<
    "typescript_functions" | "typescript_variables" | "python_functions" | "python_variables",
    Record<string, number>
  >;
  tables: Record<
    | "typescript_function_definitions"
    | "typescript_variable_definitions"
    | "python_function_definitions"
    | "python_variable_definitions",
    DefinitionRow[]
  >;
};
