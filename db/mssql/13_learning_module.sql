-- Session options, set explicitly rather than inherited from the client.
--
-- sqlcmd defaults QUOTED_IDENTIFIER to OFF while SSMS and Azure Data Studio
-- default it ON. The filtered index at the bottom of this file REQUIRES both of
-- these, so a file that relied on the client's default would load in one tool
-- and fail in another.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================================
-- PTE CIP — LEARNING MODULE (profile tab) — SQL Server
--
-- Port of db/pg/13_learning_module.sql. Additive, idempotent.
-- Run after 01_schema.sql.
--
-- Makes employee_certifications the single list behind the profile's Learning
-- Module tab: a row either points at the internal `certifications` catalogue,
-- or is a free-form entry the employee typed in for themselves.
--
-- Note: employee_certifications CASCADEs from employees, but the storage driver
-- does not — deleting an employee leaves their certificate files behind. Same
-- pre-existing gap profile pictures have; not addressed here.
-- =============================================================

-- A free-form entry has no catalogue row to point at.
--
-- ALTER COLUMN in T-SQL restates the whole definition rather than naming the
-- property being changed, so the type has to be repeated verbatim.
IF EXISTS (SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('dbo.employee_certifications')
              AND name = 'certification_id' AND is_nullable = 0)
BEGIN
  ALTER TABLE dbo.employee_certifications ALTER COLUMN certification_id UNIQUEIDENTIFIER NULL;
END
GO

-- Everything a typed-in certificate carries. All nullable: every catalogue-
-- linked row already in the table stays valid with all of them empty.
--
-- T-SQL has no ADD COLUMN IF NOT EXISTS, so each is guarded against sys.columns.
-- NVARCHAR(450) for the short indexable strings and NVARCHAR(MAX) for prose,
-- following the type mapping in db/README.md.
IF COL_LENGTH('dbo.employee_certifications', 'title_text') IS NULL
  ALTER TABLE dbo.employee_certifications ADD title_text NVARCHAR(450);
GO
IF COL_LENGTH('dbo.employee_certifications', 'issuer') IS NULL
  ALTER TABLE dbo.employee_certifications ADD issuer NVARCHAR(450);
GO
IF COL_LENGTH('dbo.employee_certifications', 'technology') IS NULL
  ALTER TABLE dbo.employee_certifications ADD technology NVARCHAR(450);
GO
IF COL_LENGTH('dbo.employee_certifications', 'institution') IS NULL
  ALTER TABLE dbo.employee_certifications ADD institution NVARCHAR(450);
GO
IF COL_LENGTH('dbo.employee_certifications', 'credential_id') IS NULL
  ALTER TABLE dbo.employee_certifications ADD credential_id NVARCHAR(450);
GO
IF COL_LENGTH('dbo.employee_certifications', 'credential_url') IS NULL
  ALTER TABLE dbo.employee_certifications ADD credential_url NVARCHAR(450);
GO
IF COL_LENGTH('dbo.employee_certifications', 'hours') IS NULL
  ALTER TABLE dbo.employee_certifications ADD hours DECIMAL(6,2);
GO
IF COL_LENGTH('dbo.employee_certifications', 'notes') IS NULL
  ALTER TABLE dbo.employee_certifications ADD notes NVARCHAR(MAX);
GO

-- evidence_file_url (declared in 01_schema.sql, never written until now) is what
-- the browser opens. evidence_path is what the storage driver deletes — the
-- object key cannot be parsed back out of a public url once the bucket or the
-- upload directory changes, and replacing a certificate has to remove the file
-- it replaced.
IF COL_LENGTH('dbo.employee_certifications', 'evidence_path') IS NULL
  ALTER TABLE dbo.employee_certifications ADD evidence_path NVARCHAR(450);
GO
IF COL_LENGTH('dbo.employee_certifications', 'created_at') IS NULL
  ALTER TABLE dbo.employee_certifications
    ADD created_at DATETIMEOFFSET NOT NULL
        CONSTRAINT df_employee_certifications_created_at DEFAULT SYSUTCDATETIME();
GO

-- Where the row came from. 'Catalog' is the default so every row that already
-- exists keeps reading as the org-issued thing it is.
IF COL_LENGTH('dbo.employee_certifications', 'source') IS NULL
  ALTER TABLE dbo.employee_certifications
    ADD source NVARCHAR(450) NOT NULL
        CONSTRAINT df_employee_certifications_source DEFAULT 'Catalog';
GO

IF OBJECT_ID('dbo.employee_certifications_source_check', 'C') IS NOT NULL
  ALTER TABLE dbo.employee_certifications DROP CONSTRAINT employee_certifications_source_check;
GO
ALTER TABLE dbo.employee_certifications ADD CONSTRAINT employee_certifications_source_check
  CHECK (source IN ('Catalog','Self'));
GO

-- 'Self-Reported' joins the status list, and is deliberately NOT 'Approved':
-- v_executive_dashboard (01_schema.sql) and dbo.executive_dashboard()
-- (09_scoped_analytics.sql) both count status='Approved' as "certified
-- employees", and a self-typed row must not inflate that.
--
-- The original CHECK was declared inline in 01_schema.sql, so SQL Server named
-- it itself. Look the name up rather than guessing it.
DECLARE @status_check SYSNAME = (
  SELECT TOP 1 c.name
    FROM sys.check_constraints c
    JOIN sys.columns col ON col.object_id = c.parent_object_id
                        AND col.column_id = c.parent_column_id
   WHERE c.parent_object_id = OBJECT_ID('dbo.employee_certifications')
     AND col.name = 'status');
IF @status_check IS NOT NULL
  EXEC('ALTER TABLE dbo.employee_certifications DROP CONSTRAINT ' + @status_check);
GO
ALTER TABLE dbo.employee_certifications ADD CONSTRAINT employee_certifications_status_check
  CHECK (status IN ('Requested','Approved','Denied','Expired','Renewal Due','Self-Reported'));
GO

-- A row has to be identifiable as something. LTRIM(RTRIM(...)) rather than
-- btrim, which T-SQL does not have (TRIM exists from 2017 but the two-call form
-- also works on 2016).
IF OBJECT_ID('dbo.employee_certifications_titled_check', 'C') IS NOT NULL
  ALTER TABLE dbo.employee_certifications DROP CONSTRAINT employee_certifications_titled_check;
GO
ALTER TABLE dbo.employee_certifications ADD CONSTRAINT employee_certifications_titled_check
  CHECK (certification_id IS NOT NULL OR LTRIM(RTRIM(COALESCE(title_text,''))) <> '');
GO

-- ---------------------------------------------------------------
-- The one place this port is NOT a transcription of the Postgres file.
--
-- db/pg/13 leaves UNIQUE(employee_id, certification_id, issued_date) alone and
-- says so explicitly: "NULLs are distinct in a Postgres unique index, so
-- free-form rows never trip it".
--
-- That reasoning does not carry over. SQL Server's UNIQUE treats NULLs as EQUAL,
-- so the constraint 01_schema.sql declared would allow a person exactly ONE
-- self-reported certificate — the second one, also (NULL, NULL), collides with
-- the first and the route returns 409 "already on this profile".
--
-- So the constraint is replaced by a filtered unique index that only covers
-- catalogue rows. It still stops the approvals flow issuing the same catalogue
-- certification twice on one date, which is all the original was for, and
-- free-form rows are left outside the index entirely.
-- ---------------------------------------------------------------
DECLARE @uq SYSNAME = (
  SELECT TOP 1 kc.name
    FROM sys.key_constraints kc
   WHERE kc.parent_object_id = OBJECT_ID('dbo.employee_certifications')
     AND kc.type = 'UQ');
IF @uq IS NOT NULL
  EXEC('ALTER TABLE dbo.employee_certifications DROP CONSTRAINT ' + @uq);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'uq_employee_certifications_catalog'
                  AND object_id = OBJECT_ID('dbo.employee_certifications'))
  CREATE UNIQUE INDEX uq_employee_certifications_catalog
    ON dbo.employee_certifications(employee_id, certification_id, issued_date)
    WHERE certification_id IS NOT NULL AND issued_date IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'idx_employee_certifications_employee'
                  AND object_id = OBJECT_ID('dbo.employee_certifications'))
  CREATE INDEX idx_employee_certifications_employee
    ON dbo.employee_certifications(employee_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'idx_employee_certifications_expiry'
                  AND object_id = OBJECT_ID('dbo.employee_certifications'))
  CREATE INDEX idx_employee_certifications_expiry
    ON dbo.employee_certifications(expiry_date)
    WHERE expiry_date IS NOT NULL;
GO
