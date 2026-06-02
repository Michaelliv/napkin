import { afterEach, describe, expect, test } from "bun:test";
import { update } from "./update.js";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const originalLog = console.log;
const originalError = console.error;

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

describe("update command", () => {
  test("runs npm install globally for the latest napkin package", async () => {
    // Arrange
    const calls: Array<{ command: string; args: string[] }> = [];
    console.log = () => {};

    // Act
    await update({}, async (command, args) => {
      calls.push({ command, args });
      return 0;
    });

    // Assert
    expect(calls).toEqual([
      { command: npmCommand, args: ["install", "-g", "napkin-ai@latest"] },
    ]);
  });
});
