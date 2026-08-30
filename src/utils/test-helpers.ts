import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_CONFIG, saveConfig } from "./config.js";

/**
 * Create a temporary vault for testing.
 * .napkin/ is the vault root — all content lives inside it.
 * Returns:
 *   - projectPath: parent dir (pass to --vault for commands; findVault walks up from here)
 *   - contentPath: the vault content root (pass directly to utilities like listFiles),
 *     named after VaultInfo.contentPath
 *   - cleanup: removes everything
 */
export function createTempVault(files?: Record<string, string>): {
  projectPath: string;
  contentPath: string;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napkin-test-"));

  // .napkin/ IS the vault root
  const napkinDir = path.join(tmpDir, ".napkin");
  fs.mkdirSync(napkinDir, { recursive: true });

  // Write config.json which also syncs .obsidian/
  const testConfig = {
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
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}
