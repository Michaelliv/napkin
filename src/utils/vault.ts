import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_CONFIG, SIBLING_VAULT_LAYOUT } from "./config.js";
import { CONFIG_FILE } from "./vault-internals.js";

export interface VaultInfo {
  /** Vault display name (derived from content root directory) */
  name: string;
  /** Where vault content lives (project root, parent of .napkin/) */
  contentPath: string;
  /** Where config.json lives (always the .napkin/ directory) */
  configPath: string;
  /** Where .obsidian/ directory lives */
  obsidianPath: string;
}

/**
 * Walk up from startDir looking for .napkin/ (or .obsidian/.napkin/ for nested layout).
 * Resolves the vault layout from config to determine content, config, and obsidian paths.
 */
export function findVault(startDir?: string): VaultInfo {
  let dir = path.resolve(startDir || process.cwd());
  const root = path.parse(dir).root;

  const startingDir = dir;

  while (true) {
    const napkinDir = path.join(dir, ".napkin");

    if (fs.existsSync(napkinDir) && fs.statSync(napkinDir).isDirectory()) {
      return resolveVaultLayout(napkinDir, dir);
    }

    // Check for nested layout: .obsidian/.napkin/
    const nestedNapkin = path.join(dir, ".obsidian", ".napkin");
    if (
      fs.existsSync(nestedNapkin) &&
      fs.statSync(nestedNapkin).isDirectory()
    ) {
      return resolveVaultLayout(nestedNapkin, dir);
    }

    const parent = path.dirname(dir);
    if (parent === dir || dir === root) {
      // No vault found — create a bare one at the starting directory
      return createBareVault(startingDir);
    }
    dir = parent;
  }
}

/**
 * Create a bare vault at the given directory.
 * Sibling layout: .napkin/ (config) + .obsidian/ + NAPKIN.md all in projectDir.
 */
function createBareVault(projectDir: string): VaultInfo {
  const napkinDir = path.join(projectDir, ".napkin");
  fs.mkdirSync(napkinDir, { recursive: true });

  const configFile = path.join(napkinDir, CONFIG_FILE);
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(
      configFile,
      JSON.stringify(
        { ...DEFAULT_CONFIG, vault: SIBLING_VAULT_LAYOUT },
        null,
        2,
      ),
    );
  }

  const napkinMd = path.join(projectDir, "NAPKIN.md");
  if (!fs.existsSync(napkinMd)) {
    fs.writeFileSync(napkinMd, "");
  }

  const obsidianDir = path.join(projectDir, ".obsidian");
  if (!fs.existsSync(obsidianDir)) {
    fs.mkdirSync(obsidianDir, { recursive: true });
  }

  return {
    name: path.basename(projectDir),
    contentPath: projectDir,
    configPath: napkinDir,
    obsidianPath: obsidianDir,
  };
}

/**
 * Resolve vault layout from .napkin/config.json vault paths.
 * If no vault config exists, defaults to sibling layout (content in project dir).
 */
function resolveVaultLayout(napkinDir: string, projectDir: string): VaultInfo {
  const configPath = path.join(napkinDir, CONFIG_FILE);
  let vaultConfig: { root?: string; obsidian?: string } | undefined;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    vaultConfig = raw.vault;
  } catch {
    // no config or invalid — use defaults
  }

  if (vaultConfig?.root) {
    const contentPath = path.resolve(napkinDir, vaultConfig.root);
    const obsidianPath = vaultConfig.obsidian
      ? path.resolve(napkinDir, vaultConfig.obsidian)
      : path.join(contentPath, ".obsidian");
    return {
      name: path.basename(contentPath),
      contentPath,
      configPath: napkinDir,
      obsidianPath,
    };
  }

  // Legacy: embedded layout — .napkin/ is the vault root (no vault.root in config)
  return {
    name: path.basename(projectDir),
    contentPath: napkinDir,
    configPath: napkinDir,
    obsidianPath: path.join(napkinDir, ".obsidian"),
  };
}
