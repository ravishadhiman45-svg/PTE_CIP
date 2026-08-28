-- =============================================================
-- PTE CIP — ORG HIERARCHY SEED (50 employees, one root)
-- Run after 07_org_hierarchy.sql. Safe to re-run (idempotent).
--
-- 02_seed.sql produced 20 employees across FIVE disconnected roots
-- (02_seed.sql:80-87 leaves 601, 607, 608, 609 and 610 with a NULL manager_id),
-- which made "the Executive Officer sees everyone" false: the root's subtree
-- covered 11 of 20 people. This file rebuilds the reporting tree as a single
-- connected hierarchy and then enforces the single-root rule.
--
-- The existing 20 employees (601-620) are REUSED, not replaced, so their CVs,
-- skill assignments, assessments, enrollments and approvals stay attached.
-- 30 new employees (621-650) fill out the lower levels, giving 50 synthetic
-- staff. Four real accounts created through the UI bring the live total to 54.
--
-- Shape follows the reference org chart, including its raggedness:
--   * depth reaches 6 on one branch (EO > Sr. DVM > DVM > DDVM > DPM > TM)
--   * DDVM appears at depth 3 AND depth 4; DPM at depth 4 AND 5
--     -> which is why org_title is a label and depth is derived, never stored
--   * some branches stop at DDVM (605, 610) or DPM (612, 617, 636)
--   * fan-out varies 1-3
-- =============================================================

BEGIN;

-- -----------------------------
-- 30 additional employees.
-- manager_id is deliberately left NULL here and wired in the single UPDATE
-- below, so this file never depends on insert ordering between a manager and
-- their reports.
-- -----------------------------
INSERT INTO employees (id, employee_code, full_name, email, gender, department_id, team_id, job_role_id, location_id, grade, joining_date, employment_status) VALUES
-- Under DPM Vivek Mishra (613) — Powertrain Quality
('00000000-0000-0000-0000-000000000621','PTE0021','Deepak Nair','deepak.nair@ptecip.local','Male','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000101','Engineer','2021-07-05','Active'),
('00000000-0000-0000-0000-000000000622','PTE0022','Sneha Iyer','sneha.iyer@ptecip.local','Female','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000508','00000000-0000-0000-0000-000000000101','Engineer','2022-03-14','Active'),
('00000000-0000-0000-0000-000000000623','PTE0023','Rohit Deshmukh','rohit.deshmukh@ptecip.local','Male','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000101','Engineer','2023-01-09','Active'),
-- Under DPM Ritu Saxena (615) — Capability Development
('00000000-0000-0000-0000-000000000624','PTE0024','Ananya Ghosh','ananya.ghosh@ptecip.local','Female','00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000406','00000000-0000-0000-0000-000000000510','00000000-0000-0000-0000-000000000101','Engineer','2022-09-19','Active'),
('00000000-0000-0000-0000-000000000625','PTE0025','Karan Malhotra','karan.malhotra@ptecip.local','Male','00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000406','00000000-0000-0000-0000-000000000510','00000000-0000-0000-0000-000000000101','Engineer','2023-05-22','Active'),
-- Under DPM Meenakshi Shekhawat (616) — Engine Design
('00000000-0000-0000-0000-000000000626','PTE0026','Priyanka Reddy','priyanka.reddy@ptecip.local','Female','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000507','00000000-0000-0000-0000-000000000101','Engineer','2021-11-30','Active'),
('00000000-0000-0000-0000-000000000647','PTE0047','Yash Thakur','yash.thakur@ptecip.local','Male','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000101','Engineer','2023-08-01','Active'),
-- DDVM layer under DVM Kavita Purohit (618) — Validation & Testing
('00000000-0000-0000-0000-000000000627','PTE0027','Sanjay Kulkarni','sanjay.kulkarni@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000000102','DM','2016-04-11','Active'),
('00000000-0000-0000-0000-000000000628','PTE0028','Farida Qureshi','farida.qureshi@ptecip.local','Female','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000000102','DM','2017-02-27','Active'),
-- DPM layer under Sanjay Kulkarni (627)
('00000000-0000-0000-0000-000000000629','PTE0029','Nikhil Joshi','nikhil.joshi@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000000102','AM','2019-06-17','Active'),
('00000000-0000-0000-0000-000000000630','PTE0030','Swati Pandey','swati.pandey@ptecip.local','Female','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000000102','AM','2020-01-20','Active'),
('00000000-0000-0000-0000-000000000631','PTE0031','Arjun Menon','arjun.menon@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000102','Engineer','2022-05-03','Active'),
('00000000-0000-0000-0000-000000000632','PTE0032','Tanvi Chauhan','tanvi.chauhan@ptecip.local','Female','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000507','00000000-0000-0000-0000-000000000102','Engineer','2023-02-13','Active'),
('00000000-0000-0000-0000-000000000633','PTE0033','Rakesh Yadav','rakesh.yadav@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000102','Engineer','2021-10-25','Active'),
('00000000-0000-0000-0000-000000000648','PTE0048','Megha Chandra','megha.chandra@ptecip.local','Female','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000508','00000000-0000-0000-0000-000000000102','Engineer','2023-11-06','Active'),
-- DPM layer under Farida Qureshi (628)
('00000000-0000-0000-0000-000000000634','PTE0034','Lakshmi Subramanian','lakshmi.subramanian@ptecip.local','Female','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000000102','AM','2019-09-02','Active'),
('00000000-0000-0000-0000-000000000635','PTE0035','Imran Shaikh','imran.shaikh@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000000102','AM','2020-07-28','Active'),
('00000000-0000-0000-0000-000000000636','PTE0036','Divya Rao','divya.rao@ptecip.local','Female','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000000102','AM','2021-04-15','Active'),
('00000000-0000-0000-0000-000000000637','PTE0037','Manish Gupta','manish.gupta@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000102','Engineer','2022-08-08','Active'),
('00000000-0000-0000-0000-000000000638','PTE0038','Ayesha Siddiqui','ayesha.siddiqui@ptecip.local','Female','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000507','00000000-0000-0000-0000-000000000102','Engineer','2023-03-27','Active'),
('00000000-0000-0000-0000-000000000639','PTE0039','Varun Bhatia','varun.bhatia@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000508','00000000-0000-0000-0000-000000000102','Engineer','2024-01-15','Active'),
('00000000-0000-0000-0000-000000000640','PTE0040','Kritika Sen','kritika.sen@ptecip.local','Female','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000102','Engineer','2022-12-05','Active'),
('00000000-0000-0000-0000-000000000649','PTE0049','Rajat Solanki','rajat.solanki@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000507','00000000-0000-0000-0000-000000000102','Engineer','2024-02-19','Active'),
-- Under DPM Jasleen Kaur (611) — EV Systems
('00000000-0000-0000-0000-000000000641','PTE0041','Suresh Pillai','suresh.pillai@ptecip.local','Male','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000000101','Engineer','2021-08-23','Active'),
('00000000-0000-0000-0000-000000000642','PTE0042','Nandini Das','nandini.das@ptecip.local','Female','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000506','00000000-0000-0000-0000-000000000101','Engineer','2022-11-11','Active'),
-- Under DPM Anirban Chatterjee (614) — Battery Systems
('00000000-0000-0000-0000-000000000643','PTE0043','Aditya Kapoor','aditya.kapoor@ptecip.local','Male','00000000-0000-0000-0000-000000000304','00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-000000000505','00000000-0000-0000-0000-000000000101','Engineer','2023-06-12','Active'),
-- Under DPM Irfan Mir (619) — Powertrain Quality
('00000000-0000-0000-0000-000000000644','PTE0044','Ruchi Agarwal','ruchi.agarwal@ptecip.local','Female','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000508','00000000-0000-0000-0000-000000000101','Engineer','2021-02-08','Active'),
('00000000-0000-0000-0000-000000000645','PTE0045','Vikram Rane','vikram.rane@ptecip.local','Male','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000101','Engineer','2022-06-27','Active'),
-- Under DPM Pooja Bansal (620) — EV Systems
('00000000-0000-0000-0000-000000000646','PTE0046','Shweta Borkar','shweta.borkar@ptecip.local','Female','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000000101','Engineer','2023-09-18','Active'),
('00000000-0000-0000-0000-000000000650','PTE0050','Preeti Naik','preeti.naik@ptecip.local','Female','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000506','00000000-0000-0000-0000-000000000101','Engineer','2024-04-08','Active')
ON CONFLICT (employee_code) DO NOTHING;

-- -----------------------------
-- The tree, in one authoritative statement.
--
-- Every reporting edge, title and chart position for all 50 people lives here
-- and nowhere else. Running it as a single UPDATE also means the cycle trigger
-- evaluates every row against the same pre-statement snapshot, so no
-- intermediate state can transiently look like a loop.
-- -----------------------------
WITH tree(emp, mgr, title, sib) AS (
  VALUES
  -- L1 root
  ('00000000-0000-0000-0000-000000000601'::uuid, NULL::uuid,                                        'Executive Officer', 1),

  -- L2
  ('00000000-0000-0000-0000-000000000602'::uuid, '00000000-0000-0000-0000-000000000601'::uuid,      'Sr. DVM', 1),
  ('00000000-0000-0000-0000-000000000603'::uuid, '00000000-0000-0000-0000-000000000601'::uuid,      'Sr. DVM', 2),

  -- ---- Sr. DVM Neha Verma (602) ----
  ('00000000-0000-0000-0000-000000000604'::uuid, '00000000-0000-0000-0000-000000000602'::uuid,      'DVM',  1),
  ('00000000-0000-0000-0000-000000000605'::uuid, '00000000-0000-0000-0000-000000000602'::uuid,      'DDVM', 2),  -- leaf DDVM
  ('00000000-0000-0000-0000-000000000606'::uuid, '00000000-0000-0000-0000-000000000602'::uuid,      'DVM',  3),

  ('00000000-0000-0000-0000-000000000611'::uuid, '00000000-0000-0000-0000-000000000604'::uuid,      'DPM',  1),
  ('00000000-0000-0000-0000-000000000612'::uuid, '00000000-0000-0000-0000-000000000604'::uuid,      'DPM',  2),  -- leaf DPM
  ('00000000-0000-0000-0000-000000000641'::uuid, '00000000-0000-0000-0000-000000000611'::uuid,      'TM',   1),
  ('00000000-0000-0000-0000-000000000642'::uuid, '00000000-0000-0000-0000-000000000611'::uuid,      'TM',   2),

  -- DDVM at depth 4, directly under a DVM — the case a strict level model rejects
  ('00000000-0000-0000-0000-000000000607'::uuid, '00000000-0000-0000-0000-000000000606'::uuid,      'DDVM', 1),
  ('00000000-0000-0000-0000-000000000608'::uuid, '00000000-0000-0000-0000-000000000606'::uuid,      'DDVM', 2),

  ('00000000-0000-0000-0000-000000000613'::uuid, '00000000-0000-0000-0000-000000000607'::uuid,      'DPM',  1),
  ('00000000-0000-0000-0000-000000000614'::uuid, '00000000-0000-0000-0000-000000000607'::uuid,      'DPM',  2),
  ('00000000-0000-0000-0000-000000000621'::uuid, '00000000-0000-0000-0000-000000000613'::uuid,      'TM',   1),  -- depth 6
  ('00000000-0000-0000-0000-000000000622'::uuid, '00000000-0000-0000-0000-000000000613'::uuid,      'TM',   2),
  ('00000000-0000-0000-0000-000000000623'::uuid, '00000000-0000-0000-0000-000000000613'::uuid,      'TM',   3),
  ('00000000-0000-0000-0000-000000000643'::uuid, '00000000-0000-0000-0000-000000000614'::uuid,      'TM',   1),

  ('00000000-0000-0000-0000-000000000615'::uuid, '00000000-0000-0000-0000-000000000608'::uuid,      'DPM',  1),
  ('00000000-0000-0000-0000-000000000616'::uuid, '00000000-0000-0000-0000-000000000608'::uuid,      'DPM',  2),
  ('00000000-0000-0000-0000-000000000617'::uuid, '00000000-0000-0000-0000-000000000608'::uuid,      'DPM',  3),  -- leaf DPM
  ('00000000-0000-0000-0000-000000000624'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,      'TM',   1),
  ('00000000-0000-0000-0000-000000000625'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,      'TM',   2),
  ('00000000-0000-0000-0000-000000000626'::uuid, '00000000-0000-0000-0000-000000000616'::uuid,      'TM',   1),
  ('00000000-0000-0000-0000-000000000647'::uuid, '00000000-0000-0000-0000-000000000616'::uuid,      'TM',   2),

  -- ---- Sr. DVM Shalini Srivastava (603) ----
  ('00000000-0000-0000-0000-000000000609'::uuid, '00000000-0000-0000-0000-000000000603'::uuid,      'DVM',  1),
  ('00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000603'::uuid,      'DDVM', 2),  -- leaf DDVM; holds the `admin` role
  ('00000000-0000-0000-0000-000000000618'::uuid, '00000000-0000-0000-0000-000000000603'::uuid,      'DVM',  3),

  ('00000000-0000-0000-0000-000000000619'::uuid, '00000000-0000-0000-0000-000000000609'::uuid,      'DPM',  1),
  ('00000000-0000-0000-0000-000000000620'::uuid, '00000000-0000-0000-0000-000000000609'::uuid,      'DPM',  2),
  ('00000000-0000-0000-0000-000000000644'::uuid, '00000000-0000-0000-0000-000000000619'::uuid,      'TM',   1),
  ('00000000-0000-0000-0000-000000000645'::uuid, '00000000-0000-0000-0000-000000000619'::uuid,      'TM',   2),
  ('00000000-0000-0000-0000-000000000646'::uuid, '00000000-0000-0000-0000-000000000620'::uuid,      'TM',   1),
  ('00000000-0000-0000-0000-000000000650'::uuid, '00000000-0000-0000-0000-000000000620'::uuid,      'TM',   2),

  ('00000000-0000-0000-0000-000000000627'::uuid, '00000000-0000-0000-0000-000000000618'::uuid,      'DDVM', 1),
  ('00000000-0000-0000-0000-000000000628'::uuid, '00000000-0000-0000-0000-000000000618'::uuid,      'DDVM', 2),

  ('00000000-0000-0000-0000-000000000629'::uuid, '00000000-0000-0000-0000-000000000627'::uuid,      'DPM',  1),
  ('00000000-0000-0000-0000-000000000630'::uuid, '00000000-0000-0000-0000-000000000627'::uuid,      'DPM',  2),
  ('00000000-0000-0000-0000-000000000631'::uuid, '00000000-0000-0000-0000-000000000629'::uuid,      'TM',   1),
  ('00000000-0000-0000-0000-000000000632'::uuid, '00000000-0000-0000-0000-000000000629'::uuid,      'TM',   2),
  ('00000000-0000-0000-0000-000000000633'::uuid, '00000000-0000-0000-0000-000000000630'::uuid,      'TM',   1),
  ('00000000-0000-0000-0000-000000000648'::uuid, '00000000-0000-0000-0000-000000000630'::uuid,      'TM',   2),

  ('00000000-0000-0000-0000-000000000634'::uuid, '00000000-0000-0000-0000-000000000628'::uuid,      'DPM',  1),
  ('00000000-0000-0000-0000-000000000635'::uuid, '00000000-0000-0000-0000-000000000628'::uuid,      'DPM',  2),
  ('00000000-0000-0000-0000-000000000636'::uuid, '00000000-0000-0000-0000-000000000628'::uuid,      'DPM',  3),  -- leaf DPM
  ('00000000-0000-0000-0000-000000000637'::uuid, '00000000-0000-0000-0000-000000000634'::uuid,      'TM',   1),
  ('00000000-0000-0000-0000-000000000638'::uuid, '00000000-0000-0000-0000-000000000634'::uuid,      'TM',   2),
  ('00000000-0000-0000-0000-000000000639'::uuid, '00000000-0000-0000-0000-000000000634'::uuid,      'TM',   3),
  ('00000000-0000-0000-0000-000000000640'::uuid, '00000000-0000-0000-0000-000000000635'::uuid,      'TM',   1),
  ('00000000-0000-0000-0000-000000000649'::uuid, '00000000-0000-0000-0000-000000000635'::uuid,      'TM',   2)
)
UPDATE employees e
SET manager_id    = COALESCE(
                      t.mgr,
                      -- Only 601 has a NULL manager in the table above. If the
                      -- platform-owner account exists it is the real root, so
                      -- 601 hangs off it instead. Without this COALESCE a SECOND
                      -- run would momentarily set 601 to NULL while the owner is
                      -- also NULL, and uq_employees_single_root would reject the
                      -- statement — i.e. the file would not be re-runnable.
                      (SELECT o.id FROM employees o
                        WHERE lower(o.email) = 'ravisha.goodpegg@gmail.com')
                    ),
    org_title     = t.title,
    sibling_order = t.sib
FROM tree t
WHERE e.id = t.emp;

-- -----------------------------
-- Real accounts created through the UI.
--
-- These are matched by EMAIL / employee_code rather than by uuid, because their
-- ids came from gen_random_uuid() and exist only in this database. On a fresh
-- database these statements match nothing and the chart above stands on its own
-- with 601 as the root — which is why the tree block deliberately leaves 601
-- with a NULL manager rather than pointing it at an id that may not exist.
-- (Email is already the identity key this app authenticates on: auth.js:29.)
-- -----------------------------

-- The platform owner becomes the Executive Officer.
UPDATE employees
SET org_title = 'Executive Officer', sibling_order = 1, manager_id = NULL
WHERE lower(email) = 'ravisha.goodpegg@gmail.com';

-- ...which demotes Rahul Sharma to a third Sr. DVM alongside Neha and Shalini.
-- Depth is unchanged: 602 and 603 were already at depth 2.
UPDATE employees e
SET manager_id    = r.id,
    org_title     = 'Sr. DVM',
    sibling_order = CASE e.id
                      WHEN '00000000-0000-0000-0000-000000000601'::uuid THEN 1
                      WHEN '00000000-0000-0000-0000-000000000602'::uuid THEN 2
                      ELSE 3
                    END
FROM employees r
WHERE lower(r.email) = 'ravisha.goodpegg@gmail.com'
  AND e.id IN (
    '00000000-0000-0000-0000-000000000601',
    '00000000-0000-0000-0000-000000000602',
    '00000000-0000-0000-0000-000000000603'
  );

-- The remaining three keep the manager they were created with; they only need a
-- title and a chart position. 1234 and PTE002 sit under DDVM Aamir Lone (608)
-- next to DPMs 615/616/617; Aditi reports to PTE002.
UPDATE employees SET org_title = 'DPM', sibling_order = 4 WHERE employee_code = '1234';
UPDATE employees SET org_title = 'DPM', sibling_order = 5 WHERE employee_code = 'PTE002';
UPDATE employees SET org_title = 'TM',  sibling_order = 1 WHERE employee_code = '1234567';

-- -----------------------------
-- Login accounts for the new employees.
-- Same statements as 02_seed.sql:108-114; both are idempotent.
-- -----------------------------
INSERT INTO app_users (id, employee_id, email, display_name, last_login_at)
SELECT gen_random_uuid(), id, email, full_name, NOW() - INTERVAL '2 days' FROM employees
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id FROM app_users au
JOIN app_permission_roles pr ON pr.role_key = 'employee'
ON CONFLICT DO NOTHING;

-- Demo convenience only: give anyone with at least one direct report the
-- `manager` permission role, so the nav matches the new tree.
--
-- This does NOT grant visibility. Permission roles answer "what features can I
-- use"; the tree answers "whose records can I see". The only role that affects
-- visibility is `admin`, which bypasses it.
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id
FROM app_users au
JOIN app_permission_roles pr ON pr.role_key = 'manager'
WHERE EXISTS (SELECT 1 FROM employees c WHERE c.manager_id = au.employee_id)
ON CONFLICT DO NOTHING;

COMMIT;

-- -----------------------------
-- Exactly one root.
--
-- Created last, because it cannot hold until the reparenting above has run.
-- Without it, "the Executive Officer sees all 50" is not a property of the
-- system — it is an accident of the data.
-- -----------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_single_root
  ON employees ((TRUE)) WHERE manager_id IS NULL;
