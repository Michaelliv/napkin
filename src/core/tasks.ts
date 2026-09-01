import * as fs from "node:fs";
import * as path from "node:path";
import { listFiles, resolveFile } from "../utils/files.js";
import { extractTasks, type Task } from "../utils/markdown.js";
import type { VaultInfo } from "../utils/vault.js";
import { getDailyPath } from "./daily.js";

export interface TaskWithFile extends Task {
  file: string;
}

export interface TaskShowResult {
  file: string;
  line: number;
  status: string;
  text: string;
  done?: boolean;
}

export function collectTasks(
  vault: VaultInfo,
  opts: { file?: string; daily?: boolean },
): TaskWithFile[] {
  let files: string[];

  if (opts.daily) {
    const dp = getDailyPath(vault);
    files = fs.existsSync(path.join(vault.contentPath, dp)) ? [dp] : [];
  } else if (opts.file) {
    const r = resolveFile(vault.contentPath, opts.file);
    files = r ? [r] : [];
  } else {
    files = listFiles(vault.contentPath, { ext: "md" });
  }

  const results: TaskWithFile[] = [];
  for (const file of files) {
    const content = fs.readFileSync(
      path.join(vault.contentPath, file),
      "utf-8",
    );
    const tasks = extractTasks(content);
    for (const t of tasks) {
      results.push({ ...t, file });
    }
  }
  return results;
}

export function filterTasks(
  tasks: TaskWithFile[],
  opts: { done?: boolean; todo?: boolean; status?: string },
): TaskWithFile[] {
  let result = tasks;
  if (opts.done) result = result.filter((t) => t.done);
  if (opts.todo) result = result.filter((t) => !t.done);
  if (opts.status) result = result.filter((t) => t.status === opts.status);
  return result;
}

export function resolveTaskLocation(
  vault: VaultInfo,
  opts: {
    file?: string;
    line?: string;
    ref?: string;
    daily?: boolean;
  },
): { filePath: string; lineNum: number } {
  if (opts.ref) {
    const parts = opts.ref.split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid ref format. Use --ref <path:line>");
    }
    const resolved = resolveFile(vault.contentPath, parts[0]);
    if (!resolved) {
      throw new Error(`File not found: ${parts[0]}`);
    }
    return { filePath: resolved, lineNum: Number.parseInt(parts[1], 10) };
  }

  if (opts.daily) {
    return {
      filePath: getDailyPath(vault),
      lineNum: Number.parseInt(opts.line || "0", 10),
    };
  }

  if (!opts.file || !opts.line) {
    throw new Error("Specify --file and --line, or --ref <path:line>");
  }

  const resolved = resolveFile(vault.contentPath, opts.file);
  if (!resolved) {
    throw new Error(`File not found: ${opts.file}`);
  }
  return { filePath: resolved, lineNum: Number.parseInt(opts.line, 10) };
}

function parseTask(
  vaultPath: string,
  filePath: string,
  lineNum: number,
): { lines: string[]; taskMatch: RegExpMatchArray; fullPath: string } {
  const fullPath = path.join(vaultPath, filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");
  const targetLine = lines[lineNum - 1];

  if (!targetLine) {
    throw new Error(`Line ${lineNum} not found in ${filePath}`);
  }

  const taskMatch = targetLine.match(/^([\s]*[-*]\s+\[)(.)(].*)$/);
  if (!taskMatch) {
    throw new Error(`Line ${lineNum} is not a task`);
  }

  return { lines, taskMatch, fullPath };
}

export function showTask(
  vaultPath: string,
  filePath: string,
  lineNum: number,
): { currentStatus: string; text: string } {
  const { taskMatch } = parseTask(vaultPath, filePath, lineNum);
  return { currentStatus: taskMatch[2], text: taskMatch[3].slice(2) };
}

export function updateTask(
  vaultPath: string,
  filePath: string,
  lineNum: number,
  newStatus: string,
): TaskShowResult {
  const { lines, taskMatch, fullPath } = parseTask(
    vaultPath,
    filePath,
    lineNum,
  );

  lines[lineNum - 1] = `${taskMatch[1]}${newStatus}${taskMatch[3]}`;
  fs.writeFileSync(fullPath, lines.join("\n"));

  return {
    file: filePath,
    line: lineNum,
    status: newStatus,
    text: taskMatch[3].slice(2),
  };
}
