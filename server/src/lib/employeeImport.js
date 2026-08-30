// Bulk employee onboarding: the spreadsheet format, in one place.
//
// This module owns BOTH ends of the round trip — the template the admin
// downloads and the parser that reads it back — so the two can never disagree
// about a column name, an order or an allowed value. Everything is derived from
// the COLUMNS table below.
//
// Deliberately DB-free. It takes plain lookup lists in and gives plain payloads
// out, which is what makes the whole format testable without a database (see
// test/employee-import.test.js). The route does the SQL; this does the paper.
const ExcelJS = require('exceljs');

// Upper bound on one upload. Large enough for a department, small enough that a
// single transaction and a single 400-with-every-error stay reasonable.
const MAX_ROWS = 500;

// The sheet the parser reads. Named rather than "first sheet" so a user who
// adds their own scratch tab does not silently import it.
const DATA_SHEET = 'Employees';
const REFERENCE_SHEET = 'Reference';

// The columns, in template order.
//
//   key      — the field on the payload handed to the route
//   list     — the name of a lookup list; drives the dropdown AND the resolver
//   required — blank is a row error rather than a NULL
const COLUMNS = [
  { key: 'employee_code', header: 'Employee Code', required: true, width: 16, hint: 'Unique, e.g. PTE0021' },
  { key: 'full_name', header: 'Full Name', required: true, width: 26 },
  { key: 'email', header: 'Email', required: true, width: 30 },
  {
    key: 'manager',
    header: 'Manager',
    required: true,
    width: 18,
    list: 'managers',
    hint: 'Employee code, email or exact full name',
  },
  { key: 'gender', header: 'Gender', width: 14, list: 'genders' },
  { key: 'grade', header: 'Grade', width: 14, hint: 'AM / DM / Manager' },
  { key: 'joining_date', header: 'Joining Date', width: 14, hint: 'YYYY-MM-DD' },
  // The four DB-backed lookups. `dropWhenEmpty` leaves the column out of the
  // template entirely when its table has no rows: a dropdown with nothing in it
  // cannot be filled in correctly, so offering it only invites a value that is
  // guaranteed to be rejected. The PARSER still knows the column — a sheet from
  // an older download, or from an installation that does have departments, goes
  // on importing unchanged.
  { key: 'department', header: 'Department', width: 24, list: 'departments', dropWhenEmpty: true },
  { key: 'team', header: 'Team', width: 24, list: 'teams', dropWhenEmpty: true },
  { key: 'job_role', header: 'Job Role', width: 26, list: 'jobRoles', dropWhenEmpty: true },
  { key: 'org_title', header: 'Hierarchy Title', width: 18, list: 'orgTitles' },
  { key: 'location', header: 'Location', width: 18, list: 'locations', dropWhenEmpty: true },
  { key: 'create_login', header: 'Create Login', width: 14, list: 'yesNo', hint: 'Yes or No (blank = Yes)' },
];

const HEADER_ROW = 1;
const HINT_ROW = 2; // Grey italics under the header; skipped by the parser.
const FIRST_DATA_ROW = 3;

const GENDERS = ['Not Specified', 'Male', 'Female', 'Other'];
const YES_NO = ['Yes', 'No'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Thrown when the sheet is readable but its contents are not importable. The
// route turns this into a 400 carrying every row error at once — one upload,
// one complete list of what to fix, rather than a fix-and-retry treadmill.
class ImportError extends Error {
  constructor(message, rows = []) {
    super(message);
    this.name = 'ImportError';
    this.status = 400;
    this.rows = rows;
  }
}

// ---------------------------------------------------------------------------
// Cell reading
// ---------------------------------------------------------------------------

// ExcelJS hands back a different shape depending on what the user typed, and
// every one of them reaches this format in practice: an email autoformats into a
// hyperlink object, a pasted name can carry rich text runs, a copied column can
// arrive as a formula. Flatten all of them to a trimmed string.
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return isoDate(value);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('').trim();
    if (value.text !== undefined) return cellText(value.text);
    if (value.result !== undefined) return cellText(value.result);
    if (value.hyperlink) return cellText(value.hyperlink).replace(/^mailto:/i, '');
  }
  return String(value).trim();
}

// Excel dates come back as Date objects pinned to UTC midnight, so reading the
// UTC parts is what keeps "2025-03-01" from drifting to the 28th of February for
// anyone west of Greenwich. Never use toISOString on a local-time Date here.
function isoDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Accepts what a real spreadsheet produces: a true date cell, an ISO string, or
// the dd/mm/yyyy a locale-formatted text column leaves behind.
function parseDate(raw) {
  if (!raw) return null;
  if (ISO_DATE_RE.test(raw)) {
    const [, y, m, d] = ISO_DATE_RE.exec(raw);
    const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (probe.getUTCMonth() !== Number(m) - 1 || probe.getUTCDate() !== Number(d)) return null;
    return raw;
  }
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (slash) {
    const [, d, m, y] = slash;
    const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (probe.getUTCMonth() !== Number(m) - 1 || probe.getUTCDate() !== Number(d)) return null;
    return isoDate(probe);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

// Names in a spreadsheet are typed by hand, so every match is case- and
// whitespace-insensitive.
function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Builds name -> id, remembering names that appear twice. An ambiguous name is
// not resolved to "whichever row came first" — it is reported, because guessing
// which of two identically named teams was meant is exactly the kind of silent
// wrong answer a bulk import must not produce.
//
// `choices` is kept alongside so a rejection can name what WAS acceptable.
function indexByName(list, nameField = 'name') {
  const byName = new Map();
  const ambiguous = new Set();
  const choices = [];
  for (const item of list || []) {
    const key = normalizeKey(item[nameField]);
    if (!key) continue;
    choices.push(item[nameField]);
    if (byName.has(key)) ambiguous.add(key);
    else byName.set(key, item);
  }
  return { byName, ambiguous, choices };
}

// The tail of a "not found" message: what the writer should have put instead.
//
// The empty case is the one that matters. On a fresh install none of these
// lookup tables has any rows, so "pick one from the Reference sheet" sends the
// reader to a blank column and tells them nothing. Say so outright.
function choicesFor(choices, label) {
  const list = choices || [];
  if (list.length === 0) {
    return `No ${label.toLowerCase()} values have been set up yet — leave this column blank, or ask an admin to create them first.`;
  }
  if (list.length <= 12) {
    return `Valid values: ${list.join(', ')}.`;
  }
  return `Pick one of the ${list.length} values on the ${REFERENCE_SHEET} sheet.`;
}

// The manager column accepts three spellings of the same person, because an HR
// export has whichever one it has: employee code, email, or exact full name.
function indexManagers(managers) {
  const byRef = new Map();
  const ambiguous = new Set();
  // Shown back on a rejection as "CODE (Name)" — the code is what the sheet
  // wants, the name is what makes it recognisable.
  const choices = [];
  for (const m of managers || []) {
    choices.push(m.employee_code ? `${m.employee_code} (${m.full_name})` : m.full_name);
    for (const ref of [m.employee_code, m.email, m.full_name]) {
      const key = normalizeKey(ref);
      if (!key) continue;
      if (byRef.has(key) && byRef.get(key).id !== m.id) ambiguous.add(key);
      else byRef.set(key, m);
    }
  }
  return { byRef, ambiguous, choices };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

// Cell range for a reference list, used as the dropdown source.
function listRange(column, count) {
  const last = Math.max(count, 1) + 1; // +1 for the reference sheet's own header
  return `'${REFERENCE_SHEET}'!$${column}$2:$${column}$${last}`;
}

// Builds the downloadable template: an empty data sheet whose every lookup
// column is a dropdown, plus a Reference sheet listing what those dropdowns
// contain. The dropdowns are the point — they are what stops the import failing
// on a department spelled three different ways.
async function buildTemplate(options) {
  const reference = referenceLists(options);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PTE CIP';
  wb.created = new Date();

  const ref = wb.addWorksheet(REFERENCE_SHEET);
  const sheet = wb.addWorksheet(DATA_SHEET, {
    views: [{ state: 'frozen', ySplit: HINT_ROW }],
  });
  // The data sheet is the one an admin should land on.
  sheet.orderNo = 0;

  // --- Reference sheet -----------------------------------------------------
  // One list per column, in a fixed order, so the ranges below are stable.
  const columnLetters = {};
  reference.forEach((list, i) => {
    const letter = String.fromCharCode(65 + i); // A, B, C, …
    columnLetters[list.name] = letter;
    const col = ref.getColumn(i + 1);
    col.width = list.width || 26;
    ref.getCell(`${letter}1`).value = list.title;
    list.values.forEach((value, r) => {
      ref.getCell(`${letter}${r + 2}`).value = value;
    });
  });
  ref.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ref.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
  ref.getRow(1).alignment = { vertical: 'middle' };

  // --- Data sheet ----------------------------------------------------------
  const columns = templateColumns(reference);
  sheet.columns = columns.map((c) => ({ key: c.key, width: c.width || 20 }));

  const header = sheet.getRow(HEADER_ROW);
  const hints = sheet.getRow(HINT_ROW);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.required ? `${c.header} *` : c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: c.required ? 'FF1D4ED8' : 'FF334155' },
    };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };

    const hint = hints.getCell(i + 1);
    hint.value = hintFor(c, reference);
    hint.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
    // The row hint is deliberately short — Excel clips it against the next
    // column. The full list goes in a note on the header, which pops out at
    // full size on hover and is the only place a long list stays readable.
    const full = fullListNote(c, reference);
    if (full) cell.note = full;
  });
  header.height = 20;

  // Dropdowns and formats on the empty data rows. Applied to a generous block so
  // the admin can paste a whole department in without losing the validation.
  for (let r = FIRST_DATA_ROW; r < FIRST_DATA_ROW + MAX_ROWS; r += 1) {
    columns.forEach((c, i) => {
      const cell = sheet.getRow(r).getCell(i + 1);
      if (c.key === 'joining_date') {
        cell.numFmt = 'yyyy-mm-dd';
      }
      if (!c.list) return;
      const list = reference.find((l) => l.name === c.list);
      if (!list || list.values.length === 0) return;
      cell.dataValidation = {
        type: 'list',
        allowBlank: !c.required,
        formulae: [listRange(columnLetters[c.list], list.values.length)],
        // A warning rather than a hard stop: the parser also accepts an email or
        // a full name in the manager column, and refusing those at the cell
        // level would block a legitimate paste from an HR export.
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'Not in the list',
        error: `Pick one of the values listed on the ${REFERENCE_SHEET} sheet.`,
      };
    });
  }

  return wb;
}

// The columns this particular template will carry.
//
// A `dropWhenEmpty` lookup whose table has no rows is left out altogether. The
// alternative — shipping the column with an empty dropdown — is worse than
// useless: there is no value the writer could put in it that would be accepted,
// so its only possible effect is a rejected upload. The column reappears on its
// own the day someone creates the first department.
//
// COLUMNS, not this, is what the PARSER matches against, so a sheet downloaded
// before those rows existed still imports.
function templateColumns(reference) {
  return COLUMNS.filter((c) => {
    if (!c.list || !c.dropWhenEmpty) return true;
    const list = reference.find((l) => l.name === c.list);
    return Boolean(list && list.values.length);
  });
}

// The hint under a column header.
//
// "Pick from the dropdown" was worse than useless when the dropdown was EMPTY —
// which is the normal state of a fresh install, where no departments, teams, job
// roles or locations have been created yet. Someone reading that hint types a
// sensible-looking value, and gets it back as "not found". So the hint now names
// the actual choices, and says plainly when there are none.
function hintFor(column, reference) {
  if (!column.list) return column.hint || '';

  const list = reference.find((l) => l.name === column.list);
  const values = (list && list.values) || [];

  if (values.length === 0) {
    // Only ever reachable for the optional columns: the manager list always
    // contains at least the caller themselves.
    return 'None set up yet — leave blank';
  }

  // A hand-written hint that already spells out every value says it better than
  // a generated list would ("Yes or No (blank = Yes)" beats "…. Yes, No").
  if (values.every((v) => new RegExp(`\\b${escapeRegExp(v)}\\b`, 'i').test(column.hint || ''))) {
    return column.hint;
  }

  const shown = values.slice(0, 3).join(', ');
  const rest = values.length > 3 ? `, +${values.length - 3} more` : '';
  const lead = column.hint ? `${column.hint}. ` : '';
  return `${lead}${shown}${rest}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The complete list, as a hover note on the header cell. Excel truncates nothing
// here, so this is where a 40-department list can actually be read.
function fullListNote(column, reference) {
  if (!column.list) return null;

  const list = reference.find((l) => l.name === column.list);
  // `noteValues` is the annotated form where a bare dropdown value is not
  // self-explanatory — a manager's code means nothing without their name.
  const values = (list && (list.noteValues || list.values)) || [];
  const title = `${column.header}${column.required ? ' (required)' : ''}`;

  if (values.length === 0) {
    return `${title}\n\nNothing has been set up under this heading yet, so leave the column blank. An admin can add them first if you need them filled in.`;
  }
  return `${title}\n\nAccepted values:\n${values.map((v) => `• ${v}`).join('\n')}`;
}

// The reference lists, in the order they are laid out on the Reference sheet.
// `values` feed the dropdowns; the manager list is codes, with name and title
// alongside so a human can find the right code.
function referenceLists(options) {
  const managers = options.managers || [];
  return [
    {
      name: 'managers',
      title: 'Manager (code)',
      width: 18,
      // The dropdown must offer the bare code — that is what goes in the cell.
      values: managers.map((m) => m.employee_code).filter(Boolean),
      // The header note has room to say who each code is.
      noteValues: managers
        .filter((m) => m.employee_code)
        .map((m) => `${m.employee_code} — ${m.full_name}${m.org_title ? ` (${m.org_title})` : ''}`),
    },
    {
      name: 'managerNames',
      title: 'Manager — name & title',
      width: 40,
      values: managers.map((m) => (m.org_title ? `${m.full_name} — ${m.org_title}` : m.full_name)),
    },
    { name: 'departments', title: 'Department', values: (options.departments || []).map((d) => d.name) },
    { name: 'teams', title: 'Team', values: (options.teams || []).map((t) => t.name) },
    { name: 'jobRoles', title: 'Job Role', values: (options.jobRoles || []).map((r) => r.role_name) },
    { name: 'orgTitles', title: 'Hierarchy Title', values: options.orgTitles || [] },
    { name: 'locations', title: 'Location', values: (options.locations || []).map((l) => l.name) },
    { name: 'genders', title: 'Gender', width: 16, values: GENDERS },
    { name: 'yesNo', title: 'Create Login', width: 14, values: YES_NO },
  ];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Reads the uploaded workbook into raw {excelRow, values} records.
//
// Columns are matched by HEADER TEXT, not by position, so a sheet whose columns
// were reordered or which carries an extra column of the customer's own still
// imports correctly.
async function readRows(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (err) {
    throw new ImportError('That file is not a readable .xlsx workbook. Start from the sample template.');
  }

  const sheet = wb.getWorksheet(DATA_SHEET) || wb.worksheets[0];
  if (!sheet) throw new ImportError('The workbook has no sheets.');

  // header text -> column key
  const wanted = new Map();
  for (const c of COLUMNS) wanted.set(normalizeKey(c.header), c.key);

  const headerRow = sheet.getRow(HEADER_ROW);
  const columnOf = new Map(); // column number -> key
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    // The template writes required headers with a trailing " *"; strip it.
    const key = wanted.get(normalizeKey(cellText(cell.value).replace(/\*+$/, '')));
    if (key) columnOf.set(colNumber, key);
  });

  const missing = COLUMNS.filter((c) => c.required && ![...columnOf.values()].includes(c.key));
  if (missing.length) {
    throw new ImportError(
      `The sheet is missing these columns: ${missing.map((c) => c.header).join(', ')}. Download the sample template and use it as-is.`
    );
  }

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < FIRST_DATA_ROW) return;
    const values = {};
    let hasContent = false;
    for (const [colNumber, key] of columnOf) {
      const text = cellText(row.getCell(colNumber).value);
      values[key] = text;
      if (text) hasContent = true;
    }
    // Blank rows are the normal residue of editing a spreadsheet; skip them
    // rather than reporting a dozen "employee_code is required" errors.
    if (hasContent) rows.push({ excelRow: rowNumber, values });
  });

  if (rows.length === 0) {
    throw new ImportError('The sheet has no data rows. Fill in at least one employee below the header.');
  }
  if (rows.length > MAX_ROWS) {
    throw new ImportError(`That is ${rows.length} rows; the limit is ${MAX_ROWS} per upload. Split the file.`);
  }
  return rows;
}

// Turns raw rows into insertable payloads, resolving every name to an id.
//
// Returns { records, errors }. `errors` is per row and CUMULATIVE: the caller
// gets every problem in the file at once, because the alternative is a
// fix-one-thing-and-re-upload treadmill.
//
// A manager may be someone created EARLIER in this same file, which is what lets
// a whole new team — its lead included — arrive in one upload. Such a record
// keeps `managerRef` with a null `manager_id`; only the caller, which is doing
// the inserting, can turn that into an id. It has to be an earlier row:
// resolving forward references would mean ordering the inserts by a graph the
// spreadsheet never promised is acyclic.
function validateRows(rows, options) {
  const departments = indexByName(options.departments || []);
  const teams = indexByName(options.teams || []);
  const jobRoles = indexByName(options.jobRoles || [], 'role_name');
  const locations = indexByName(options.locations || []);
  const managers = indexManagers(options.managers || []);
  const orgTitles = new Map((options.orgTitles || []).map((t) => [normalizeKey(t), t]));
  const genders = new Map(GENDERS.map((g) => [normalizeKey(g), g]));

  const records = [];
  const errors = [];
  const seenCodes = new Map();
  const seenEmails = new Map();
  // Every way an earlier row's person can be named, for the manager column.
  const namedEarlier = new Set();

  for (const { excelRow, values } of rows) {
    const problems = [];
    const add = (msg) => problems.push(msg);

    const employee_code = values.employee_code || '';
    const full_name = values.full_name || '';
    const email = (values.email || '').toLowerCase();

    if (!employee_code) add('Employee Code is required');
    if (!full_name) add('Full Name is required');
    if (!email) add('Email is required');
    else if (!EMAIL_RE.test(email)) add(`"${values.email}" is not a valid email address`);

    // Duplicates WITHIN the file. Without this the whole batch would fail on a
    // database unique violation naming neither the row nor the column.
    const codeKey = normalizeKey(employee_code);
    if (codeKey) {
      if (seenCodes.has(codeKey)) add(`Employee Code "${employee_code}" is also used on row ${seenCodes.get(codeKey)}`);
      else seenCodes.set(codeKey, excelRow);
    }
    if (email) {
      if (seenEmails.has(email)) add(`Email "${email}" is also used on row ${seenEmails.get(email)}`);
      else seenEmails.set(email, excelRow);
    }

    // --- Lookups ---
    const resolve = (raw, index, label) => {
      if (!raw) return null;
      const key = normalizeKey(raw);
      if (index.ambiguous.has(key)) {
        add(`${label} "${raw}" is ambiguous — more than one match`);
        return null;
      }
      const hit = index.byName.get(key);
      if (!hit) {
        add(`${label} "${raw}" was not found. ${choicesFor(index.choices, label)}`);
        return null;
      }
      return hit;
    };

    const department = resolve(values.department, departments, 'Department');
    const jobRole = resolve(values.job_role, jobRoles, 'Job Role');
    const location = resolve(values.location, locations, 'Location');

    // Teams are only unique within a department, so when a department is given
    // it disambiguates — which is also the check that a team actually belongs
    // to the department on the same row.
    let team = null;
    if (values.team) {
      const key = normalizeKey(values.team);
      const matches = (options.teams || []).filter((t) => normalizeKey(t.name) === key);
      const scoped = department ? matches.filter((t) => t.department_id === department.id) : matches;
      if (matches.length === 0) {
        add(`Team "${values.team}" was not found. ${choicesFor(teams.choices, 'Team')}`);
      } else if (scoped.length === 0) {
        add(`Team "${values.team}" does not belong to department "${values.department}"`);
      } else if (scoped.length > 1) {
        add(`Team "${values.team}" is ambiguous — set the Department column to say which one`);
      } else {
        [team] = scoped;
      }
    }

    let gender = null;
    if (values.gender) {
      gender = genders.get(normalizeKey(values.gender)) || null;
      if (!gender) add(`Gender "${values.gender}" was not found. ${choicesFor(GENDERS, 'Gender')}`);
    }

    let org_title = null;
    if (values.org_title) {
      org_title = orgTitles.get(normalizeKey(values.org_title)) || null;
      if (!org_title) {
        add(`Hierarchy Title "${values.org_title}" was not found. ${choicesFor(options.orgTitles, 'Hierarchy Title')}`);
      }
    }

    let joining_date = null;
    if (values.joining_date) {
      joining_date = parseDate(values.joining_date);
      if (!joining_date) add(`Joining Date "${values.joining_date}" is not a date — use YYYY-MM-DD`);
    }

    let create_login = true;
    if (values.create_login) {
      const key = normalizeKey(values.create_login);
      if (['no', 'n', 'false', '0'].includes(key)) create_login = false;
      else if (!['yes', 'y', 'true', '1'].includes(key)) add('Create Login must be Yes or No');
    }

    // --- Manager ---
    let manager = null;
    let managerRef = null;
    if (!values.manager) {
      add('Manager is required — every employee reports to someone');
    } else {
      const key = normalizeKey(values.manager);
      if (managers.ambiguous.has(key)) {
        add(`Manager "${values.manager}" matches more than one person — use their employee code`);
      } else {
        manager = managers.byRef.get(key) || null;
        if (manager) {
          // Already in the directory, and inside the caller's subtree — the
          // options list is scoped to exactly that.
        } else if (namedEarlier.has(key)) {
          managerRef = values.manager;
        } else {
          // Naming the codes matters more here than anywhere else: the manager
          // list is the caller's own subtree, so "not found" is usually not a
          // typo — it is a person they are not allowed to add anyone under, and
          // no amount of re-reading the sheet reveals who they CAN use.
          add(
            `Manager "${values.manager}" is not someone you can add people under. ${choicesFor(
              managers.choices,
              'Manager'
            )} You can also name someone listed on an earlier row of this file.`
          );
        }
      }
    }

    // Registered even when the row is rejected: the admin is going to fix this
    // row, so a later row reporting to them is not a second problem to report.
    for (const ref of [employee_code, email, full_name]) {
      const key = normalizeKey(ref);
      if (key) namedEarlier.add(key);
    }

    if (problems.length) {
      errors.push({ row: excelRow, name: full_name || employee_code || '(blank)', problems });
      continue;
    }

    records.push({
      excelRow,
      managerRef,
      payload: {
        employee_code,
        full_name,
        email,
        gender,
        grade: values.grade || null,
        joining_date,
        department_id: department ? department.id : null,
        team_id: team ? team.id : null,
        job_role_id: jobRole ? jobRole.id : null,
        manager_id: manager ? manager.id : null,
        location_id: location ? location.id : null,
        org_title,
        create_login,
      },
    });
  }

  return { records, errors };
}

module.exports = {
  COLUMNS,
  DATA_SHEET,
  REFERENCE_SHEET,
  GENDERS,
  MAX_ROWS,
  FIRST_DATA_ROW,
  ImportError,
  buildTemplate,
  readRows,
  validateRows,
  // Exported for the tests, which check the pieces the format hinges on.
  cellText,
  parseDate,
  normalizeKey,
};
