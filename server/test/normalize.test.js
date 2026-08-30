// The differences that live in the VALUES rather than in the SQL.
//
// These are the ones a rewriter structurally cannot reach, and the ones most
// likely to ship undetected: the query runs fine on both dialects and only the
// data is subtly wrong.

process.env.DB_DIALECT = 'postgres';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeUuid,
  normalizeMssqlRecordset,
  decimalColumns,
  inferType,
  marshalValue,
  UUID_RE,
} = require('../src/db/normalize');

// A stand-in for the `mssql` module's type constructors. Using a fake keeps
// this test independent of the driver being installed, and makes the assertions
// read as "which type was chosen" rather than "which object".
const sqlTypes = {
  Bit: 'Bit',
  Int: 'Int',
  Float: 'Float',
  BigInt: 'BigInt',
  NVarChar: 'NVarChar',
  UniqueIdentifier: 'UniqueIdentifier',
  DateTimeOffset: 'DateTimeOffset',
  VarBinary: 'VarBinary',
};

// Builds a recordset the way `mssql` shapes one: an array with a `columns`
// property carrying per-column type metadata.
function recordset(rows, columns = {}) {
  const rs = [...rows];
  rs.columns = columns;
  return rs;
}
const decimalCol = { type: { declaration: 'decimal' } };
const intCol = { type: { declaration: 'int' } };

// ---------------------------------------------------------------------------
// UUID casing — the bug that silently breaks authorization
// ---------------------------------------------------------------------------

test('uuids are lowercased', () => {
  // tedious returns uniqueidentifier UPPERCASE; pg returns it lowercase. Three
  // === comparisons guard access: middleware/auth.js:50 (requireSelfOrAdmin)
  // and routes/verification.js:74,81 (approver must be in the chain).
  assert.equal(
    normalizeUuid('3F2504E0-4F89-11D3-9A0C-0305E82C3301'),
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
  );
});

test('an already-lowercase uuid is unchanged', () => {
  const v = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  assert.equal(normalizeUuid(v), v);
});

test('non-uuid strings are left completely alone', () => {
  // Critically, this must not lowercase names, emails or free text.
  for (const v of ['Ravisha Dhiman', 'Not.A.UUID', 'ABC-123', '', 'EMPLOYEE_CODE']) {
    assert.equal(normalizeUuid(v), v);
  }
});

test('a uuid-shaped substring inside longer text is not treated as a uuid', () => {
  const v = 'prefix-3F2504E0-4F89-11D3-9A0C-0305E82C3301-suffix';
  assert.equal(normalizeUuid(v), v, 'UUID_RE must be fully anchored');
});

test('non-string values pass through untouched', () => {
  const d = new Date(0);
  assert.equal(normalizeUuid(null), null);
  assert.equal(normalizeUuid(undefined), undefined);
  assert.equal(normalizeUuid(42), 42);
  assert.equal(normalizeUuid(true), true);
  assert.equal(normalizeUuid(d), d);
});

test('uuid recognition is anchored at both ends', () => {
  assert.ok(UUID_RE.test('3f2504e0-4f89-11d3-9a0c-0305e82c3301'));
  assert.ok(!UUID_RE.test(' 3f2504e0-4f89-11d3-9a0c-0305e82c3301'));
  assert.ok(!UUID_RE.test('3f2504e0-4f89-11d3-9a0c-0305e82c3301 '));
  assert.ok(!UUID_RE.test('3f2504e0-4f89-11d3-9a0c-0305e82c330'));
});

test('every uuid column in a row is normalised, not just the first', () => {
  const rs = recordset([
    {
      id: 'AAAAAAAA-0000-0000-0000-000000000001',
      manager_id: 'BBBBBBBB-0000-0000-0000-000000000002',
      full_name: 'Someone Uppercase NAME',
    },
  ]);
  const [row] = normalizeMssqlRecordset(rs);
  assert.equal(row.id, 'aaaaaaaa-0000-0000-0000-000000000001');
  assert.equal(row.manager_id, 'bbbbbbbb-0000-0000-0000-000000000002');
  assert.equal(row.full_name, 'Someone Uppercase NAME', 'names must not be touched');
});

// ---------------------------------------------------------------------------
// Numeric shape — the difference that reaches the React charts
// ---------------------------------------------------------------------------

test('decimal columns are stringified to match pg', () => {
  // pg returns NUMERIC as a string to avoid precision loss; mssql returns a
  // number. routes/dashboard.js:44 avg_gap would otherwise differ by type.
  const rs = recordset([{ avg_gap: 1.25 }], { avg_gap: decimalCol });
  const [row] = normalizeMssqlRecordset(rs);
  assert.equal(row.avg_gap, '1.25');
  assert.equal(typeof row.avg_gap, 'string');
});

test('int columns are left as JS numbers', () => {
  // pg returns int4 as a number too, so these already agree.
  const rs = recordset([{ unread: 7 }], { unread: intCol });
  const [row] = normalizeMssqlRecordset(rs);
  assert.equal(row.unread, 7);
  assert.equal(typeof row.unread, 'number');
});

test('a NULL decimal stays null, not the string "null"', () => {
  const rs = recordset([{ avg_gap: null }], { avg_gap: decimalCol });
  const [row] = normalizeMssqlRecordset(rs);
  assert.equal(row.avg_gap, null);
});

test('decimalColumns picks out only the money-ish declarations', () => {
  const cols = {
    a: { type: { declaration: 'decimal' } },
    b: { type: { declaration: 'numeric' } },
    c: { type: { declaration: 'money' } },
    d: { type: { declaration: 'int' } },
    e: { type: { declaration: 'float' } },
    f: { type: { declaration: 'nvarchar' } },
  };
  assert.deepEqual(decimalColumns(cols).sort(), ['a', 'b', 'c']);
});

test('float is deliberately NOT stringified', () => {
  // pg returns float8 as a JS number, so stringifying would create a new
  // divergence rather than remove one.
  const rs = recordset([{ x: 1.5 }], { x: { type: { declaration: 'float' } } });
  const [row] = normalizeMssqlRecordset(rs);
  assert.equal(typeof row.x, 'number');
});

test('missing or malformed column metadata does not throw', () => {
  assert.doesNotThrow(() => normalizeMssqlRecordset(recordset([{ a: 1 }])));
  assert.doesNotThrow(() => normalizeMssqlRecordset(recordset([{ a: 1 }], { a: {} })));
  assert.doesNotThrow(() => normalizeMssqlRecordset(recordset([{ a: 1 }], { a: { type: null } })));
  assert.deepEqual(decimalColumns(undefined), []);
  assert.deepEqual(decimalColumns(null), []);
});

test('an empty or absent recordset yields an empty array', () => {
  assert.deepEqual(normalizeMssqlRecordset([]), []);
  assert.deepEqual(normalizeMssqlRecordset(undefined), []);
  assert.deepEqual(normalizeMssqlRecordset(null), []);
});

test('null rows inside a recordset are skipped rather than crashing', () => {
  assert.doesNotThrow(() => normalizeMssqlRecordset(recordset([null, { a: 1 }])));
});

// ---------------------------------------------------------------------------
// Parameter marshalling — the inbound half
// ---------------------------------------------------------------------------

test('booleans bind as BIT', () => {
  // lib/visibility.js:42 pushes a raw JS boolean into all 40 scoped queries.
  assert.equal(inferType(sqlTypes, true), 'Bit');
  assert.equal(inferType(sqlTypes, false), 'Bit');
});

test('uuid strings bind as UniqueIdentifier, other strings as NVarChar', () => {
  // Not pedantry: binding a uuid as NVarChar still works via implicit
  // conversion but defeats index seeks, and uuids are the join key everywhere.
  assert.equal(inferType(sqlTypes, '3f2504e0-4f89-11d3-9a0c-0305e82c3301'), 'UniqueIdentifier');
  assert.equal(inferType(sqlTypes, '3F2504E0-4F89-11D3-9A0C-0305E82C3301'), 'UniqueIdentifier');
  assert.equal(inferType(sqlTypes, 'TM-001'), 'NVarChar');
  assert.equal(inferType(sqlTypes, '%search%'), 'NVarChar');
});

test('integers bind as Int and fractions as Float', () => {
  assert.equal(inferType(sqlTypes, 3), 'Int');
  assert.equal(inferType(sqlTypes, 0), 'Int');
  assert.equal(inferType(sqlTypes, -5), 'Int');
  assert.equal(inferType(sqlTypes, 3.5), 'Float');
});

test('dates, buffers and bigints get their own types', () => {
  assert.equal(inferType(sqlTypes, new Date()), 'DateTimeOffset');
  assert.equal(inferType(sqlTypes, Buffer.from('x')), 'VarBinary');
  assert.equal(inferType(sqlTypes, 10n), 'BigInt');
});

test('null and undefined bind as NVarChar (i.e. NULL)', () => {
  assert.equal(inferType(sqlTypes, null), 'NVarChar');
  assert.equal(inferType(sqlTypes, undefined), 'NVarChar');
});

test('undefined is marshalled to null, matching pg', () => {
  assert.equal(marshalValue(undefined), null);
  assert.equal(marshalValue(null), null);
});

test('arrays are marshalled to JSON so OPENJSON can read them', () => {
  // This is what lets lib/skillLevels.js pass the SAME params array to both
  // branches: pg binds real arrays, SQL Server reads the JSON with OPENJSON.
  assert.equal(marshalValue([1, 2, 3]), '[1,2,3]');
  assert.equal(marshalValue(['Awareness', 'Expert']), '["Awareness","Expert"]');
  assert.equal(marshalValue([]), '[]');
});

test('dates and buffers are NOT JSON-stringified', () => {
  const d = new Date(0);
  const b = Buffer.from('x');
  assert.equal(marshalValue(d), d);
  assert.equal(marshalValue(b), b);
});

test('scalars pass through marshalling unchanged', () => {
  assert.equal(marshalValue('x'), 'x');
  assert.equal(marshalValue(0), 0);
  assert.equal(marshalValue(false), false);
});
