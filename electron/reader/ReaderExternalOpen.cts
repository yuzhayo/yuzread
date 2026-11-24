import fs from 'node:fs';
import path from 'node:path';

// CONFIG AND CONTRACT — OS command lines are untrusted; only real absolute CBZ files enter.
export function externalCbzArguments(args: readonly string[]): string[] {
  const accepted: string[] = [];
  for (const value of args) {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 4096 ||
      value.includes('\0') ||
      !path.isAbsolute(value) ||
      path.extname(value).toLowerCase() !== '.cbz'
    )
      continue;
    try {
      const canonical = fs.realpathSync.native(value);
      if (fs.statSync(canonical).isFile() && !accepted.includes(canonical))
        accepted.push(canonical);
    } catch {
      /* Missing/inaccessible command-line files are not launch requests. */
    }
  }
  return accepted;
}

// STATE AND COORDINATION — bounded FIFO; paths never cross into the renderer.
export function createReaderExternalOpenQueue(initialArguments: readonly string[] = []) {
  const pending: string[] = [];
  let revision = 0;
  const enqueue = (args: readonly string[]) => {
    for (const file of externalCbzArguments(args)) {
      if (pending.includes(file)) continue;
      if (pending.length === 8) break;
      pending.push(file);
      revision += 1;
    }
    return revision;
  };
  enqueue(initialArguments);
  return {
    enqueue,
    take: () => pending.shift(),
    revision: () => revision,
    size: () => pending.length,
  };
}
