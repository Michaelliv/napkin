import { spawn } from "node:child_process";
import { EXIT_ERROR } from "../utils/exit-codes.js";
import {
  error,
  info,
  type OutputOptions,
  output,
  success,
} from "../utils/output.js";

const target = "@shiftlabs/napkin@latest";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgs = ["install", "-g", target];

interface RunOptions {
  silent: boolean;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: RunOptions,
) => Promise<number>;

export async function update(
  opts: OutputOptions,
  runner: CommandRunner = runCommand,
): Promise<void> {
  const command = `${npmCommand} ${npmArgs.join(" ")}`;

  if (!opts.quiet && !opts.json) info(`Updating napkin with ${command}`);

  let status: number;
  try {
    status = await runner(npmCommand, npmArgs, {
      silent: Boolean(opts.quiet || opts.json),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    fail(opts, `Could not run ${npmCommand}: ${message}`);
  }

  if (status !== 0) fail(opts, `${command} exited with status ${status}`);

  output(opts, {
    json: () => ({ updated: true, target }),
    quiet: () => {},
    human: () => success(`Updated ${target}`),
  });
}

function fail(opts: OutputOptions, message: string): never {
  if (opts.json) {
    output(opts, {
      json: () => ({ updated: false, target, error: message }),
      human: () => {},
    });
  } else {
    error(`Update failed: ${message}`);
  }
  process.exit(EXIT_ERROR);
}

function runCommand(
  command: string,
  args: string[],
  options: RunOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.silent ? "ignore" : "inherit",
    });
    child.once("error", reject);
    child.once("close", (status) => resolve(status ?? 1));
  });
}
