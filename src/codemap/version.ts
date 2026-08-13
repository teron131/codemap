/** Exposes the package-owned Codemap version to runtime integrations. */
import { readFileSync } from "node:fs";

type PackageMetadata = {
  version?: unknown;
};

const metadata = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as PackageMetadata;

if (typeof metadata.version !== "string" || metadata.version.length === 0) {
  throw new Error("Codemap package metadata does not define a version.");
}

export const CODEMAP_VERSION = metadata.version;
