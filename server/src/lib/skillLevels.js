// The company-wide 1–5 proficiency rubric every skill starts with.
//
// Shared because a skill can be created from two places — the Skills Library
// (POST /api/skills) and a profile's Add Skill (POST /api/employees/:id/skills)
// — and a skill with no rubric shows an empty Level Definition tab and gives
// assessors nothing to rate against. Keep in step with db/02_seed.sql, which
// applies the same ladder to the skills it ships.
const { sql } = require('../db');

const DEFAULT_LEVEL_DEFINITIONS = [
  [1, 'Awareness', 'Understands basic terminology, purpose and safety precautions.'],
  [2, 'Working Knowledge', 'Can explain concepts and perform simple tasks with guidance.'],
  [3, 'Practitioner', 'Can apply the skill independently in regular projects.'],
  [4, 'Advanced Practitioner', 'Can solve complex issues, guide others and validate outputs.'],
  [5, 'Expert / SME', 'Can define standards, mentor others, create training and approve capability.'],
];

// Inserts the five rubric rows from three parallel arrays.
//
// T-SQL has no array type, so the mssql branch reads the same three parameters
// as JSON. The db layer serialises any array parameter with JSON.stringify (see
// db/normalize.js marshalValue), which is what lets BOTH branches take the
// identical params array — pg binds them as real arrays, SQL Server as JSON
// text. OPENJSON exposes an array's position as [key], so joining the three on
// [key] reassembles the rows in order, exactly as UNNEST does.
const Q_INSERT_DEFAULT_LEVELS = sql({
  pg: `INSERT INTO skill_level_definitions (skill_id, level_no, level_title, level_definition)
     SELECT $1, * FROM UNNEST($2::int[], $3::text[], $4::text[])
     ON CONFLICT (skill_id, level_no) DO NOTHING`,
  mssql: `INSERT INTO skill_level_definitions (skill_id, level_no, level_title, level_definition)
     SELECT $1, CAST(n.value AS int), t.value, d.value
       FROM OPENJSON($2) n
       JOIN OPENJSON($3) t ON t.[key] = n.[key]
       JOIN OPENJSON($4) d ON d.[key] = n.[key]
      WHERE NOT EXISTS (
        SELECT 1 FROM skill_level_definitions x WITH (UPDLOCK, HOLDLOCK)
         WHERE x.skill_id = $1 AND x.level_no = CAST(n.value AS int))`,
});

// Gives `skillId` the default rubric. Takes a client so it joins the caller's
// transaction — the rubric must not survive a rolled-back skill insert.
function insertDefaultLevelDefinitions(client, skillId) {
  return client.query(Q_INSERT_DEFAULT_LEVELS, [
    skillId,
    DEFAULT_LEVEL_DEFINITIONS.map((d) => d[0]),
    DEFAULT_LEVEL_DEFINITIONS.map((d) => d[1]),
    DEFAULT_LEVEL_DEFINITIONS.map((d) => d[2]),
  ]);
}

module.exports = { DEFAULT_LEVEL_DEFINITIONS, insertDefaultLevelDefinitions };
