import { spawn } from "node:child_process";
import { EXIT_ERROR } from "../utils/exit-codes.js";
import { error, info, type OutputOptions, success } from "../utils/output.js";

const target = "napkin-ai@latest";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmArgs = ["install", "-g", target];

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<number>;

export async function update(
  opts: OutputOptions,
  runner: CommandRunner = runCommand,
): Promise<void> {
  if (!opts.quiet)
    info(`Updating napkin with ${npmCommand} ${npmArgs.join(" ")}`);

  const status = await runner(npmCommand, npmArgs);
  if (status !== 0) {
    error(`Update failed: ${npmCommand} ${npmArgs.join(" ")}`);
    process.exit(EXIT_ERROR);
  }

  if (!opts.quiet) success(`Updated ${target}`);
}

function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (status) => resolve(status ?? 1));
  });
}
