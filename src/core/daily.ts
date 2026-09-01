import * as fs from "node:fs";
import * as path from "node:path";
import { effectiveConfig } from "../utils/config.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { VaultInfo } from "../utils/vault.js";

interface DailyConfig {
  folder: string;
  format: string;
  template: string;
}

function getDailyConfig(vault: VaultInfo): DailyConfig {
  const config = effectiveConfig(vault);
  return {
    folder: config.daily.folder,
    format: config.daily.format,
    template: `${config.templates.folder}/Daily Note`,
  };
}

function formatDate(date: Date, format: string): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/YY/g, String(date.getFullYear()).slice(-2))
    .replace(/MM/g, String(date.getMonth() + 1).padStart(2, "0"))
    .replace(/M/g, String(date.getMonth() + 1))
    .replace(/DD/g, String(date.getDate()).padStart(2, "0"))
    .replace(/D/g, String(date.getDate()))
    .replace(/dddd/g, days[date.getDay()])
    .replace(/ddd/g, shortDays[date.getDay()])
    .replace(/HH/g, String(date.getHours()).padStart(2, "0"))
    .replace(/H/g, String(date.getHours()))
    .replace(/mm/g, String(date.getMinutes()).padStart(2, "0"))
    .replace(/ss/g, String(date.getSeconds()).padStart(2, "0"));
}

export function getDailyPath(vault: VaultInfo, date?: Date): string {
  const config = getDailyConfig(vault);
  const d = date || new Date();
  const filename = formatDate(d, config.format);
  const folder = config.folder || "";
  return folder ? `${folder}/${filename}.md` : `${filename}.md`;
}

export function ensureDaily(v: VaultInfo): { path: string; created: boolean } {
  const dp = getDailyPath(v);
  const fullPath = path.join(v.contentPath, dp);

  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const config = getDailyConfig(v);
    let content = "";
    if (config.template) {
      const templatePath = path.join(v.contentPath, `${config.template}.md`);
      if (fs.existsSync(templatePath)) {
        content = fs.readFileSync(templatePath, "utf-8");
      }
    }
    fs.writeFileSync(fullPath, content);
    return { path: dp, created: true };
  }

  return { path: dp, created: false };
}

export function readDaily(v: VaultInfo): { path: string; content: string } {
  const dp = getDailyPath(v);
  const fullPath = path.join(v.contentPath, dp);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Daily note not found: ${dp}`);
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  return { path: dp, content };
}

export function appendDaily(
  v: VaultInfo,
  content: string,
  inline?: boolean,
): string {
  const dp = getDailyPath(v);
  const fullPath = path.join(v.contentPath, dp);

  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "");
  }

  const existing = fs.readFileSync(fullPath, "utf-8");
  const separator = inline ? "" : "\n";
  fs.writeFileSync(fullPath, existing + separator + content);

  return dp;
}

export function prependDaily(
  v: VaultInfo,
  content: string,
  inline?: boolean,
): string {
  const dp = getDailyPath(v);
  const fullPath = path.join(v.contentPath, dp);

  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "");
  }

  const existing = fs.readFileSync(fullPath, "utf-8");
  const separator = inline ? "" : "\n";
  const { properties, body, raw } = parseFrontmatter(existing);

  if (Object.keys(properties).length > 0) {
    const frontmatter = `---\n${raw}\n---\n`;
    fs.writeFileSync(fullPath, frontmatter + content + separator + body);
  } else {
    fs.writeFileSync(fullPath, content + separator + existing);
  }

  return dp;
}
