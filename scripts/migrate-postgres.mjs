import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required. No database was changed.');
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10_000,
    application_name: 'trustvault-schema-migration',
  });

  try {
    const schema = await readFile(resolve(process.cwd(), 'db/schema.postgres.sql'), 'utf8');
    await pool.query('BEGIN');
    await pool.query(schema);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trustvault_schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      'INSERT INTO trustvault_schema_migrations(version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
      ['001_initial_postgres_schema'],
    );
    await pool.query('COMMIT');
    console.log('TrustVault PostgreSQL schema migration completed.');
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('PostgreSQL schema migration failed. Changes were rolled back.');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
