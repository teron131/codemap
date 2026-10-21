/** Language-neutral documentation report shapes. A non-null `parseError` marks documentation as incomplete rather than absent. */
import { PYTHON_SUFFIXES, TYPESCRIPT_SUFFIXES } from "../scanner/constants.js";

export const DOCSTRING_SUFFIXES = new Set([...PYTHON_SUFFIXES, ...TYPESCRIPT_SUFFIXES]);

export const LIKELY_MAIN_FUNCTION_NAMES = [
  "main",
  "run",
  "start",
  "serve",
  "cli",
  "app",
  "create_app",
  "build_app",
  "invoke",
  "execute",
  "handler",
] as const;

export const LIKELY_MAIN_FUNCTION_PREFIXES = [
  "build_",
  "create_",
  "load_",
  "fetch_",
  "resolve_",
  "get_",
  "display_",
] as const;

/** `inputs` and `outputs` are display text, with `none` for no parameters and `unannotated` for a missing return annotation. */
export type FunctionReport = {
  name: string;
  lineno: number;
  inputs: string;
  outputs: string;
  docstring: string | null;
  nestedFunctions: FunctionReport[];
};

export type ClassReport = {
  name: string;
  lineno: number;
  docstring: string | null;
  methods: FunctionReport[];
  nestedClasses: ClassReport[];
};

export type FileReport = {
  path: string;
  displayPath: string;
  fileDocstring: string | null;
  functions: FunctionReport[];
  classes: ClassReport[];
  parseError: string | null;
};
