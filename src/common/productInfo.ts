import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { validateCommit, validateQuality, validateSimpleName, validateVersion } from './validate.js';

/** The fields of the running editor's product.json that decide which server to install. */
export interface ProductInfo {
  readonly nameShort: string;
  readonly applicationName: string;
  readonly dataFolderName: string;
  readonly serverApplicationName: string;
  readonly serverDataFolderName: string;
  readonly commit: string;
  readonly quality: string;
  readonly version: string;
  /** VSCodium-style release suffix; null when the version already carries it (1.135.06055). */
  readonly release: string | undefined;
  /** VSCodium ships its own template; VS Code builds leave it undefined. */
  readonly serverDownloadUrlTemplate: string | undefined;
}

interface RawProduct {
  nameShort?: unknown;
  applicationName?: unknown;
  dataFolderName?: unknown;
  serverApplicationName?: unknown;
  serverDataFolderName?: unknown;
  commit?: unknown;
  quality?: unknown;
  release?: unknown;
  serverDownloadUrlTemplate?: unknown;
}

let cached: ProductInfo | undefined;

export function productJsonPath(): string {
  return path.join(vscode.env.appRoot, 'product.json');
}

/** Reads product.json once. Throws when a field we depend on is missing or malformed. */
export async function getProductInfo(): Promise<ProductInfo> {
  if (cached) {
    return cached;
  }
  const raw = JSON.parse(await fs.promises.readFile(productJsonPath(), 'utf8')) as RawProduct;
  cached = parseProductInfo(raw, vscode.version);
  return cached;
}

export function parseProductInfo(raw: RawProduct, editorVersion: string): ProductInfo {
  const str = (value: unknown, name: string): string => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`product.json has no usable "${name}"`);
    }
    return value;
  };
  const optional = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

  const applicationName = validateSimpleName(str(raw.applicationName, 'applicationName'), 'applicationName');
  return {
    nameShort: typeof raw.nameShort === 'string' ? raw.nameShort : applicationName,
    applicationName,
    dataFolderName: validateSimpleName(str(raw.dataFolderName, 'dataFolderName'), 'dataFolderName'),
    serverApplicationName: validateSimpleName(str(raw.serverApplicationName, 'serverApplicationName'), 'serverApplicationName'),
    serverDataFolderName: validateSimpleName(str(raw.serverDataFolderName, 'serverDataFolderName'), 'serverDataFolderName'),
    commit: validateCommit(str(raw.commit, 'commit')),
    quality: validateQuality(str(raw.quality, 'quality')),
    version: validateVersion(editorVersion.replace(/-insider$/, '')),
    release: optional(raw.release),
    serverDownloadUrlTemplate: optional(raw.serverDownloadUrlTemplate),
  };
}
