import type { DiagnosticRecord, Result, ShellHost } from '../../../ShellHost.js';
import { errorText } from './VisualConfig.ts';
export interface DiagnosticIssue {
  code: string;
  componentId?: unknown;
  instanceId?: unknown;
  parentId?: unknown;
  filePath?: unknown;
  configPath?: unknown;
  expected?: unknown;
  actual?: unknown;
}
export type ActionSource = Omit<DiagnosticIssue, 'code'>;
export type Diagnostics = ReturnType<typeof createDiagnostics>;
const printable = (value: unknown) =>
  typeof value === 'string' ? value.slice(0, 4000) : (JSON.stringify(value) ?? '').slice(0, 4000);

// LOGIC — deduplicate issues and send readable structured records to one local sink.
export function createDiagnostics(transport: ShellHost['diagnostics']) {
  const records = new Map<string, DiagnosticRecord>(),
    dirty = new Map<string, DiagnosticRecord>(),
    listeners = new Set<() => void>();
  let snapshot: DiagnosticRecord[] = [],
    scheduled = false,
    queue: Promise<Result> = Promise.resolve({ ok: true });
  const flush = () => {
    queue = queue.then(async (): Promise<Result> => {
      const batch = [...dirty.values()];
      dirty.clear();
      if (!batch.length) return { ok: true };
      try {
        for (let index = 0; index < batch.length; index += 100) {
          const result = await transport(batch.slice(index, index + 100));
          if (!result?.ok) throw new Error(result?.error ?? 'Diagnostic transport failed');
        }
        return { ok: true };
      } catch (error) {
        console.error(`Diagnostics could not be saved: ${errorText(error)}`);
        for (const record of batch) if (!dirty.has(record.key)) dirty.set(record.key, record);
        return { ok: false, error: errorText(error) };
      }
    });
    return queue;
  };
  return {
    report(issue: DiagnosticIssue) {
      const data = {
        code: printable(issue.code),
        componentId: printable(issue.componentId),
        instanceId: printable(issue.instanceId),
        parentId: printable(issue.parentId),
        filePath: printable(issue.filePath),
        configPath: printable(issue.configPath),
        expected: printable(issue.expected),
        actual: printable(issue.actual),
      };
      const key = JSON.stringify(data);
      const prior = records.get(key),
        timestamp = new Date().toISOString();
      const record = Object.freeze({
        ...data,
        key,
        count: (prior?.count ?? 0) + 1,
        firstTimestamp: prior?.firstTimestamp ?? timestamp,
        lastTimestamp: timestamp,
        action: 'skip invalid item; keep valid items running',
        message: `${data.instanceId || data.componentId || data.configPath || data.filePath}: ${data.code}. Expected ${data.expected}; got ${data.actual}.`,
      });
      records.set(key, record);
      dirty.set(key, record);
      snapshot = [...records.values()];
      listeners.forEach((listener) => listener());
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          void flush();
        });
      }
      return record;
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flush,
  };
}
