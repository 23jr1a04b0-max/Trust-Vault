import test from 'node:test';
import assert from 'node:assert/strict';
import { parameterizeSql } from '../db/postgres.mjs';

test('converts positional placeholders to PostgreSQL parameters', () => {
  assert.equal(parameterizeSql('SELECT * FROM users WHERE id=? AND role=?'), 'SELECT * FROM users WHERE id=$1 AND role=$2');
});

test('does not rewrite question marks inside quoted SQL strings', () => {
  assert.equal(parameterizeSql("SELECT '?' AS marker, name FROM users WHERE email=?"), "SELECT '?' AS marker, name FROM users WHERE email=$1");
});

test('does not rewrite question marks inside quoted identifiers', () => {
  assert.equal(parameterizeSql('SELECT "field?" FROM sample WHERE id=?'), 'SELECT "field?" FROM sample WHERE id=$1');
});

test('keeps SQL with no placeholders unchanged', () => {
  assert.equal(parameterizeSql('SELECT COUNT(*) FROM users'), 'SELECT COUNT(*) FROM users');
});

test('preserves doubled quote escapes inside SQL string literals', () => {
  assert.equal(parameterizeSql("SELECT 'it''s ?' AS label WHERE id=?"), "SELECT 'it''s ?' AS label WHERE id=$1");
});

test('preserves doubled quote escapes inside identifiers', () => {
  assert.equal(parameterizeSql('SELECT "a""?b" FROM sample WHERE id=?'), 'SELECT "a""?b" FROM sample WHERE id=$1');
});
