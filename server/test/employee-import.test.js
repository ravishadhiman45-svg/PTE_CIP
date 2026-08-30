// The bulk-onboarding spreadsheet format, round-tripped.
//
// The template and the parser are two halves of one contract, so most of these
// tests generate the real template, type into it, and read it back — the same
// path an admin takes. A test that hand-built a workbook instead would keep
// passing after the template's headers drifted away from the parser's.

process.env.DB_DIALECT = 'postgres';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const {
  COLUMNS,
  DATA_SHEET,
  FIRST_DATA_ROW,
  ImportError,
  buildTemplate,
  readRows,
  validateRows,
  cellText,
  parseDate,
} = require('../src/lib/employeeImport');

// The lookup lists a route would hand in, shaped exactly like loadFormOptions'
// output. Two teams share the name "Platform" on purpose: that collision is the
// one the resolver has to refuse to guess at.
const OPTIONS = {
  departments: [
    { id: 'd-eng', name: 'Engineering' },
    { id: 'd-ops', name: 'Operations' },
  ],
  teams: [
    { id: 't-eng-platform', name: 'Platform', department_id: 'd-eng' },
    { id: 't-ops-platform', name: 'Platform', department_id: 'd-ops' },
    { id: 't-battery', name: 'Battery Systems', department_id: 'd-eng' },
  ],
  jobRoles: [{ id: 'r-swe', role_name: 'Software Engineer' }],
  locations: [{ id: 'l-pune', name: 'Pune' }],
  managers: [
    {
      id: 'm-1',
      full_name: 'Asha Rao',
      org_title: 'DVM',
      employee_code: 'PTE0001',
      email: 'asha.rao@ptecip.local',
    },
    {
      id: 'm-2',
      full_name: 'Vikram Shah',
      org_title: 'DPM',
      employee_code: 'PTE0002',
      email: 'vikram.shah@ptecip.local',
    },
  ],
  orgTitles: ['Executive Officer', 'Sr. DVM', 'DVM', 'DDVM', 'DPM', 'TM'],
};

// Fills the generated template with `rows` (objects keyed by COLUMNS key) and
// returns the .xlsx bytes, so every test goes through the real headers.
async function sheetWith(rows, mutate) {
  const wb = await buildTemplate(OPTIONS);
  const sheet = wb.getWorksheet(DATA_SHEET);
  rows.forEach((values, i) => {
    const row = sheet.getRow(FIRST_DATA_ROW + i);
    COLUMNS.forEach((c, col) => {
      if (values[c.key] !== undefined) row.getCell(col + 1).value = values[c.key];
    });
  });
  if (mutate) mutate(sheet, wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Parse + validate, the way the route does.
async function importRows(rows, mutate) {
  const parsed = await readRows(await sheetWith(rows, mutate));
  return validateRows(parsed, OPTIONS);
}

const MINIMAL = {
  employee_code: 'PTE0100',
  full_name: 'Priya Nair',
  email: 'priya.nair@ptecip.local',
  manager: 'PTE0001',
};

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

test('the template carries every column, and only empty rows', async () => {
  const wb = await buildTemplate(OPTIONS);
  const sheet = wb.getWorksheet(DATA_SHEET);

  const headers = COLUMNS.map((_, i) => cellText(sheet.getRow(1).getCell(i + 1).value));
  assert.deepEqual(
    headers,
    COLUMNS.map((c) => (c.required ? `${c.header} *` : c.header))
  );

  // Nothing pre-filled: an admin's own first row must be row FIRST_DATA_ROW.
  const filled = cellText(sheet.getRow(FIRST_DATA_ROW).getCell(1).value);
  assert.equal(filled, '');
});

test('lookup columns get a dropdown sourced from the reference sheet', async () => {
  const wb = await buildTemplate(OPTIONS);
  const sheet = wb.getWorksheet(DATA_SHEET);
  const managerCol = COLUMNS.findIndex((c) => c.key === 'manager') + 1;

  const validation = sheet.getRow(FIRST_DATA_ROW).getCell(managerCol).dataValidation;
  assert.equal(validation.type, 'list');
  assert.match(validation.formulae[0], /Reference/);
});

// The hint row is the only guidance a writer sees before typing. "Pick from the
// dropdown" was actively misleading when the dropdown was empty, which is the
// normal state of a fresh install.
test('the hint row names the actual choices, not "pick from the dropdown"', async () => {
  const wb = await buildTemplate(OPTIONS);
  const sheet = wb.getWorksheet(DATA_SHEET);
  const hintFor = (key) =>
    cellText(sheet.getRow(2).getCell(COLUMNS.findIndex((c) => c.key === key) + 1).value);

  assert.equal(hintFor('department'), 'Engineering, Operations');
  assert.equal(hintFor('gender'), 'Not Specified, Male, Female, +1 more');
  assert.match(hintFor('manager'), /^Employee code, email or exact full name\. PTE0001, PTE0002$/);
  // A hand-written hint that already names every value is not padded with a
  // generated repeat of the same two words.
  assert.equal(hintFor('create_login'), 'Yes or No (blank = Yes)');
  for (const c of COLUMNS) assert.doesNotMatch(hintFor(c.key), /Pick from the dropdown/);
});

test('a lookup column with nothing to offer is left out of the template', async () => {
  // No department has ever been created, so there is no value the writer could
  // put in that column that would be accepted. Shipping it with an empty
  // dropdown can only produce a rejected upload.
  const wb = await buildTemplate({ ...OPTIONS, departments: [], teams: [], jobRoles: [], locations: [] });
  const sheet = wb.getWorksheet(DATA_SHEET);
  const headers = [];
  sheet.getRow(1).eachCell((cell) => headers.push(cellText(cell.value).replace(/\s*\*$/, '')));

  assert.deepEqual(headers, [
    'Employee Code', 'Full Name', 'Email', 'Manager', 'Gender', 'Grade',
    'Joining Date', 'Hierarchy Title', 'Create Login',
  ]);
});

test('the dropped columns come back as soon as the tables have rows', async () => {
  const wb = await buildTemplate(OPTIONS);
  const sheet = wb.getWorksheet(DATA_SHEET);
  const headers = [];
  sheet.getRow(1).eachCell((cell) => headers.push(cellText(cell.value).replace(/\s*\*$/, '')));
  for (const header of ['Department', 'Team', 'Job Role', 'Location']) {
    assert.ok(headers.includes(header), `${header} should be present`);
  }
});

test('a sheet saved before a column was dropped still imports', async () => {
  // The parser matches on COLUMNS, not on what this download happened to carry,
  // so an older template — or one from an installation that does have
  // departments — keeps working.
  const buffer = await sheetWith([{ ...MINIMAL, department: 'Engineering' }]);
  const { records, errors } = validateRows(await readRows(buffer), OPTIONS);
  assert.deepEqual(errors, []);
  assert.equal(records[0].payload.department_id, 'd-eng');
});

test('the header carries the full list as a hover note', async () => {
  const wb = await buildTemplate(OPTIONS);
  const sheet = wb.getWorksheet(DATA_SHEET);
  const noteOf = (key) => {
    const note = sheet.getRow(1).getCell(COLUMNS.findIndex((c) => c.key === key) + 1).note;
    return typeof note === 'string' ? note : (note && note.texts ? note.texts.map((t) => t.text).join('') : '');
  };
  assert.match(noteOf('job_role'), /Accepted values:\n• Software Engineer/);
  // Three teams, all of them listed — this is the place a long list stays whole.
  assert.match(noteOf('team'), /• Platform\n• Platform\n• Battery Systems/);
  // A manager code says nothing on its own, so the note spells out who it is.
  assert.match(noteOf('manager'), /• PTE0001 — Asha Rao \(DVM\)\n• PTE0002 — Vikram Shah \(DPM\)/);
});

test('a template built for one user only offers that user’s managers', async () => {
  const wb = await buildTemplate({ ...OPTIONS, managers: [OPTIONS.managers[0]] });
  const ref = wb.getWorksheet('Reference');
  assert.equal(cellText(ref.getCell('A2').value), 'PTE0001');
  assert.equal(cellText(ref.getCell('A3').value), '');
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

test('a filled-in template resolves every name to an id', async () => {
  const { records, errors } = await importRows([
    {
      ...MINIMAL,
      gender: 'Female',
      grade: 'AM',
      joining_date: '2025-03-01',
      department: 'Engineering',
      team: 'Battery Systems',
      job_role: 'Software Engineer',
      org_title: 'TM',
      location: 'Pune',
      create_login: 'Yes',
    },
  ]);

  assert.deepEqual(errors, []);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].payload, {
    employee_code: 'PTE0100',
    full_name: 'Priya Nair',
    email: 'priya.nair@ptecip.local',
    gender: 'Female',
    grade: 'AM',
    joining_date: '2025-03-01',
    department_id: 'd-eng',
    team_id: 't-battery',
    job_role_id: 'r-swe',
    manager_id: 'm-1',
    location_id: 'l-pune',
    org_title: 'TM',
    create_login: true,
  });
});

test('optional columns left blank become NULL, not empty strings', async () => {
  const { records, errors } = await importRows([MINIMAL]);
  assert.deepEqual(errors, []);
  const { payload } = records[0];
  for (const key of ['gender', 'grade', 'joining_date', 'department_id', 'team_id', 'job_role_id', 'location_id', 'org_title']) {
    assert.equal(payload[key], null, `${key} should be null`);
  }
  // Absent means "yes" — the single-add form defaults the same way.
  assert.equal(payload.create_login, true);
});

test('blank rows between entries are skipped, not reported', async () => {
  const { records, errors } = await importRows([
    MINIMAL,
    {},
    { ...MINIMAL, employee_code: 'PTE0101', email: 'b@ptecip.local' },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(records.length, 2);
});

test('columns are matched by header, so a reordered sheet still imports', async () => {
  const buffer = await sheetWith([MINIMAL], (sheet) => {
    // Move Full Name out to a fresh column and drop an unrelated one in front.
    sheet.getCell('R1').value = 'Full Name *';
    sheet.getCell(`R${FIRST_DATA_ROW}`).value = 'Priya Nair';
    sheet.getCell('B1').value = 'HR Notes';
    sheet.getCell(`B${FIRST_DATA_ROW}`).value = 'ignore me';
  });
  const { records, errors } = validateRows(await readRows(buffer), OPTIONS);
  assert.deepEqual(errors, []);
  assert.equal(records[0].payload.full_name, 'Priya Nair');
});

// ---------------------------------------------------------------------------
// Row-level validation
// ---------------------------------------------------------------------------

test('every problem in the file is reported at once, by row number', async () => {
  const { records, errors } = await importRows([
    { ...MINIMAL, email: 'not-an-email' },
    { ...MINIMAL, employee_code: 'PTE0101', email: 'b@ptecip.local', department: 'Marketing' },
    { ...MINIMAL, employee_code: 'PTE0102', email: 'c@ptecip.local', manager: '' },
  ]);

  assert.equal(records.length, 0);
  assert.equal(errors.length, 3);
  assert.deepEqual(errors.map((e) => e.row), [3, 4, 5]);
  assert.match(errors[0].problems[0], /not a valid email/);
  assert.match(errors[1].problems[0], /Department "Marketing" was not found/);
  assert.match(errors[2].problems[0], /Manager is required/);
});

test('a duplicate inside the file names the row it collides with', async () => {
  const { errors } = await importRows([
    MINIMAL,
    { ...MINIMAL, full_name: 'Someone Else' },
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 4);
  assert.match(errors[0].problems[0], /also used on row 3/);
  assert.match(errors[0].problems[1], /also used on row 3/);
});

test('an ambiguous team is refused rather than guessed', async () => {
  const { errors } = await importRows([{ ...MINIMAL, team: 'Platform' }]);
  assert.match(errors[0].problems[0], /ambiguous/);
});

test('the department column disambiguates a shared team name', async () => {
  const { records, errors } = await importRows([
    { ...MINIMAL, department: 'Operations', team: 'Platform' },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(records[0].payload.team_id, 't-ops-platform');
});

test('a team from the wrong department is caught', async () => {
  const { errors } = await importRows([
    { ...MINIMAL, department: 'Operations', team: 'Battery Systems' },
  ]);
  assert.match(errors[0].problems[0], /does not belong to department/);
});

test('a manager can be named by code, email or full name', async () => {
  const { records, errors } = await importRows([
    { ...MINIMAL, manager: 'PTE0002' },
    { ...MINIMAL, employee_code: 'PTE0101', email: 'b@x.local', manager: 'vikram.shah@ptecip.local' },
    { ...MINIMAL, employee_code: 'PTE0102', email: 'c@x.local', manager: 'Vikram Shah' },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(records.map((r) => r.payload.manager_id), ['m-2', 'm-2', 'm-2']);
});

test('a manager outside the caller’s subtree is rejected', async () => {
  const { records, errors } = await importRows([{ ...MINIMAL, manager: 'PTE9999' }]);
  assert.equal(records.length, 0);
  assert.match(errors[0].problems[0], /not someone you can add people under/);
});

test('a manager listed on an earlier row of the same file is accepted', async () => {
  // A whole new team, its lead included, in one upload.
  const { records, errors } = await importRows([
    { employee_code: 'PTE0200', full_name: 'New Lead', email: 'lead@x.local', manager: 'PTE0001' },
    { employee_code: 'PTE0201', full_name: 'Report One', email: 'r1@x.local', manager: 'PTE0200' },
    { employee_code: 'PTE0202', full_name: 'Report Two', email: 'r2@x.local', manager: 'New Lead' },
  ]);
  assert.deepEqual(errors, []);
  // The lead's own id does not exist yet, so those two carry the reference
  // forward for the caller to resolve after the insert.
  assert.deepEqual(records.map((r) => r.payload.manager_id), ['m-1', null, null]);
  assert.deepEqual(records.map((r) => r.managerRef), [null, 'PTE0200', 'New Lead']);
});

test('a manager listed on a LATER row is rejected, not silently reordered', async () => {
  const { errors } = await importRows([
    { employee_code: 'PTE0201', full_name: 'Report One', email: 'r1@x.local', manager: 'PTE0200' },
    { employee_code: 'PTE0200', full_name: 'New Lead', email: 'lead@x.local', manager: 'PTE0001' },
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 3);
  assert.match(errors[0].problems[0], /earlier row/);
});

test('a rejected row still counts as naming someone, so reports of it are not doubly flagged', async () => {
  const { errors } = await importRows([
    { employee_code: 'PTE0200', full_name: 'New Lead', email: 'bad-email', manager: 'PTE0001' },
    { employee_code: 'PTE0201', full_name: 'Report One', email: 'r1@x.local', manager: 'PTE0200' },
  ]);
  // Only the email is wrong. Reporting the second row's manager as missing
  // would send the admin chasing a problem that fixing row 3 already solves.
  assert.equal(errors.length, 1);
  assert.equal(errors[0].row, 3);
  assert.match(errors[0].problems[0], /not a valid email/);
});

test('lookups ignore case and stray whitespace', async () => {
  const { records, errors } = await importRows([
    { ...MINIMAL, manager: '  pte0001 ', department: 'ENGINEERING', gender: 'female', org_title: 'tm' },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(records[0].payload.department_id, 'd-eng');
  assert.equal(records[0].payload.gender, 'Female');
  assert.equal(records[0].payload.org_title, 'TM');
});

test('Create Login accepts No and defaults to yes', async () => {
  const { records, errors } = await importRows([
    { ...MINIMAL, create_login: 'No' },
    { ...MINIMAL, employee_code: 'PTE0101', email: 'b@x.local', create_login: 'yes' },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(records.map((r) => r.payload.create_login), [false, true]);
});

test('an out-of-range hierarchy title is rejected, and the message names the valid ones', async () => {
  const { errors } = await importRows([{ ...MINIMAL, org_title: 'Chief Wizard' }]);
  assert.match(errors[0].problems[0], /Hierarchy Title "Chief Wizard" was not found/);
  assert.match(errors[0].problems[0], /Valid values: Executive Officer, Sr\. DVM, DVM, DDVM, DPM, TM\./);
});

// ---------------------------------------------------------------------------
// Telling the writer what to put instead
//
// A rejection that only says "not found" is worthless when the writer cannot
// see the accepted list — which is the normal state of a fresh install, where
// none of the lookup tables has any rows at all.
// ---------------------------------------------------------------------------

test('a short lookup list is spelled out in the rejection', async () => {
  const { errors } = await importRows([{ ...MINIMAL, department: 'Marketing' }]);
  assert.match(errors[0].problems[0], /Valid values: Engineering, Operations\./);
});

test('a long lookup list points at the reference sheet with a count', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, name: `Dept ${i}` }));
  const rows = await readRows(await sheetWith([{ ...MINIMAL, department: 'Marketing' }]));
  const { errors } = validateRows(rows, { ...OPTIONS, departments: many });
  assert.match(errors[0].problems[0], /Pick one of the 20 values on the Reference sheet\./);
});

test('an EMPTY lookup list says so, instead of pointing at a blank column', async () => {
  // The fresh-install case: no departments exist, so every value a writer could
  // type is wrong and the dropdown they were told to use is empty.
  const rows = await readRows(await sheetWith([{ ...MINIMAL, department: 'Engineering' }]));
  const { errors } = validateRows(rows, { ...OPTIONS, departments: [] });
  assert.match(errors[0].problems[0], /No department values have been set up yet/);
  assert.match(errors[0].problems[0], /leave this column blank/);
});

test('an unusable manager rejection lists the managers that would work', async () => {
  const { errors } = await importRows([{ ...MINIMAL, manager: 'Amit Verma' }]);
  assert.match(errors[0].problems[0], /Valid values: PTE0001 \(Asha Rao\), PTE0002 \(Vikram Shah\)\./);
  assert.match(errors[0].problems[0], /earlier row of this file/);
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test('a real Excel date cell survives the trip without shifting a day', async () => {
  // ExcelJS stores dates as UTC; reading them as local time is what turns the
  // 1st into the 28th for anyone west of Greenwich.
  const { records, errors } = await importRows([
    { ...MINIMAL, joining_date: new Date(Date.UTC(2025, 2, 1)) },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(records[0].payload.joining_date, '2025-03-01');
});

test('parseDate takes ISO and dd/mm/yyyy, and refuses the impossible', () => {
  assert.equal(parseDate('2025-03-01'), '2025-03-01');
  assert.equal(parseDate('01/03/2025'), '2025-03-01');
  assert.equal(parseDate('1-3-2025'), '2025-03-01');
  assert.equal(parseDate('2025-02-30'), null);
  assert.equal(parseDate('March 2025'), null);
  assert.equal(parseDate(''), null);
});

test('a garbled date is a row error, not a silent NULL', async () => {
  const { errors } = await importRows([{ ...MINIMAL, joining_date: 'next tuesday' }]);
  assert.match(errors[0].problems[0], /is not a date/);
});

// ---------------------------------------------------------------------------
// Cell shapes
// ---------------------------------------------------------------------------

test('cellText flattens every shape Excel produces', () => {
  assert.equal(cellText('  padded  '), 'padded');
  assert.equal(cellText(null), '');
  assert.equal(cellText(42), '42');
  // An email typed into Excel autoformats into a hyperlink object.
  assert.equal(cellText({ text: 'a@b.local', hyperlink: 'mailto:a@b.local' }), 'a@b.local');
  assert.equal(cellText({ hyperlink: 'mailto:a@b.local' }), 'a@b.local');
  // Pasted text can carry formatting runs; a copied column can be a formula.
  assert.equal(cellText({ richText: [{ text: 'Priya ' }, { text: 'Nair' }] }), 'Priya Nair');
  assert.equal(cellText({ formula: 'A1', result: 'PTE0100' }), 'PTE0100');
});

test('an email autoformatted into a hyperlink still imports', async () => {
  const { records, errors } = await importRows([
    { ...MINIMAL, email: { text: 'Priya.Nair@ptecip.local', hyperlink: 'mailto:priya.nair@ptecip.local' } },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(records[0].payload.email, 'priya.nair@ptecip.local');
});

// ---------------------------------------------------------------------------
// Whole-file rejections
// ---------------------------------------------------------------------------

test('a file that is not a workbook is rejected as such', async () => {
  await assert.rejects(() => readRows(Buffer.from('just some text')), (err) => {
    assert.ok(err instanceof ImportError);
    assert.match(err.message, /not a readable .xlsx workbook/);
    return true;
  });
});

test('an empty template is rejected before any row work', async () => {
  const buffer = await sheetWith([]);
  await assert.rejects(() => readRows(buffer), (err) => {
    assert.match(err.message, /no data rows/);
    return true;
  });
});

test('a sheet missing a required column says which one', async () => {
  const buffer = await sheetWith([MINIMAL], (sheet) => {
    sheet.getCell('C1').value = 'Something Else';
  });
  await assert.rejects(() => readRows(buffer), (err) => {
    assert.match(err.message, /missing these columns: Email/);
    return true;
  });
});

test('the parser reads the Employees sheet, not whichever tab is first', async () => {
  const buffer = await sheetWith([MINIMAL], (sheet, wb) => {
    const scratch = wb.addWorksheet('My notes');
    scratch.orderNo = -1;
    scratch.getCell('A1').value = 'nothing to do with the import';
  });
  const { records } = validateRows(await readRows(buffer), OPTIONS);
  assert.equal(records.length, 1);
  assert.equal(records[0].payload.employee_code, 'PTE0100');
});
