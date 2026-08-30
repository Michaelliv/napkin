import * as fs from "node:fs";
import * as path from "node:path";
import { TEMPLATES, type VaultTemplate } from "../templates/index.js";
import {
  DEFAULT_CONFIG,
  type NapkinConfig,
  SIBLING_VAULT_LAYOUT,
  saveConfig,
} from "../utils/config.js";
import { CONFIG_FILE } from "../utils/vault-internals.js";

export interface InitResult {
  status: string;
  path: string;
  napkin?: boolean;
  configCreated?: boolean;
  siblingLayout?: boolean;
  template?: string | null;
  files?: string[];
}

export interface TemplateInfo {
  name: string;
  description: string;
  dirs: string[];
}

function scaffoldTemplate(
  targetDir: string,
  template: VaultTemplate,
): string[] {
  const created: string[] = [];

  for (const dir of template.dirs) {
    const dirPath = path.join(targetDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      created.push(`${dir}/`);
    }
  }

  for (const [filePath, content] of Object.entries(template.files)) {
    const fullPath = path.join(targetDir, filePath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
      created.push(filePath);
    }
  }

  const napkinPath = path.join(targetDir, "NAPKIN.md");
  if (!fs.existsSync(napkinPath)) {
    fs.writeFileSync(napkinPath, template.napkinMd);
    created.push("NAPKIN.md");
  }

  return created;
}

export function initVault(opts: {
  path?: string;
  template?: string;
}): InitResult {
  if (!opts.path) {
    throw new Error("No path specified for vault initialization");
  }
  const targetDir = path.resolve(opts.path);
  const napkinDir = path.join(targetDir, ".napkin");
  const obsidianDir = path.join(targetDir, ".obsidian");
  const hasExistingObsidian =
    fs.existsSync(obsidianDir) && fs.statSync(obsidianDir).isDirectory();

  const napkinExists = fs.existsSync(napkinDir);
  const configExists = fs.existsSync(path.join(napkinDir, CONFIG_FILE));

  if (napkinExists && configExists && !opts.template) {
    return { status: "exists", path: napkinDir };
  }

  if (opts.template && !TEMPLATES[opts.template]) {
    throw new Error(
      `Unknown template: ${opts.template}. Available: ${Object.keys(TEMPLATES).join(", ")}`,
    );
  }

  if (!napkinExists) {
    fs.mkdirSync(napkinDir, { recursive: true });
  }

  if (!fs.existsSync(path.join(napkinDir, CONFIG_FILE))) {
    const config: NapkinConfig = {
      ...DEFAULT_CONFIG,
      vault: SIBLING_VAULT_LAYOUT,
    };
    saveConfig(
      napkinDir,
      config,
      hasExistingObsidian ? obsidianDir : undefined,
    );
  }

  const contentRoot = targetDir;

  let templateFiles: string[] = [];
  if (opts.template) {
    templateFiles = scaffoldTemplate(contentRoot, TEMPLATES[opts.template]);
  }

  return {
    status: "created",
    path: napkinDir,
    napkin: !napkinExists,
    configCreated: !configExists,
    siblingLayout: hasExistingObsidian,
    template: opts.template || null,
    files: templateFiles,
  };
}

export interface ScaffoldResult {
  path: string;
  created: boolean;
  template: string;
  files: string[];
}

export function scaffoldVault(
  targetPath: string,
  template?: string,
): ScaffoldResult {
  const resolved = path.resolve(targetPath);
  const napkinDir = path.join(resolved, ".napkin");
  const obsidianDir = path.join(resolved, ".obsidian");
  const hasExistingObsidian =
    fs.existsSync(obsidianDir) && fs.statSync(obsidianDir).isDirectory();

  const napkinExisted = fs.existsSync(napkinDir);

  if (!napkinExisted) {
    fs.mkdirSync(napkinDir, { recursive: true });
  }

  if (!fs.existsSync(path.join(napkinDir, CONFIG_FILE))) {
    const config: NapkinConfig = {
      ...DEFAULT_CONFIG,
      vault: SIBLING_VAULT_LAYOUT,
    };
    saveConfig(
      napkinDir,
      config,
      hasExistingObsidian ? obsidianDir : undefined,
    );
  }

  const contentRoot = resolved;
  let files: string[] = [];

  if (template) {
    if (!TEMPLATES[template]) {
      throw new Error(
        `Unknown template: ${template}. Available: ${Object.keys(TEMPLATES).join(", ")}`,
      );
    }
    files = scaffoldTemplate(contentRoot, TEMPLATES[template]);
  }

  return {
    path: napkinDir,
    created: !napkinExisted,
    template: template || "",
    files,
  };
}

export interface AddTemplateResult {
  template: string;
  files: string[];
}

export function addTemplate(
  targetPath: string,
  template: string,
): AddTemplateResult {
  const resolved = path.resolve(targetPath);
  const napkinDir = path.join(resolved, ".napkin");

  if (!fs.existsSync(path.join(napkinDir, CONFIG_FILE))) {
    throw new Error("Vault not initialized. Run scaffold first.");
  }

  if (!TEMPLATES[template]) {
    throw new Error(
      `Unknown template: ${template}. Available: ${Object.keys(TEMPLATES).join(", ")}`,
    );
  }

  const files = scaffoldTemplate(resolved, TEMPLATES[template]);
  return { template, files };
}

export function getInitTemplates(): TemplateInfo[] {
  return Object.values(TEMPLATES).map((t) => ({
    name: t.name,
    description: t.description,
    dirs: t.dirs,
  }));
}
