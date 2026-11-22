import fs from 'node:fs/promises';
import path from 'node:path';
import type { DiagnosticRecord, Result } from '../ShellHost.js';
import { errorText } from './WindowConfig.cjs';

// LOGIC — one serialized diagnostic sink. Disk failure must not crash the shell.
export function createDiagnosticLog(directory: string) {
  const filePath = path.join(directory, 'logs', 'shell.ndjson');
  let queue: Promise<Result> = Promise.resolve({ ok: true });
  return {
    filePath,
    write(records: DiagnosticRecord[]) {
      queue = queue
        .then(async (): Promise<Result> => {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.appendFile(
            filePath,
            records.map((record) => JSON.stringify(record)).join('\n') + '\n',
            'utf8',
          );
          return { ok: true };
        })
        .catch((error) => {
          console.error(`Diagnostic log unavailable: ${errorText(error)}`);
          return { ok: false, error: errorText(error) };
        });
      return queue;
    },
    flush: () => queue,
  };
}
