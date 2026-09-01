import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_CONFIG,
  type NapkinConfig,
  SIBLING_VAULT_LAYOUT,
  type VaultLayout,
} from "./config.js";
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
  /**
   * Configuration supplied in code. When set it is the whole configuration:
   * every read goes through `effectiveConfig`, and config.json is never
   * consulted for this vault.
   */
  config?: NapkinConfig;
}

/**
 * Walk up from startDir looking for .napkin/ (or .obsidian/.napkin/ for nested layout).
 * Resolves the vault layout from config to determine content, config, and obsidian paths.
 *
 * Locating the .napkin/ directory is discovery, not configuration, so the
 * walk runs the same either way. `config` only decides what the layout and
 * every later setting are — when given, config.json is never read.
 */
export function findVault(startDir?: string, config?: NapkinConfig): VaultInfo {
  let dir = path.resolve(startDir || process.cwd());
  const root = path.parse(dir).root;

  const startingDir = dir;

  while (true) {
    const napkinDir = path.join(dir, ".napkin");

    if (fs.existsSync(napkinDir) && fs.statSync(napkinDir).isDirectory()) {
      return resolveVaultLayout(napkinDir, dir, config);
    }

    // Check for nested layout: .obsidian/.napkin/
    const nestedNapkin = path.join(dir, ".obsidian", ".napkin");
    if (
      fs.existsSync(nestedNapkin) &&
      fs.statSync(nestedNapkin).isDirectory()
    ) {
      return resolveVaultLayout(nestedNapkin, dir, config);
    }

    const parent = path.dirname(dir);
    if (parent === dir || dir === root) {
      // No vault found — create a bare one at the starting directory
      return createBareVault(startingDir, config);
    }
    dir = parent;
  }
}

/**
 * Create a bare vault at the given directory.
 * Sibling layout: .napkin/ (config) + .obsidian/ + NAPKIN.md all in projectDir.
 */
function createBareVault(projectDir: string, config?: NapkinConfig): VaultInfo {
  const napkinDir = path.join(projectDir, ".napkin");
  fs.mkdirSync(napkinDir, { recursive: true });

  // A config file is written only when the vault owns its settings. Under
  // injection the settings live in the caller's source, and a file written
  // here would be a point-in-time copy that this instance ignores and a
  // later one obeys.
  const configFile = path.join(napkinDir, CONFIG_FILE);
  if (!config && !fs.existsSync(configFile)) {
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
    ...(config ? { config } : {}),
  };
}

/**
 * Resolve vault layout from the vault's `vault` key — injected when the
 * caller supplied a config, read from .napkin/config.json otherwise.
 * An absent key means the embedded layout, identically either way.
 */
function resolveVaultLayout(
  napkinDir: string,
  projectDir: string,
  config?: NapkinConfig,
): VaultInfo {
  const vaultConfig: Partial<VaultLayout> | undefined = config
    ? config.vault
    : readVaultLayout(napkinDir);
  const injected = config ? { config } : {};

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
      ...injected,
    };
  }

  // Embedded layout — .napkin/ is the vault root.
  return {
    name: path.basename(projectDir),
    contentPath: napkinDir,
    configPath: napkinDir,
    obsidianPath: path.join(napkinDir, ".obsidian"),
    ...injected,
  };
}

/** The `vault` key as the file has it — either half may be missing. */
function readVaultLayout(napkinDir: string): Partial<VaultLayout> | undefined {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(napkinDir, CONFIG_FILE), "utf-8"),
    );
    return raw.vault;
  } catch {
    // no config or invalid — use defaults
    return undefined;
  }
}
