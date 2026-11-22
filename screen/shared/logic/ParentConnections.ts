// CONFIG AND CONTRACT — reusable parent-owned ports, never a singleton bus.
export interface ValueContract<T> {
  id: string;
  accept(value: unknown): value is T;
}
export const contract = <T>(
  id: string,
  accept: (value: unknown) => value is T,
): ValueContract<T> => ({ id, accept });
export type Cleanup = () => void;
export interface RequestEndpoint {
  kind: 'request';
  input: string;
  output: string;
  invoke(value: unknown): Promise<unknown>;
  connectTo(target: RequestEndpoint): Cleanup;
}
export interface StateEndpoint {
  kind: 'state';
  value: string;
  receive(value: unknown): void;
  connectTo(target: StateEndpoint): Cleanup;
}
export type Endpoint = RequestEndpoint | StateEndpoint;
export interface ParentPort {
  endpoint: Endpoint;
  settle(): Promise<void>;
  dispose(): void;
}
export interface RequestPort<A, R> extends ParentPort {
  endpoint: RequestEndpoint;
  request(value: A): Promise<R>;
  register(handler: (value: A) => R | Promise<R>): Cleanup;
}
export interface StatePort<T> extends ParentPort {
  endpoint: StateEndpoint;
  publish(value: T): void;
  getSnapshot(): T;
  subscribe(listener: () => void): Cleanup;
}
export interface Connection {
  from: { area: string; port: string };
  to: { area: string; port: string };
}
export interface ParentBinding {
  endpoints: Readonly<Record<string, Endpoint>>;
  settle(): Promise<void>;
  dispose(): void;
}

// LOGIC — closures belong to one parent instance; typed handlers keep their contracts.
export function createRequest<A, R>(
  input: ValueContract<A>,
  output: ValueContract<R>,
  unavailable: NoInfer<R>,
): RequestPort<A, R> {
  let handler: ((value: A) => R | Promise<R>) | null = null,
    disposed = false;
  const pending = new Set<Promise<R>>();
  const register = (next: (value: A) => R | Promise<R>): Cleanup => {
    if (disposed) throw new Error('Parent port is disposed');
    handler = next;
    return () => {
      if (handler === next) handler = null;
    };
  };
  const request = (value: A): Promise<R> => {
    const run = async (): Promise<R> => {
      if (!input.accept(value)) throw new TypeError(`Invalid parent input: ${input.id}`);
      const result = disposed || !handler ? unavailable : await handler(value);
      if (!output.accept(result)) throw new TypeError(`Invalid parent result: ${output.id}`);
      return result;
    };
    const task = run();
    pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => {});
    return task;
  };
  const endpoint: RequestEndpoint = {
    kind: 'request',
    input: input.id,
    output: output.id,
    invoke(value) {
      if (!input.accept(value))
        return Promise.reject(new TypeError(`Invalid parent input: ${input.id}`));
      return request(value);
    },
    connectTo(target) {
      if (target.input !== input.id || target.output !== output.id)
        throw new TypeError('Incompatible parent request contracts');
      return register(async (value) => {
        const result = await target.invoke(value);
        if (!output.accept(result)) throw new TypeError(`Invalid forwarded result: ${output.id}`);
        return result;
      });
    },
  };
  return {
    endpoint,
    request,
    register,
    async settle() {
      do {
        await Promise.allSettled([...pending]);
        await Promise.resolve();
      } while (pending.size);
    },
    dispose() {
      disposed = true;
      handler = null;
    },
  };
}
export function createState<T>(valueContract: ValueContract<T>, initial: NoInfer<T>): StatePort<T> {
  if (!valueContract.accept(initial))
    throw new TypeError(`Invalid initial parent state: ${valueContract.id}`);
  let snapshot = initial,
    disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: T) => {
    if (disposed) return;
    if (!valueContract.accept(next))
      throw new TypeError(`Invalid parent state: ${valueContract.id}`);
    if (Object.is(next, snapshot)) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener: () => void): Cleanup => {
    if (!disposed) listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const endpoint: StateEndpoint = {
    kind: 'state',
    value: valueContract.id,
    receive(value) {
      if (!valueContract.accept(value))
        throw new TypeError(`Invalid forwarded state: ${valueContract.id}`);
      publish(value);
    },
    connectTo(target) {
      if (target.value !== valueContract.id)
        throw new TypeError('Incompatible parent state contracts');
      target.receive(snapshot);
      return subscribe(() => target.receive(snapshot));
    },
  };
  return {
    endpoint,
    publish,
    subscribe,
    getSnapshot: () => snapshot,
    settle: async () => {},
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
export function parentBinding<P extends Record<string, ParentPort>>(ports: P): ParentBinding {
  const endpoints: Record<string, Endpoint> = {};
  for (const [name, port] of Object.entries(ports)) endpoints[name] = port.endpoint;
  return {
    endpoints,
    async settle() {
      await Promise.allSettled(Object.values(ports).map((port) => port.settle()));
    },
    dispose() {
      Object.values(ports).forEach((port) => port.dispose());
    },
  };
}
export function compatible(from: Endpoint, to: Endpoint): boolean {
  return from.kind === 'request' && to.kind === 'request'
    ? from.input === to.input && from.output === to.output
    : from.kind === 'state' && to.kind === 'state' && from.value === to.value;
}
// Ambiguous providers and circular forwarding are rejected before subscribing.
export function connectionProblems(
  connections: Connection[],
  parents: ReadonlyMap<string, ParentBinding>,
): Map<number, string> {
  const problems = new Map<number, string>(),
    providers = new Map<string, number[]>();
  const key = (endpoint: { area: string; port: string }) => `${endpoint.area}/${endpoint.port}`;
  for (const [index, connection] of connections.entries()) {
    const source = parents.get(connection.from.area)?.endpoints[connection.from.port];
    const id = source?.kind === 'request' ? key(connection.from) : key(connection.to);
    providers.set(id, [...(providers.get(id) ?? []), index]);
  }
  for (const indices of providers.values())
    if (indices.length > 1)
      for (const index of indices) problems.set(index, 'DUPLICATE_CONNECTION');
  const graph = new Map<string, { index: number; target: string }[]>();
  for (const [index, connection] of connections.entries())
    if (!problems.has(index)) {
      const from = key(connection.from);
      graph.set(from, [...(graph.get(from) ?? []), { index, target: key(connection.to) }]);
    }
  const visit = (node: string, nodes: string[], edges: number[]) => {
    const cycle = nodes.indexOf(node);
    if (cycle >= 0) {
      for (const index of edges.slice(cycle)) problems.set(index, 'CONNECTION_CYCLE');
      return;
    }
    for (const edge of graph.get(node) ?? [])
      visit(edge.target, [...nodes, node], [...edges, edge.index]);
  };
  for (const node of graph.keys()) visit(node, [], []);
  return problems;
}
export function connectParents(
  connections: Connection[],
  parents: ReadonlyMap<string, ParentBinding>,
): Cleanup {
  if (connectionProblems(connections, parents).size)
    throw new TypeError('Ambiguous or cyclic parent connections');
  const cleanups: Cleanup[] = [];
  try {
    for (const connection of connections) {
      const from = parents.get(connection.from.area)?.endpoints[connection.from.port];
      const to = parents.get(connection.to.area)?.endpoints[connection.to.port];
      if (!from || !to || !compatible(from, to))
        throw new TypeError('Missing or incompatible parent connection');
      if (from.kind === 'request' && to.kind === 'request') cleanups.push(from.connectTo(to));
      else if (from.kind === 'state' && to.kind === 'state') cleanups.push(from.connectTo(to));
    }
  } catch (error) {
    cleanups.reverse().forEach((cleanup) => cleanup());
    throw error;
  }
  return () => {
    cleanups.reverse().forEach((cleanup) => cleanup());
  };
}
// Drain in-flight requests before detaching native cleanup paths of retiring children.
export async function retireParents(parents: ParentBinding[], disconnect: Cleanup): Promise<void> {
  await Promise.resolve();
  await Promise.allSettled(parents.map((parent) => parent.settle()));
  await Promise.resolve();
  disconnect();
  parents.forEach((parent) => parent.dispose());
}
