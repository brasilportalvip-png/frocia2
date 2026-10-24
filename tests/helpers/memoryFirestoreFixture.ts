/** Firestore contract fixture: ordered cursors and atomic commits, no network. */
export function createMemoryFirestoreFixture() {
  const documents = new Map<string, Record<string, any>>();
  const writes: Array<{ key: string; data: any }> = [];
  const queries: Array<{ collection: string; filters: any[] }> = [];
  let transactionCount = 0;
  let failTransactionAt: number | null = null;
  let failRecentQuery = false;
  let failIndexedQuery = false;
  const snapshot = (key: string, value = documents.get(key)): any => ({
    id: key.split('/')[1], exists: value !== undefined, data: () => value, ref: ref(key),
  });
  const write = (key: string, data: any, merge = false) => {
    const value = merge ? { ...documents.get(key) } : {};
    for (const [field, next] of Object.entries(data) as Array<[string, any]>) {
      const transform = next?.constructor?.name;
      if (transform === 'NumericIncrementTransform') value[field] = (value[field] || 0) + next.operand;
      else if (transform === 'DeleteTransform') delete value[field];
      else if (transform === 'ServerTimestampTransform') value[field] = '2026-10-24T00:00:00.000Z';
      else value[field] = next;
    }
    documents.set(key, value); writes.push({ key, data });
  };
  const ref = (key: string): any => ({
    key, id: key.split('/')[1], get: async () => snapshot(key),
    set: async (data: any, options?: any) => write(key, data, options?.merge),
    update: async (data: any) => write(key, data, true), delete: async () => documents.delete(key),
  });
  const query = (name: string, filters: any[] = [], sort?: [string, string], count = Infinity, after?: any): any => ({
    doc: (id = `generated-${documents.size}`) => ref(`${name}/${id}`),
    where: (field: string, op: string, value: unknown) => query(name, [...filters, [field, op, value]], sort, count, after),
    orderBy: (field: string, direction = 'asc') => query(name, filters, [field, direction], count, after),
    limit: (limit: number) => query(name, filters, sort, limit, after),
    startAfter: (cursor: any) => query(name, filters, sort, count, cursor),
    get: async () => {
      queries.push({ collection: name, filters });
      const indexed = filters.some(filter => filter[1] === 'array-contains-any');
      if (name === 'conversation_memory_segments' && (indexed ? failIndexedQuery : failRecentQuery)) throw new Error('query_unavailable');
      let records = [...documents.entries()].filter(([key, value]) => key.startsWith(`${name}/`) &&
        filters.every(([field, op, expected]) => op === 'array-contains-any'
          ? value[field]?.some((term: string) => expected.includes(term)) : value[field] === expected));
      const compare = ([ak, av]: any, [bk, bv]: any) => {
        if (!sort) return ak.localeCompare(bk);
        const primary = String(av[sort[0]]).localeCompare(String(bv[sort[0]]));
        return (primary || ak.localeCompare(bk)) * (sort[1] === 'desc' ? -1 : 1);
      };
      if (sort) records = records.filter(([, value]) => value[sort[0]] !== undefined);
      records.sort(compare);
      if (after) records = records.filter(entry => compare(entry, [after.ref.key, after.data()]) > 0);
      const docs = records.slice(0, count).map(([key, value]) => snapshot(key, value));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const batch = () => {
    const pending: Array<() => void> = [];
    const api = {
      set: (reference: any, data: any, options?: any) => { pending.push(() => write(reference.key, data, options?.merge)); return api; },
      update: (reference: any, data: any) => { pending.push(() => write(reference.key, data, true)); return api; },
      delete: (reference: any) => { pending.push(() => documents.delete(reference.key)); return api; },
      commit: async () => { pending.forEach(apply => apply()); },
    };
    return api;
  };
  const adminDb = {
    collection: (name: string) => query(name), batch,
    runTransaction: async (callback: any) => {
      transactionCount++;
      const transaction = batch();
      const value = await callback({ ...transaction, get: (reference: any) => reference.get() });
      if (transactionCount === failTransactionAt) throw new Error('injected_commit_interruption');
      await transaction.commit(); return value;
    },
  };
  return { adminDb, documents, writes, queries,
    failAtTransaction: (count: number | null) => { failTransactionAt = count; },
    failRecent: (value: boolean) => { failRecentQuery = value; },
    failIndexed: (value: boolean) => { failIndexedQuery = value; },
    reset: () => { documents.clear(); writes.length = 0; queries.length = 0; transactionCount = 0;
      failTransactionAt = null; failRecentQuery = false; failIndexedQuery = false; },
  };
}
