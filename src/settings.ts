import * as vscode from 'vscode';
import { validateEnvName } from './common/validate.js';

export const SETTINGS_SECTION = 'wsl-remote';

/** Reads the `wsl-remote.extensionHostEnv` setting into a validated name/value map. */
export function sanitizeExtensionHostEnv(raw: unknown): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  if (!raw || typeof raw !== 'object') {
    return result;
  }
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    try {
      validateEnvName(name);
    } catch {
      continue;
    }
    if (value === null) {
      result[name] = null;
    } else if (typeof value === 'string') {
      result[name] = value;
    }
  }
  return result;
}

export interface Settings {
  readonly serverDownloadUrlTemplate: string | undefined;
  readonly connectHost: 'auto' | 'localhost' | 'distroIp';
  readonly serverEnvSetup: boolean;
  readonly extensionHostEnv: Record<string, string | null>;
  readonly defaultExtensions: string[];
  readonly serverStartTimeoutSeconds: number;
  readonly installLockTimeoutSeconds: number;
  readonly debug: boolean;
}

export function getSettings(): Settings {
  const config = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  const template = config.get<string>('serverDownloadUrlTemplate', '').trim();
  const host = config.get<string>('connectHost', 'auto');
  return {
    serverDownloadUrlTemplate: template.length > 0 ? template : undefined,
    connectHost: host === 'localhost' || host === 'distroIp' ? host : 'auto',
    serverEnvSetup: config.get<boolean>('serverEnvSetup', true),
    extensionHostEnv: sanitizeExtensionHostEnv(config.get<unknown>('extensionHostEnv')),
    defaultExtensions: config.get<string[]>('defaultExtensions', []).filter((id) => typeof id === 'string'),
    serverStartTimeoutSeconds: clamp(config.get<number>('serverStartTimeout', 180), 30, 3600),
    installLockTimeoutSeconds: clamp(config.get<number>('installLockTimeout', 300), 10, 3600),
    debug: config.get<boolean>('debug', false),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
