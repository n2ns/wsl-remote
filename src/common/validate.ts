/**
 * Validation of every value that ends up in a command line, a file name or a URL.
 * Each function returns the value when it is acceptable and throws otherwise, so call sites
 * cannot forget to check the result. None of these values is ever interpolated into a shell
 * command line: the server setup script receives them through environment variables.
 */

/** WSL distribution names: letters, digits, dot, dash and underscore (the set wsl.exe --import accepts). */
const DISTRO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Full SHA-1 commit hash as found in product.json. */
const COMMIT_HASH = /^[0-9a-f]{40}$/;
/** Names such as `codium-server` or `.vscodium-server`. */
const SIMPLE_NAME = /^\.?[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** VS Code extension identifiers: publisher.name. */
const EXTENSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** POSIX environment variable names. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateDistroName(value: string): string {
  if (!DISTRO_NAME.test(value)) {
    throw new ValidationError(`Invalid WSL distribution name: ${JSON.stringify(value)}`);
  }
  return value;
}

export function isValidDistroName(value: string): boolean {
  return DISTRO_NAME.test(value);
}

export function validateCommit(value: string): string {
  if (!COMMIT_HASH.test(value)) {
    throw new ValidationError(`Invalid commit hash in product.json: ${JSON.stringify(value)}`);
  }
  return value;
}

export function validateSimpleName(value: string, what: string): string {
  if (!SIMPLE_NAME.test(value)) {
    throw new ValidationError(`Invalid ${what}: ${JSON.stringify(value)}`);
  }
  return value;
}

export function validateQuality(value: string): string {
  if (!/^[a-z]+$/.test(value)) {
    throw new ValidationError(`Invalid quality in product.json: ${JSON.stringify(value)}`);
  }
  return value;
}

export function validateVersion(value: string): string {
  if (!/^[0-9][0-9A-Za-z.+-]*$/.test(value)) {
    throw new ValidationError(`Invalid version: ${JSON.stringify(value)}`);
  }
  return value;
}

export function validateExtensionId(value: string): string {
  if (!EXTENSION_ID.test(value)) {
    throw new ValidationError(`Invalid extension identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

export function validateEnvName(value: string): string {
  if (!ENV_NAME.test(value)) {
    throw new ValidationError(`Invalid environment variable name: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * The server download URL must be https and may only contain the placeholders the setup script
 * substitutes. Everything else is passed to the downloader verbatim, so no shell metacharacters.
 */
export function validateDownloadUrlTemplate(value: string): string {
  for (const match of value.matchAll(/\$\{([^}]*)\}/g)) {
    const name = match[1];
    if (name !== 'quality' && name !== 'version' && name !== 'commit' && name !== 'os' && name !== 'arch' && name !== 'release') {
      throw new ValidationError(`Unknown placeholder \${${name ?? ''}} in the server download URL template`);
    }
  }
  // With the known placeholders removed, only plain URL characters may remain: no `$`, quotes,
  // backslashes, spaces or braces, so the value is safe inside the setup script's sed expression.
  const rest = value.replace(/\$\{(quality|version|commit|os|arch|release)\}/g, 'x');
  if (!/^https:\/\/[A-Za-z0-9._~:/?#[\]@!&()*+,;=%-]+$/.test(rest)) {
    throw new ValidationError(`The server download URL template must be an https URL without spaces, quotes or shell characters: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Parses `wsl+<distro>` and returns the validated distribution name. */
export function distroFromAuthority(authority: string): string {
  const separator = authority.indexOf('+');
  if (separator < 0 || authority.slice(0, separator) !== 'wsl') {
    throw new ValidationError(`Not a WSL remote authority: ${JSON.stringify(authority)}`);
  }
  return validateDistroName(authority.slice(separator + 1));
}
