/** Resolves source imports through Oxc while retaining Codemap's repository eligibility boundary. */
import { realpathSync } from "node:fs";
import path from "node:path";

import { type NapiResolveOptions, ResolverFactory } from "oxc-resolver";

import { TYPESCRIPT_SUFFIXES } from "../scanner/constants.js";
import type { FileMetrics, TypeScriptImport } from "../scanner/metrics.js";

/** Owns one operation's resolution caches and keeps runtime package targets outside the inspected source inventory. */
export class TypeScriptResolver {
  private readonly root: string;
  private readonly imports: ResolverFactory;
  private readonly requires: ResolverFactory;

  constructor(
    root: string,
    private readonly filePaths: Set<string>,
  ) {
    this.root = realpathSync(root);
    const extensions = [...TYPESCRIPT_SUFFIXES];
    const options: NapiResolveOptions = {
      tsconfig: "auto",
      extensions,
      extensionAlias: Object.fromEntries(
        [".js", ".jsx", ".mjs", ".cjs"].map((extension) => [
          extension,
          [extension, ...extensions.filter((suffix) => suffix !== extension)],
        ]),
      ),
      conditionNames: ["source", "import", "node", "default"],
      mainFields: ["source", "module", "main"],
      builtinModules: true,
      nodePath: false,
    };
    this.imports = new ResolverFactory(options);
    this.requires = this.imports.cloneWithOptions({
      ...options,
      conditionNames: ["source", "require", "node", "default"],
    });
  }

  /** Resolves from the importing file's own tsconfig and preserves relative discovery when configuration cannot be loaded. */
  resolve(
    filePath: string,
    specifier: string,
    kind: TypeScriptImport["kind"] = "import",
  ): string[] {
    const resolver = kind === "require" ? this.requires : this.imports;
    const absolutePath = path.resolve(filePath);
    let resolved = resolver.resolveFileSync(absolutePath, specifier).path;
    if (resolved === undefined && specifier.startsWith(".")) {
      resolved = resolver.sync(path.dirname(absolutePath), specifier).path;
    }
    if (resolved === undefined) {
      return [];
    }
    const relative = path.relative(this.root, resolved).split(path.sep).join("/");
    return this.filePaths.has(relative) ? [relative] : [];
  }
}

/** Preserves import/require conditions while combining resolved import and re-export edges. */
export function typescriptImportTargets(
  filePath: string,
  metrics: FileMetrics,
  resolver: TypeScriptResolver,
): string[] {
  const targets = new Set<string>();
  for (const { target, kind } of metrics.typescriptImports) {
    for (const resolved of resolver.resolve(filePath, target, kind)) {
      targets.add(resolved);
    }
  }
  for (const target of metrics.typescriptReexportTargets) {
    for (const resolved of resolver.resolve(filePath, target)) {
      targets.add(resolved);
    }
  }
  return [...targets].sort();
}
