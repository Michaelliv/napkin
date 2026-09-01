import {
  effectiveConfig,
  type NapkinConfig,
  updateConfig,
} from "../utils/config.js";
import type { VaultInfo } from "../utils/vault.js";

export function getConfigValue(vault: VaultInfo, key: string): unknown {
  const config = effectiveConfig(vault);
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

/**
 * Write one dotted key into the vault's config.json.
 *
 * Refused when the configuration is injected: the instance reads its
 * settings from code, so a write here would change a file it never
 * consults — a caller would be told the setting took effect when it did
 * not.
 */
export function setConfigValue(
  vault: VaultInfo,
  key: string,
  rawValue: string,
): { config: NapkinConfig; parsed: unknown } {
  if (vault.config) {
    throw new Error(
      "config is injected in code; edit the source, not the vault",
    );
  }

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

  return { config: updateConfig(vault.configPath, obj), parsed };
}
