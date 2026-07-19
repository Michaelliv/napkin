import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EXIT_ERROR } from "../utils/exit-codes.js";
import { type CommandRunner, update } from "./update.js";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const originalLog = console.log;
const originalError = console.error;
let logs: string[];
let errors: string[];

beforeEach(() => {
  logs = [];
  errors = [];
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

async function captureExit(fn: () => Promise<void>): Promise<number> {
  const originalExit = process.exit;
  let exitCode = -1;
  (process as unknown as Record<string, unknown>).exit = (code: number) => {
    exitCode = code;
    throw new Error("exit");
  };

  try {
    await fn();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "exit") throw error;
  } finally {
    (process as unknown as Record<string, unknown>).exit = originalExit;
  }

  return exitCode;
}

describe("update command", () => {
  test("runs npm install globally for the latest napkin package", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: { silent: boolean };
    }> = [];

    await update({}, async (command, args, options) => {
      calls.push({ command, args, options });
      return 0;
    });

    expect(calls).toEqual([
      {
        command: npmCommand,
        args: ["install", "-g", "napkin-ai@latest"],
        options: { silent: false },
      },
    ]);
    expect(logs.join("\n")).toContain("Updated napkin-ai@latest");
  });

  test("returns structured JSON and silences npm output", async () => {
    let silent = false;

    await update({ json: true }, async (_command, _args, options) => {
      silent = options.silent;
      return 0;
    });

    expect(silent).toBe(true);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] ?? "")).toEqual({
      updated: true,
      target: "napkin-ai@latest",
    });
    expect(errors).toEqual([]);
  });

  test("suppresses command and npm output in quiet mode", async () => {
    let silent = false;

    await update({ quiet: true }, async (_command, _args, options) => {
      silent = options.silent;
      return 0;
    });

    expect(silent).toBe(true);
    expect(logs).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("reports a non-zero npm exit status", async () => {
    const exitCode = await captureExit(() => update({}, async () => 7));

    expect(exitCode).toBe(EXIT_ERROR);
    expect(errors.join("\n")).toContain("exited with status 7");
  });

  test("returns structured JSON for a failed update", async () => {
    const exitCode = await captureExit(() =>
      update({ json: true }, async () => 2),
    );

    expect(exitCode).toBe(EXIT_ERROR);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] ?? "")).toEqual({
      updated: false,
      target: "napkin-ai@latest",
      error: `${npmCommand} install -g napkin-ai@latest exited with status 2`,
    });
    expect(errors).toEqual([]);
  });

  test("adds context when npm cannot be started", async () => {
    const runner: CommandRunner = async () => {
      throw new Error("not found");
    };
    const exitCode = await captureExit(() => update({}, runner));

    expect(exitCode).toBe(EXIT_ERROR);
    expect(errors.join("\n")).toContain(
      `Update failed: Could not run ${npmCommand}: not found`,
    );
  });
});
