import { execFileSync } from 'node:child_process';

/** Run a command; returns stdout, or streams everything to the terminal with `inherit`. */
export function sh(cmd: string, args: string[], { cwd, inherit = false }: { cwd?: string; inherit?: boolean } = {}): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'] }) ?? '';
}

/** Poll `url` until it answers 2xx, or throw after `timeoutMs`. */
export async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000}s`);
}
