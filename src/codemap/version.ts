/** Reads the version from `package.json` once at import, failing at startup when it is missing. The path is relative to this module, so `src/` and `dist/` find the same manifest. */
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
