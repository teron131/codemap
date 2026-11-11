/** Builds one repository summary from working-tree documentation and Codebase Memory structure. The local skeleton and public API survive when the backend is unavailable. */
import path from "node:path";

import { codebaseMemoryFailureReason } from "../../codebase-memory/index.js";
import type { RepositorySummary } from "../schema.js";
import { publicExportSurfaces } from "./exports.js";
import { readmeSummary } from "./readme.js";
import {
  fetchRelationshipEvidence,
  relationshipSummaries,
  workingTreeRelationshipRows,
} from "./relationships.js";
import { buildSourceContext, languageSummaries } from "./source-context.js";
import { structuralSummary } from "./structure.js";

export function buildRepositorySummary(root: string): RepositorySummary {
  const source = buildSourceContext(root);
  const evidence = fetchRelationshipEvidence(root, source.files.length);
  const workingTreeRelationships = workingTreeRelationshipRows(source);
  const structural = structuralSummary(
    evidence?.relationships ?? [],
    source,
    workingTreeRelationships,
  );
  const relationshipSummary =
    evidence === null ? null : relationshipSummaries(evidence.architecture, source);
  return {
    project: path.basename(root),
    readme: readmeSummary(root),
    languages: languageSummaries(source),
    publicSurfaces: publicExportSurfaces(source, structural, workingTreeRelationships),
    structuralRoles: structural.roles,
    structuralOutlines: structural.outlines,
    mostCalled: relationshipSummary?.mostCalled ?? [],
    clusters: relationshipSummary?.clusters ?? [],
    relationshipEvidenceAvailable: evidence !== null,
    relationshipEvidenceFailureReason: evidence === null ? codebaseMemoryFailureReason(root) : null,
  };
}
