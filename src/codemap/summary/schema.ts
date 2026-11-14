/** Repository summary shape that `architecture/pipeline.ts` assembles and `presentation.ts` renders. Share fields are fractions of 1. */

export type ReadmeSection = {
  level: number;
  outline: boolean;
  title: string;
  content: string[];
};

/** A module a public surface exposes directly; `exports` lists its names only when they clearly belong to that module. */
export type ExposedModule = {
  label: string;
  exports: string[];
};

export type PublicSurface = {
  file: string;
  description: string | null;
  modules: ExposedModule[];
};

export type LanguageSummary = {
  name: string;
  share: number;
};

export type MostCalledSymbol = {
  name: string;
  file: string | null;
  description: string | null;
  callShare: number | null;
};

export type ClusterSummary = {
  label: string;
  description: string | null;
  symbolShare: number | null;
  internalCallShare: number | null;
  topNodes: string[];
};

export type StructuralReference = {
  label: string;
  count: number | null;
  examples: string[];
};

/** `related` holds what the boundary imports for `entry` and `coordination`, its importers for `foundation`, and both for `core`; `share` is the fraction of connected boundaries importing it. */
export type StructuralRole = {
  kind: "entry" | "coordination" | "core" | "foundation";
  boundary: string;
  related: StructuralReference[];
  share: number | null;
};

export type StructuralOutline = {
  boundary: string;
  items: StructuralReference[];
};

export type RepositorySummary = {
  project: string;
  readme: ReadmeSection[];
  languages: LanguageSummary[];
  /** Languages present only through Codebase Memory, whose public API and import structure are therefore absent. */
  backendOnlyLanguages: string[];
  publicSurfaces: PublicSurface[];
  structuralRoles: StructuralRole[];
  structuralOutlines: StructuralOutline[];
  mostCalled: MostCalledSymbol[];
  clusters: ClusterSummary[];
  relationshipEvidenceAvailable: boolean;
  relationshipEvidenceFailureReason: string | null;
};
