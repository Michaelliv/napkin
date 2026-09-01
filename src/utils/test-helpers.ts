import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_CONFIG, type NapkinConfig, saveConfig } from "./config.js";
import { findVault, type VaultInfo } from "./vault.js";

/**
 * Create a temporary vault for testing.
 * .napkin/ is the vault root — all content lives inside it.
 * Returns:
 *   - projectPath: parent dir (pass to --vault for commands; findVault walks up from here)
 *   - contentPath: the vault content root (pass directly to utilities like listFiles),
 *     named after VaultInfo.contentPath
 *   - vault: the resolved VaultInfo, for core functions that take one
 *   - cleanup: removes everything
 *
 * `config` overrides what lands in config.json — pass a contradicting one to
 * prove an injected instance never reads the file.
 */
export function createTempVault(
  files?: Record<string, string>,
  config?: NapkinConfig,
): {
  projectPath: string;
  contentPath: string;
  vault: VaultInfo;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-test-"));

  // .napkin/ IS the vault root
  const napkinDir = path.join(tmpDir, ".napkin");
  fs.mkdirSync(napkinDir, { recursive: true });

  // Write config.json which also syncs .obsidian/
  const testConfig = config ?? {
    ...DEFAULT_CONFIG,
    daily: {
      ...DEFAULT_CONFIG.daily,
      folder: "Inbox/Daily",
    },
  };
  saveConfig(napkinDir, testConfig);

  // Write files inside .napkin/ (the vault root)
  if (files) {
    for (const [filePath, content] of Object.entries(files)) {
      const full = path.join(napkinDir, filePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  return {
    projectPath: tmpDir,
    contentPath: napkinDir,
    vault: findVault(tmpDir),
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}
