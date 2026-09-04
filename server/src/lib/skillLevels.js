// The company-wide 1–5 proficiency rubric every skill starts with.
//
// Shared because a skill can be created from two places — the Skills Library
// (POST /api/skills) and a profile's Add Skill (POST /api/employees/:id/skills)
// — and a skill with no rubric shows an empty Level Definition tab and gives
// assessors nothing to rate against. Keep in step with db/02_seed.sql, which
// applies the same ladder to the skills it ships.

const DEFAULT_LEVEL_DEFINITIONS = [
  [1, 'Awareness', 'Understands basic terminology, purpose and safety precautions.'],
  [2, 'Working Knowledge', 'Can explain concepts and perform simple tasks with guidance.'],
  [3, 'Practitioner', 'Can apply the skill independently in regular projects.'],
  [4, 'Advanced Practitioner', 'Can solve complex issues, guide others and validate outputs.'],
  [5, 'Expert / SME', 'Can define standards, mentor others, create training and approve capability.'],
];

// Inserts the five rubric rows from three parallel arrays. UNNEST zips them
// back into rows, in order.
const Q_INSERT_DEFAULT_LEVELS = `INSERT INTO skill_level_definitions (skill_id, level_no, level_title, level_definition)
     SELECT $1, * FROM UNNEST($2::int[], $3::text[], $4::text[])
     ON CONFLICT (skill_id, level_no) DO NOTHING`;

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
