// Which SQL dialect this process talks. Resolved once, at module load.
//
// This is read from DB_DIALECT and never inferred from the connection string.
// An inferred dialect that guesses wrong gives you the worst failure mode
// available: a working connection running the wrong SQL. An explicit, validated
// flag turns that into a startup crash instead.
const VALID = ['postgres', 'mssql'];

const raw = (process.env.DB_DIALECT || '').trim().toLowerCase();

if (!raw) {
  throw new Error(
    `[db] DB_DIALECT is not set. Set it to one of: ${VALID.join(', ')} in server/.env`
  );
}

if (!VALID.includes(raw)) {
  throw new Error(`[db] DB_DIALECT="${raw}" is not recognised. Valid values: ${VALID.join(', ')}`);
}

const dialect = raw;
const isMssql = dialect === 'mssql';
const isPostgres = dialect === 'postgres';

// Database objects that must be schema-qualified on SQL Server.
//
// T-SQL *requires* two-part naming for scalar user-defined functions
// (`dbo.can_view_employee(...)`, never `can_view_employee(...)`), and it is
// conventional for table-valued ones. Rather than have every call site know
// this, the rewriter prefixes any name in this list.
//
// This is a CLOSED list on purpose: prefixing by pattern ("looks like a
// function call") would also rewrite built-ins like COUNT( and COALESCE(.
const DB_FUNCTIONS = [
  'employee_subtree',
  'employee_ancestors',
  'employee_chain',
  'visible_employee_ids',
  'can_view_employee',
  'executive_dashboard',
];

module.exports = { dialect, isMssql, isPostgres, VALID, DB_FUNCTIONS };
