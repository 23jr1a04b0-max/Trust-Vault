import pg from 'pg';

const { Pool } = pg;

/** Convert SQLite-style positional placeholders to PostgreSQL placeholders. */
export function parameterizeSql(sql) {
  let index = 0;
  let output = '';
  let single = false;
  let double = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" && !double && sql[i - 1] !== '\\') single = !single;
    if (ch === '"' && !single && sql[i - 1] !== '\\') double = !double;
    if (ch === '?' && !single && !double) output += '$' + (++index);
    else output += ch;
  }
  return output;
}

/**
 * PostgreSQL connection pool for TrustVault.
 * Never silently falls back to an ephemeral local database.
 */
export function createPostgresDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the PostgreSQL backend.');
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
    max: Number(process.env.PGPOOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'trustvault',
  });

  const parameterize = parameterizeSql;
  return {
    async query(sql, ...params) {
      return pool.query(parameterize(sql), params);
    },
    async one(sql, ...params) {
      const result = await pool.query(parameterize(sql), params);
      return result.rows[0] ?? null;
    },
    async many(sql, ...params) {
      const result = await pool.query(parameterize(sql), params);
      return result.rows;
    },
    async execute(sql, ...params) {
      const result = await pool.query(parameterize(sql), params);
      return { changes: result.rowCount ?? 0, rows: result.rows };
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          query: (sql, ...params) => client.query(parameterize(sql), params),
          one: async (sql, ...params) => (await client.query(parameterize(sql), params)).rows[0] ?? null,
          many: async (sql, ...params) => (await client.query(parameterize(sql), params)).rows,
          execute: async (sql, ...params) => {
            const result = await client.query(parameterize(sql), params);
            return { changes: result.rowCount ?? 0, rows: result.rows };
          },
        };
        const result = await work(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
