/** Builds one repository summary from current-tree documentation and Codebase Memory structure. */
import path from "node:path";

import { codebaseMemoryFailureReason } from "../../codebase-memory/client.js";
import { recordValue, stringField } from "../../json-utils.js";
import { renderSummaryText } from "../presentation.js";
import type { RepositorySummary } from "../schema.js";
import { publicExportSurfaces } from "./exports.js";
import { readmeSummary } from "./readme.js";
import {
  hasRelationshipEvidence,
  relationshipEvidence,
  relationshipSummaries,
} from "./relationships.js";
import { buildSourceContext, emptySourceContext, languageSummaries } from "./source-context.js";
import { currentTreeRelationshipRows, structuralSummary } from "./structure.js";

/** Combines source-owned orientation with native architecture facts. */
export function buildRepositorySummary(root: string): RepositorySummary {
  const source = buildSourceContext(root);
  const evidence = relationshipEvidence(root, source.files.length);
  const currentTreeRelationships = currentTreeRelationshipRows(source);
  const structural = structuralSummary(
    evidence?.relationships ?? [],
    source,
    currentTreeRelationships,
  );
  const relationshipSummary =
    evidence === null ? null : relationshipSummaries(evidence.architecture, source);
  return {
    project: path.basename(root),
    readme: readmeSummary(root),
    languages: languageSummaries(source),
    exportSurfaces: publicExportSurfaces(source, structural, currentTreeRelationships),
    structuralSignals: structural.signals,
    structuralOutlines: structural.outlines,
    hotspots: relationshipSummary?.hotspots ?? [],
    clusters: relationshipSummary?.clusters ?? [],
    relationshipEvidenceAvailable: evidence !== null,
    relationshipEvidenceFailureReason: evidence === null ? codebaseMemoryFailureReason(root) : null,
  };
}

/** Renders architecture-only fixture payloads through the public summary presentation. */
export function renderCodebaseMemoryArchitectureSummary(value: unknown): string {
  const emptySource = emptySourceContext();
  const architecture = recordValue(value);
  const relationshipSummary = relationshipSummaries(architecture, emptySource);
  return renderSummaryText({
    project: stringField(architecture.project) ?? "project",
    readme: [],
    languages: [],
    exportSurfaces: [],
    structuralSignals: [],
    structuralOutlines: [],
    hotspots: relationshipSummary.hotspots,
    clusters: relationshipSummary.clusters,
    relationshipEvidenceAvailable: hasRelationshipEvidence(architecture),
    relationshipEvidenceFailureReason: null,
  });
}
