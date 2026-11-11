/** Builds and renders the structural references that role selection, outlines, and the summary text share. */
import { extentSamples } from "../text-utils.js";
import type { StructuralReference } from "./schema.js";

export function explicitReference(label: string): StructuralReference {
  return { label, count: null, examples: [] };
}

/** `members` must already be sorted, since the examples are its first, middle, and last entries. */
export function groupedReference(label: string, members: string[]): StructuralReference {
  return { label, count: members.length, examples: extentSamples(members) };
}

/** Counted groups render with their extent samples, as in `packages/* [5]: api, …, core, …, web`. */
export function renderStructuralReference(reference: StructuralReference): string {
  if (reference.count === null) {
    return reference.label;
  }
  return `${reference.label} [${reference.count}]: ${renderStructuralExamples(reference)}`;
}

/** Marks only real gaps between sorted first, middle, and last extent samples. */
function renderStructuralExamples(reference: StructuralReference): string {
  const examples = reference.examples;
  if (reference.count === null || reference.count <= examples.length || examples.length !== 3) {
    return examples.join(", ");
  }
  const positions = [0, Math.floor((reference.count - 1) / 2), reference.count - 1];
  const rendered = [examples[0] ?? ""];
  for (let index = 1; index < examples.length; index += 1) {
    if ((positions[index] ?? 0) - (positions[index - 1] ?? 0) > 1) {
      rendered.push("…");
    }
    rendered.push(examples[index] ?? "");
  }
  return rendered.filter(Boolean).join(", ");
}
