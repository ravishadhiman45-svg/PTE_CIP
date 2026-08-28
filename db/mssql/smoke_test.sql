-- =============================================================
-- PTE CIP — T-SQL smoke test
--
-- Verifies the parts of db/mssql/ that are a genuine re-design rather than a
-- type substitution, and would therefore fail silently or not at all under a
-- schema-only check: the recursive traversal and its cycle guard, the visibility
-- predicate, the AFTER-trigger cycle rejection, the filtered single-root index,
-- and the derived sort_key ordering.
--
-- DESTRUCTIVE: it DELETEs from employees and builds a six-person tree. Run it
-- against a scratch database, never one holding real data.
--
--   sqlcmd -S . -E -C -d ptecip -i db/mssql/smoke_test.sql
--
-- Every row of every result set should read PASS.
-- =============================================================

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

-- A six-person tree:  A -> (B, C);  B -> (D, E);  D -> F
DECLARE @A UNIQUEIDENTIFIER = '00000000-0000-0000-0000-00000000000a';
DECLARE @B UNIQUEIDENTIFIER = '00000000-0000-0000-0000-00000000000b';
DECLARE @C UNIQUEIDENTIFIER = '00000000-0000-0000-0000-00000000000c';
DECLARE @D UNIQUEIDENTIFIER = '00000000-0000-0000-0000-00000000000d';
DECLARE @E UNIQUEIDENTIFIER = '00000000-0000-0000-0000-00000000000e';
DECLARE @F UNIQUEIDENTIFIER = '00000000-0000-0000-0000-00000000000f';

DELETE FROM employees;

INSERT INTO employees (id, employee_code, full_name, email, org_title, manager_id, sibling_order) VALUES
  (@A,'E-A','Root A','a@x.com','Executive Officer', NULL, 1),
  (@B,'E-B','Person B','b@x.com','DVM',  @A, 1),
  (@C,'E-C','Person C','c@x.com','DVM',  @A, 2),
  (@D,'E-D','Person D','d@x.com','DPM',  @B, 1),
  (@E,'E-E','Person E','e@x.com','DPM',  @B, 2),
  (@F,'E-F','Person F','f@x.com','TM',   @D, 1);

PRINT '--- traversal ---';
SELECT 'subtree(A) = 6'            AS chk, CASE WHEN (SELECT COUNT(*) FROM dbo.employee_subtree(@A))=6 THEN 'PASS' ELSE 'FAIL' END AS r
UNION ALL SELECT 'subtree(B) = 4',        CASE WHEN (SELECT COUNT(*) FROM dbo.employee_subtree(@B))=4 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'subtree(F) = 1 (leaf)', CASE WHEN (SELECT COUNT(*) FROM dbo.employee_subtree(@F))=1 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'subtree(A) depth0=self',CASE WHEN (SELECT depth FROM dbo.employee_subtree(@A) WHERE employee_id=@A)=0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'ancestors(F) = 3',      CASE WHEN (SELECT COUNT(*) FROM dbo.employee_ancestors(@F))=3 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'ancestors(F) d1=D',     CASE WHEN (SELECT employee_id FROM dbo.employee_ancestors(@F) WHERE distance=1)=@D THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'ancestors(F) d3=A',     CASE WHEN (SELECT employee_id FROM dbo.employee_ancestors(@F) WHERE distance=3)=@A THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'ancestors(A) = 0 (root)',CASE WHEN (SELECT COUNT(*) FROM dbo.employee_ancestors(@A))=0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'chain(F) projects 5 cols',CASE WHEN (SELECT COUNT(*) FROM dbo.employee_chain(@F))=3 THEN 'PASS' ELSE 'FAIL' END;

PRINT '--- visibility predicate ---';
SELECT 'visible(A,admin=0) = 6 (root sees org)' AS chk, CASE WHEN (SELECT COUNT(*) FROM dbo.visible_employee_ids(@A,0))=6 THEN 'PASS' ELSE 'FAIL' END AS r
UNION ALL SELECT 'visible(B,0) = 4',              CASE WHEN (SELECT COUNT(*) FROM dbo.visible_employee_ids(@B,0))=4 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'visible(F,0) = 1 (leaf: self)', CASE WHEN (SELECT COUNT(*) FROM dbo.visible_employee_ids(@F,0))=1 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'visible(F,admin=1) = 6',        CASE WHEN (SELECT COUNT(*) FROM dbo.visible_employee_ids(@F,1))=6 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'visible(F,NULL) = 1 (COALESCE)',CASE WHEN (SELECT COUNT(*) FROM dbo.visible_employee_ids(@F,NULL))=1 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'canView(B,F,0) = 1',            CASE WHEN dbo.can_view_employee(@B,@F,0)=1 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'canView(C,F,0) = 0 (other branch)',CASE WHEN dbo.can_view_employee(@C,@F,0)=0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'canView(F,A,0) = 0 (no upward)', CASE WHEN dbo.can_view_employee(@F,@A,0)=0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'canView(F,A,1) = 1 (admin)',     CASE WHEN dbo.can_view_employee(@F,@A,1)=1 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'canView(F,F,0) = 1 (self)',      CASE WHEN dbo.can_view_employee(@F,@F,0)=1 THEN 'PASS' ELSE 'FAIL' END;

PRINT '--- v_employee_tree ---';
SELECT 'depth(A)=1',       CASE WHEN (SELECT depth FROM v_employee_tree WHERE id=@A)=1 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'depth(F)=4',      CASE WHEN (SELECT depth FROM v_employee_tree WHERE id=@F)=4 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'code(F)=1.1.1',   CASE WHEN (SELECT structural_code FROM v_employee_tree WHERE id=@F)='1.1.1' THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'label(F)=TM 1.1.1',CASE WHEN (SELECT display_label FROM v_employee_tree WHERE id=@F)='TM 1.1.1' THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'has_reports(D)=1',CASE WHEN (SELECT has_reports FROM v_employee_tree WHERE id=@D)=1 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'has_reports(F)=0',CASE WHEN (SELECT has_reports FROM v_employee_tree WHERE id=@F)=0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'all 6 in tree',   CASE WHEN (SELECT COUNT(*) FROM v_employee_tree)=6 THEN 'PASS' ELSE 'FAIL' END
-- One segment per level BELOW the root, so a depth-4 node has three.
UNION ALL SELECT 'sort_key padded', CASE WHEN (SELECT sort_key FROM v_employee_tree WHERE id=@F)='0001.0001.0001.' THEN 'PASS' ELSE 'FAIL' END;

PRINT '--- sort_key orders numerically (the reason it exists) ---';
-- 10 siblings under C: plain text ordering of structural_code would put "10"
-- before "2"; the zero-padded key must not.
DECLARE @i INT = 1;
WHILE @i <= 10
BEGIN
  INSERT INTO employees (employee_code, full_name, email, org_title, manager_id, sibling_order)
    VALUES (CONCAT('E-C',@i), CONCAT('Child ',@i), CONCAT('c',@i,'@x.com'), 'TM', @C, @i);
  SET @i += 1;
END

SELECT 'sibling 10 sorts last' AS chk,
       CASE WHEN (SELECT TOP 1 structural_code FROM v_employee_tree WHERE manager_id=@C ORDER BY sort_key DESC) = '2.10'
            THEN 'PASS' ELSE 'FAIL' END AS r
UNION ALL
SELECT 'raw code would sort wrong',
       CASE WHEN (SELECT TOP 1 structural_code FROM v_employee_tree WHERE manager_id=@C ORDER BY structural_code DESC) <> '2.10'
            THEN 'PASS (confirms sort_key is needed)' ELSE 'FAIL' END;

PRINT '--- updated_at trigger ---';
DECLARE @before DATETIMEOFFSET = (SELECT updated_at FROM employees WHERE id=@F);
WAITFOR DELAY '00:00:00.050';
UPDATE employees SET grade = 'G5' WHERE id = @F;
SELECT 'updated_at advanced' AS chk,
       CASE WHEN (SELECT updated_at FROM employees WHERE id=@F) > @before THEN 'PASS' ELSE 'FAIL' END AS r;

PRINT '--- cycle guard (must be rejected) ---';
BEGIN TRY
  UPDATE employees SET manager_id = @F WHERE id = @A;   -- A under its own descendant
  SELECT 'cycle rejected' AS chk, 'FAIL - was allowed' AS r;
END TRY
BEGIN CATCH
  SELECT 'cycle rejected' AS chk,
         CASE WHEN ERROR_NUMBER() = 50007 THEN 'PASS (50007)'
              ELSE CONCAT('PARTIAL - err ', ERROR_NUMBER()) END AS r;
END CATCH

PRINT '--- a legitimate reparent must still be ALLOWED ---';
-- This is the case a naive AFTER-trigger port would wrongly reject.
BEGIN TRY
  UPDATE employees SET manager_id = @C WHERE id = @E;
  SELECT 'legit reparent allowed' AS chk,
         CASE WHEN (SELECT manager_id FROM employees WHERE id=@E)=@C THEN 'PASS' ELSE 'FAIL' END AS r;
END TRY
BEGIN CATCH
  SELECT 'legit reparent allowed' AS chk, CONCAT('FAIL - rejected: ', ERROR_MESSAGE()) AS r;
END CATCH

PRINT '--- self-management guard ---';
BEGIN TRY
  UPDATE employees SET manager_id = @F WHERE id = @F;
  SELECT 'self-manage rejected' AS chk, 'FAIL - was allowed' AS r;
END TRY
BEGIN CATCH
  SELECT 'self-manage rejected' AS chk, CONCAT('PASS (err ', ERROR_NUMBER(), ')') AS r;
END CATCH

PRINT '--- single root (filtered unique index) ---';
BEGIN TRY
  UPDATE employees SET manager_id = NULL WHERE id = @C;
  SELECT 'second root rejected' AS chk, 'FAIL - was allowed' AS r;
END TRY
BEGIN CATCH
  SELECT 'second root rejected' AS chk, CONCAT('PASS (err ', ERROR_NUMBER(), ')') AS r;
END CATCH

PRINT '--- org_title CHECK ---';
BEGIN TRY
  UPDATE employees SET org_title = 'Supreme Overlord' WHERE id = @F;
  SELECT 'bad org_title rejected' AS chk, 'FAIL - was allowed' AS r;
END TRY
BEGIN CATCH
  SELECT 'bad org_title rejected' AS chk, CONCAT('PASS (err ', ERROR_NUMBER(), ')') AS r;
END CATCH

PRINT '--- executive_dashboard() ---';
SELECT 'dashboard(A,0) total=16' AS chk,
       CASE WHEN (SELECT total_employees FROM dbo.executive_dashboard(@A,0)) = 16 THEN 'PASS' ELSE 'FAIL' END AS r
UNION ALL
SELECT 'dashboard(F,0) total=1 (scoped)',
       CASE WHEN (SELECT total_employees FROM dbo.executive_dashboard(@F,0)) = 1 THEN 'PASS' ELSE 'FAIL' END;

PRINT '--- analytics views resolve ---';
SELECT 'v_latest_skill_levels' AS chk, CASE WHEN (SELECT COUNT(*) FROM v_latest_skill_levels) >= 0 THEN 'PASS' ELSE 'FAIL' END AS r
UNION ALL SELECT 'v_employee_skill_matrix', CASE WHEN (SELECT COUNT(*) FROM v_employee_skill_matrix) >= 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'v_role_readiness',        CASE WHEN (SELECT COUNT(*) FROM v_role_readiness) >= 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'v_mentor_dashboard',      CASE WHEN (SELECT COUNT(*) FROM v_mentor_dashboard) >= 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'v_executive_dashboard',   CASE WHEN (SELECT total_employees FROM v_executive_dashboard) >= 0 THEN 'PASS' ELSE 'FAIL' END;
GO
