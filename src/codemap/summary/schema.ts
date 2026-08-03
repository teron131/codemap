/** Defines the normalized repository summary schema assembled before text presentation. */

export type ReadmeSection = {
  level: number;
  outline: boolean;
  title: string;
  content: string[];
};

export type ExportCapability = {
  label: string;
  exports: string[];
};

export type ExportSurface = {
  file: string;
  description: string | null;
  capabilities: ExportCapability[];
};

export type LanguageSummary = {
  name: string;
  share: number;
};

export type HotspotSummary = {
  name: string;
  file: string | null;
  description: string | null;
  callShare: number | null;
};

export type ClusterSummary = {
  label: string;
  description: string | null;
  codeShare: number | null;
  internalCallShare: number | null;
  topNodes: string[];
};

export type StructuralReference = {
  label: string;
  count: number | null;
  examples: string[];
};

export type StructuralSignal = {
  kind: "entry" | "coordination" | "core" | "foundation";
  source: string;
  targets: StructuralReference[];
  share: number | null;
};

export type StructuralOutline = {
  source: string;
  items: StructuralReference[];
};

export type RepositorySummary = {
  project: string;
  readme: ReadmeSection[];
  languages: LanguageSummary[];
  exportSurfaces: ExportSurface[];
  structuralSignals: StructuralSignal[];
  structuralOutlines: StructuralOutline[];
  hotspots: HotspotSummary[];
  clusters: ClusterSummary[];
  relationshipEvidenceAvailable: boolean;
  relationshipEvidenceFailureReason: string | null;
};
