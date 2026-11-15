import { createHash } from 'node:crypto';

export interface DatabaseQueryIdentity {
  id: string;
  statement: string;
}

export function identifyDatabaseQuery(sql: string): DatabaseQueryIdentity {
  const statement = sql
    .replace(/'(?:''|[^'])*'/g, "'?'")
    .replace(/(^|[^\w$])\d+(?:\.\d+)?\b/g, '$1?')
    .replace(/\s+/g, ' ')
    .trim();
  const hash = createHash('sha256').update(statement).digest('hex').slice(0, 16);

  return {
    id: `dbq-${hash}`,
    statement: statement.slice(0, 400),
  };
}

export function estimateDatabaseResponseBytes(rows: readonly unknown[]): number {
  let bytes = 2;
  rows.forEach((row, index) => {
    const serialized = JSON.stringify(row) ?? 'null';
    bytes += Buffer.byteLength(serialized, 'utf8') + (index === 0 ? 0 : 1);
  });
  return bytes;
}
