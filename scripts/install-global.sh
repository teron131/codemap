#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
codex_home="${CODEX_HOME:-"$HOME/.codex"}"
skill_source="$repo_root/skills/codemap"
skill_target="$codex_home/skills/codemap"

if command -v pnpm >/dev/null 2>&1; then
	package_manager="pnpm"
else
	package_manager="npm"
fi

cd "$repo_root"

echo "Using $package_manager"
if [ "$package_manager" = "pnpm" ]; then
	pnpm install
	pnpm run build
	pnpm add -g .
else
	npm install
	npm run build
	npm install -g .
fi

if [ ! -d "$skill_source" ]; then
	echo "Missing Codex skill: $skill_source" >&2
	exit 1
fi

mkdir -p "$codex_home/skills"
rm -rf "$skill_target"
mkdir -p "$skill_target"
cp -R "$skill_source"/. "$skill_target"/

echo "Installed codemap CLI: $(command -v codemap)"
echo "Installed Codex skill: $skill_target"
