import {
  loadConfig,
  type NapkinConfig,
  updateConfig,
} from "../utils/config.js";

export { loadConfig };

export function getConfigValue(configPath: string, key: string): unknown {
  const config = loadConfig(configPath);
  const parts = key.split(".");
  let value: unknown = config;
  for (const part of parts) {
    if (value && typeof value === "object" && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return value;
}

export function setConfigValue(
  configPath: string,
  key: string,
  rawValue: string,
): { config: NapkinConfig; parsed: unknown } {
  const parts = key.split(".");
  const obj: Record<string, unknown> = {};
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    parsed = rawValue;
  }
  current[parts[parts.length - 1]] = parsed;

  return { config: updateConfig(configPath, obj), parsed };
}
