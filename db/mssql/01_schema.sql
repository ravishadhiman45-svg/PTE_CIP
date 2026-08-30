-- Session options, set explicitly rather than inherited from the client.
--
-- sqlcmd defaults QUOTED_IDENTIFIER to OFF while SSMS and Azure Data Studio
-- default it ON, so a file that relies on the client's default loads in one tool
-- and fails in another. Filtered indexes (uq_employees_single_root) REQUIRE both
-- of these, and views/functions/triggers bake the options in at CREATE time — so
-- getting them right here also decides how those objects behave later.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================================
-- PTE CIP — SCHEMA (Microsoft SQL Server 2019/2022)
--
-- Ported from db/pg/01_schema.sql. Keep the two in step: the section
-- headings and table order match deliberately so a diff is meaningful.
--
-- Type mapping:
--   UUID         -> UNIQUEIDENTIFIER      DEFAULT NEWID()
--   TEXT         -> NVARCHAR(450)         (900 bytes: the widest indexable key)
--                -> NVARCHAR(MAX)         for prose columns only, which cannot be indexed
--   TIMESTAMPTZ  -> DATETIMEOFFSET        DEFAULT SYSUTCDATETIME()
--   BOOLEAN      -> BIT                   TRUE/FALSE -> 1/0
--   JSONB        -> NVARCHAR(MAX)         + an ISJSON check where it is written as JSON
--   NUMERIC(p,s) -> DECIMAL(p,s)
--
-- NEWID() is used rather than NEWSEQUENTIALID(): sequential GUIDs leak row
-- creation order, and at this data volume the index fragmentation they avoid
-- is not worth that.
-- =============================================================

-- -----------------------------------------------------------------
-- ON DELETE CASCADE downgraded to NO ACTION
--
-- SQL Server refuses a schema where a table is reachable by more than one
-- cascade path from the same ancestor, or by a self-referencing cascade.
-- Postgres allows both. Each FK below therefore drops its cascade:
--
--   mentor_assignments.mentee_id -> employees (multiple cascade paths)
--   mentor_recommendations.employee_id -> employees (multiple cascade paths)
--
-- Safe here because nothing in the API deletes an employee, skill or
-- course; the only DELETE statements target employee_skill_assignments.
-- If row deletion is ever added, these parents need explicit cleanup.
-- -----------------------------------------------------------------

IF OBJECT_ID('dbo.organizations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.organizations (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    code NVARCHAR(450) UNIQUE NOT NULL,
    name NVARCHAR(450) NOT NULL,
    description NVARCHAR(MAX),
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.locations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.locations (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    organization_id UNIQUEIDENTIFIER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code NVARCHAR(450) NOT NULL,
    name NVARCHAR(450) NOT NULL,
    city NVARCHAR(450),
    state NVARCHAR(450),
    country NVARCHAR(450) DEFAULT 'India',
    UNIQUE (organization_id, code)
  );
END
GO

IF OBJECT_ID('dbo.business_units', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.business_units (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    organization_id UNIQUEIDENTIFIER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code NVARCHAR(450) NOT NULL,
    name NVARCHAR(450) NOT NULL,
    description NVARCHAR(MAX),
    UNIQUE (organization_id, code)
  );
END
GO

IF OBJECT_ID('dbo.departments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.departments (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    business_unit_id UNIQUEIDENTIFIER NOT NULL REFERENCES business_units(id) ON DELETE CASCADE,
    code NVARCHAR(450) NOT NULL,
    name NVARCHAR(450) NOT NULL,
    description NVARCHAR(MAX),
    head_employee_id UNIQUEIDENTIFIER,
    UNIQUE (business_unit_id, code)
  );
END
GO

IF OBJECT_ID('dbo.teams', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.teams (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    department_id UNIQUEIDENTIFIER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    code NVARCHAR(450) NOT NULL,
    name NVARCHAR(450) NOT NULL,
    description NVARCHAR(MAX),
    UNIQUE (department_id, code)
  );
END
GO

IF OBJECT_ID('dbo.job_roles', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.job_roles (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    code NVARCHAR(450) UNIQUE NOT NULL,
    role_name NVARCHAR(450) NOT NULL,
    role_family NVARCHAR(450) NOT NULL,
    function_area NVARCHAR(450) NOT NULL,
    role_level NVARCHAR(450) NOT NULL,
    criticality NVARCHAR(450) NOT NULL DEFAULT 'Medium' CHECK (criticality IN ('Low','Medium','High','Critical')),
    is_future_role BIT NOT NULL DEFAULT 0,
    description NVARCHAR(MAX),
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.employees', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.employees (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    employee_code NVARCHAR(450) UNIQUE NOT NULL,
    full_name NVARCHAR(450) NOT NULL,
    email NVARCHAR(450) UNIQUE NOT NULL,
    gender NVARCHAR(450) CHECK (gender IN ('Male','Female','Other','Not Specified')) DEFAULT 'Not Specified',
    department_id UNIQUEIDENTIFIER REFERENCES departments(id),
    team_id UNIQUEIDENTIFIER REFERENCES teams(id),
    job_role_id UNIQUEIDENTIFIER REFERENCES job_roles(id),
    manager_id UNIQUEIDENTIFIER REFERENCES employees(id),
    location_id UNIQUEIDENTIFIER REFERENCES locations(id),
    grade NVARCHAR(450),
    employment_status NVARCHAR(450) NOT NULL DEFAULT 'Active' CHECK (employment_status IN ('Active','Inactive','On Leave','Separated')),
    joining_date DATE,
    photo_url NVARCHAR(450),
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.app_permission_roles', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_permission_roles (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    role_key NVARCHAR(450) UNIQUE NOT NULL,
    role_name NVARCHAR(450) NOT NULL,
    description NVARCHAR(MAX)
  );
END
GO

IF OBJECT_ID('dbo.app_users', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_users (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    employee_id UNIQUEIDENTIFIER UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
    email NVARCHAR(450) UNIQUE NOT NULL,
    display_name NVARCHAR(450) NOT NULL,
    auth_provider NVARCHAR(450) DEFAULT 'SSO',
    is_active BIT NOT NULL DEFAULT 1,
    last_login_at DATETIMEOFFSET,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.user_permission_role_map', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_permission_role_map (
    user_id UNIQUEIDENTIFIER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    permission_role_id UNIQUEIDENTIFIER NOT NULL REFERENCES app_permission_roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, permission_role_id)
  );
END
GO

IF OBJECT_ID('dbo.skill_categories', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.skill_categories (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    code NVARCHAR(450) UNIQUE NOT NULL,
    name NVARCHAR(450) NOT NULL,
    description NVARCHAR(MAX)
  );
END
GO

IF OBJECT_ID('dbo.skills', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.skills (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    code NVARCHAR(450) UNIQUE NOT NULL,
    name NVARCHAR(450) NOT NULL,
    category_id UNIQUEIDENTIFIER REFERENCES skill_categories(id),
    description NVARCHAR(MAX),
    criticality NVARCHAR(450) NOT NULL DEFAULT 'Medium' CHECK (criticality IN ('Low','Medium','High','Critical')),
    future_relevance NVARCHAR(450) NOT NULL DEFAULT 'Medium' CHECK (future_relevance IN ('Low','Medium','High','Very High')),
    owner_sme_id UNIQUEIDENTIFIER REFERENCES employees(id),
    active BIT NOT NULL DEFAULT 1,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.skill_labels', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.skill_labels (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    label_name NVARCHAR(450) UNIQUE NOT NULL,
    label_color NVARCHAR(450)
  );
END
GO

IF OBJECT_ID('dbo.skill_label_map', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.skill_label_map (
    skill_id UNIQUEIDENTIFIER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    label_id UNIQUEIDENTIFIER NOT NULL REFERENCES skill_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (skill_id, label_id)
  );
END
GO

IF OBJECT_ID('dbo.skill_level_definitions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.skill_level_definitions (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    skill_id UNIQUEIDENTIFIER REFERENCES skills(id) ON DELETE CASCADE,
    level_no INT NOT NULL CHECK (level_no BETWEEN 1 AND 5),
    level_title NVARCHAR(450) NOT NULL,
    level_definition NVARCHAR(MAX) NOT NULL,
    UNIQUE(skill_id, level_no)
  );
END
GO

IF OBJECT_ID('dbo.job_role_skill_benchmarks', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.job_role_skill_benchmarks (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    job_role_id UNIQUEIDENTIFIER NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE,
    skill_id UNIQUEIDENTIFIER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    required_level INT NOT NULL CHECK (required_level BETWEEN 1 AND 5),
    mandatory BIT NOT NULL DEFAULT 1,
    priority NVARCHAR(450) NOT NULL DEFAULT 'Core' CHECK (priority IN ('Foundation','Core','Advanced','Strategic')),
    target_year INT DEFAULT 2026,
    UNIQUE(job_role_id, skill_id)
  );
END
GO

IF OBJECT_ID('dbo.employee_skill_assignments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.employee_skill_assignments (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    skill_id UNIQUEIDENTIFIER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    assigned_by_employee_id UNIQUEIDENTIFIER REFERENCES employees(id),
    target_level INT CHECK (target_level BETWEEN 1 AND 5),
    focus_flag BIT NOT NULL DEFAULT 0,
    assigned_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    UNIQUE(employee_id, skill_id)
  );
END
GO

IF OBJECT_ID('dbo.skill_assessments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.skill_assessments (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    skill_id UNIQUEIDENTIFIER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    assessor_employee_id UNIQUEIDENTIFIER REFERENCES employees(id),
    assessor_type NVARCHAR(450) NOT NULL CHECK (assessor_type IN ('Self','Manager','Mentor','SME','System')),
    assessed_level INT NOT NULL CHECK (assessed_level BETWEEN 1 AND 5),
    confidence_level INT CHECK (confidence_level BETWEEN 1 AND 5),
    comments NVARCHAR(MAX),
    status NVARCHAR(450) NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Draft','Submitted','Approved','Rejected','Superseded')),
    assessed_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.mentor_profiles', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.mentor_profiles (
    employee_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    mentor_status NVARCHAR(450) NOT NULL DEFAULT 'Active' CHECK (mentor_status IN ('Active','Inactive','On Hold')),
    max_mentees INT DEFAULT 20,
    office_hours NVARCHAR(450),
    bio NVARCHAR(450)
  );
END
GO

IF OBJECT_ID('dbo.mentor_skill_map', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.mentor_skill_map (
    mentor_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    skill_id UNIQUEIDENTIFIER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    mentor_level INT NOT NULL CHECK (mentor_level BETWEEN 3 AND 5),
    can_certify BIT DEFAULT 0,
    PRIMARY KEY (mentor_id, skill_id)
  );
END
GO

IF OBJECT_ID('dbo.sme_profiles', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.sme_profiles (
    employee_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    expertise_summary NVARCHAR(450),
    content_development_capacity NVARCHAR(450),
    active BIT DEFAULT 1
  );
END
GO

IF OBJECT_ID('dbo.mentor_assignments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.mentor_assignments (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    mentor_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    mentee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) /* was ON DELETE CASCADE: second cascade path to employees */,
    skill_id UNIQUEIDENTIFIER REFERENCES skills(id),
    start_date DATE NOT NULL DEFAULT CAST(SYSUTCDATETIME() AS DATE),
    end_date DATE,
    status NVARCHAR(450) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Completed','Paused','Cancelled')),
    assignment_reason NVARCHAR(450),
    UNIQUE(mentor_id, mentee_id, skill_id, status)
  );
END
GO

IF OBJECT_ID('dbo.mentoring_sessions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.mentoring_sessions (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    mentor_assignment_id UNIQUEIDENTIFIER NOT NULL REFERENCES mentor_assignments(id) ON DELETE CASCADE,
    session_date DATETIMEOFFSET NOT NULL,
    mode NVARCHAR(450) CHECK (mode IN ('Office Hour','One-to-One','Workshop','Online','Project Review')),
    topic NVARCHAR(450) NOT NULL,
    notes NVARCHAR(MAX),
    action_items NVARCHAR(450),
    created_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.technical_support_requests', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.technical_support_requests (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    mentor_id UNIQUEIDENTIFIER REFERENCES employees(id),
    skill_id UNIQUEIDENTIFIER REFERENCES skills(id),
    request_title NVARCHAR(450) NOT NULL,
    request_detail NVARCHAR(450),
    priority NVARCHAR(450) DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
    status NVARCHAR(450) DEFAULT 'Open' CHECK (status IN ('Open','Assigned','In Progress','Resolved','Closed')),
    created_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME(),
    closed_at DATETIMEOFFSET
  );
END
GO

IF OBJECT_ID('dbo.training_courses', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.training_courses (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    course_code NVARCHAR(450) UNIQUE NOT NULL,
    title NVARCHAR(450) NOT NULL,
    description NVARCHAR(MAX),
    course_type NVARCHAR(450) NOT NULL CHECK (course_type IN ('Course','Workshop','Seminar','Certification','Learning Path','Webinar')),
    delivery_mode NVARCHAR(450) NOT NULL CHECK (delivery_mode IN ('ILT','Self Paced','Mixed','Online')),
    duration_hours DECIMAL(6,2),
    difficulty NVARCHAR(450) CHECK (difficulty IN ('Foundation','Intermediate','Advanced','Expert')),
    owner_sme_id UNIQUEIDENTIFIER REFERENCES employees(id),
    coordinator_id UNIQUEIDENTIFIER REFERENCES employees(id),
    linked_job_role_id UNIQUEIDENTIFIER REFERENCES job_roles(id),
    status NVARCHAR(450) DEFAULT 'Published' CHECK (status IN ('Draft','Review','Published','Retired')),
    post_training_mentoring_days INT DEFAULT 90,
    created_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.course_modules', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.course_modules (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    course_id UNIQUEIDENTIFIER NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
    module_order INT NOT NULL,
    module_title NVARCHAR(450) NOT NULL,
    module_description NVARCHAR(450),
    duration_minutes INT,
    UNIQUE(course_id, module_order)
  );
END
GO

IF OBJECT_ID('dbo.course_skill_map', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.course_skill_map (
    course_id UNIQUEIDENTIFIER NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
    skill_id UNIQUEIDENTIFIER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    target_level_after_completion INT CHECK (target_level_after_completion BETWEEN 1 AND 5),
    PRIMARY KEY(course_id, skill_id)
  );
END
GO

IF OBJECT_ID('dbo.training_enrollments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.training_enrollments (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    course_id UNIQUEIDENTIFIER NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
    employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    nominated_by UNIQUEIDENTIFIER REFERENCES employees(id),
    status NVARCHAR(450) NOT NULL DEFAULT 'Nominated' CHECK (status IN ('Nominated','Approved','In Progress','Completed','Rejected','Cancelled','Expired')),
    progress_percent INT DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    score DECIMAL(5,2),
    enrolled_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME(),
    completed_at DATETIMEOFFSET,
    UNIQUE(course_id, employee_id)
  );
END
GO

IF OBJECT_ID('dbo.learning_plan_items', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.learning_plan_items (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    course_id UNIQUEIDENTIFIER REFERENCES training_courses(id) ON DELETE SET NULL,
    assigned_by UNIQUEIDENTIFIER REFERENCES employees(id),
    status NVARCHAR(450) DEFAULT 'To Do' CHECK (status IN ('To Do','In Progress','Completed','Archived')),
    priority NVARCHAR(450) DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
    progress_percent INT DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    due_date DATE,
    started_at DATETIMEOFFSET,
    completed_at DATETIMEOFFSET,
    notes NVARCHAR(MAX)
  );
END
GO

IF OBJECT_ID('dbo.course_development_requests', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.course_development_requests (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    request_code NVARCHAR(450) UNIQUE NOT NULL,
    capability_gap_title NVARCHAR(450) NOT NULL,
    skill_id UNIQUEIDENTIFIER REFERENCES skills(id),
    source NVARCHAR(450) CHECK (source IN ('Future Skills Dashboard','Assessment Gap','Manager Request','Leadership Priority','Audit Finding','Project Need')),
    business_need NVARCHAR(450),
    status NVARCHAR(450) DEFAULT 'Need Identified' CHECK (status IN ('Need Identified','SME Assigned','Coordinator Assigned','Material Draft','SME Review','Pilot','Published','Effectiveness Review','Closed')),
    sme_id UNIQUEIDENTIFIER REFERENCES employees(id),
    coordinator_id UNIQUEIDENTIFIER REFERENCES employees(id),
    volunteer_id UNIQUEIDENTIFIER REFERENCES employees(id),
    target_launch_date DATE,
    created_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.course_development_stages', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.course_development_stages (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    request_id UNIQUEIDENTIFIER NOT NULL REFERENCES course_development_requests(id) ON DELETE CASCADE,
    stage_order INT NOT NULL,
    stage_name NVARCHAR(450) NOT NULL,
    owner_id UNIQUEIDENTIFIER REFERENCES employees(id),
    status NVARCHAR(450) DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','Completed','Delayed','Blocked')),
    due_date DATE,
    completed_at DATETIMEOFFSET,
    UNIQUE(request_id, stage_order)
  );
END
GO

IF OBJECT_ID('dbo.mentor_recommendations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.mentor_recommendations (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    mentor_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) /* was ON DELETE CASCADE: second cascade path to employees */,
    skill_id UNIQUEIDENTIFIER REFERENCES skills(id),
    recommended_level INT CHECK (recommended_level BETWEEN 1 AND 5),
    recommended_role_id UNIQUEIDENTIFIER REFERENCES job_roles(id),
    recommended_course_id UNIQUEIDENTIFIER REFERENCES training_courses(id),
    readiness NVARCHAR(450) CHECK (readiness IN ('Ready Now','Ready in 3 Months','Ready in 6 Months','Needs Foundation','Not Ready')),
    recommendation_text NVARCHAR(450),
    submitted_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME(),
    status NVARCHAR(450) DEFAULT 'Submitted' CHECK (status IN ('Draft','Submitted','Accepted','Rejected'))
  );
END
GO

IF OBJECT_ID('dbo.certifications', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.certifications (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    certification_code NVARCHAR(450) UNIQUE NOT NULL,
    title NVARCHAR(450) NOT NULL,
    description NVARCHAR(MAX),
    certification_type NVARCHAR(450) DEFAULT 'Internal' CHECK (certification_type IN ('Internal','External','Mandatory','Role Based')),
    validity_months INT,
    approver_role NVARCHAR(450),
    active BIT DEFAULT 1
  );
END
GO

IF OBJECT_ID('dbo.certification_skill_map', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.certification_skill_map (
    certification_id UNIQUEIDENTIFIER NOT NULL REFERENCES certifications(id) ON DELETE CASCADE,
    skill_id UNIQUEIDENTIFIER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    required_level INT CHECK (required_level BETWEEN 1 AND 5),
    PRIMARY KEY(certification_id, skill_id)
  );
END
GO

IF OBJECT_ID('dbo.employee_certifications', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.employee_certifications (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    certification_id UNIQUEIDENTIFIER NOT NULL REFERENCES certifications(id) ON DELETE CASCADE,
    status NVARCHAR(450) DEFAULT 'Requested' CHECK (status IN ('Requested','Approved','Denied','Expired','Renewal Due')),
    requested_date DATE,
    approved_date DATE,
    issued_date DATE,
    expiry_date DATE,
    approved_by UNIQUEIDENTIFIER REFERENCES employees(id),
    evidence_file_url NVARCHAR(450),
    comments NVARCHAR(MAX),
    UNIQUE(employee_id, certification_id, issued_date)
  );
END
GO

IF OBJECT_ID('dbo.inbox_items', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.inbox_items (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    recipient_employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    item_type NVARCHAR(450) CHECK (item_type IN ('Approval','Assessment','Training','Certification','Mentor Request','Survey','System Notice')),
    title NVARCHAR(450) NOT NULL,
    body NVARCHAR(MAX),
    related_entity_type NVARCHAR(450),
    related_entity_id UNIQUEIDENTIFIER,
    status NVARCHAR(450) DEFAULT 'Unread' CHECK (status IN ('Unread','Read','Actioned','Archived')),
    priority NVARCHAR(450) DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
    due_at DATETIMEOFFSET,
    created_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.approvals', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.approvals (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    approval_type NVARCHAR(450) CHECK (approval_type IN ('Training Nomination','Certification','Skill Level','Course Publish','Mentor Recommendation','Profile Verification')),
    requested_by UNIQUEIDENTIFIER REFERENCES employees(id),
    approver_id UNIQUEIDENTIFIER REFERENCES employees(id),
    entity_type NVARCHAR(450) NOT NULL,
    entity_id UNIQUEIDENTIFIER NOT NULL,
    status NVARCHAR(450) DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
    decision_comments NVARCHAR(450),
    requested_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME(),
    decided_at DATETIMEOFFSET
  );
END
GO

IF OBJECT_ID('dbo.audit_logs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.audit_logs (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    actor_employee_id UNIQUEIDENTIFIER REFERENCES employees(id),
    action NVARCHAR(450) NOT NULL,
    entity_type NVARCHAR(450) NOT NULL,
    entity_id UNIQUEIDENTIFIER,
    before_data NVARCHAR(MAX),
    after_data NVARCHAR(MAX),
    created_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.system_settings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.system_settings (
    setting_key NVARCHAR(450) PRIMARY KEY,
    setting_value NVARCHAR(MAX) NOT NULL,
    updated_by UNIQUEIDENTIFIER REFERENCES employees(id),
    updated_at DATETIMEOFFSET DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.employee_cv', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.employee_cv (
    employee_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    headline NVARCHAR(MAX),
    summary NVARCHAR(MAX),
    phone NVARCHAR(450),
    location_text NVARCHAR(450),
    linkedin_url NVARCHAR(450),
    verification_status NVARCHAR(450) NOT NULL DEFAULT 'Draft'
    CHECK (verification_status IN ('Draft','Pending','Verified','Rejected')),
    verified_by UNIQUEIDENTIFIER REFERENCES employees(id),
    verified_at DATETIMEOFFSET,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.employee_experience', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.employee_experience (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    title NVARCHAR(450) NOT NULL,
    organization NVARCHAR(450),
    start_date DATE,
    end_date DATE,
    description NVARCHAR(MAX),
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.employee_education', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.employee_education (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    degree NVARCHAR(450) NOT NULL,
    institution NVARCHAR(450),
    field_of_study NVARCHAR(450),
    start_year INT,
    end_year INT,
    grade NVARCHAR(450),
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

-- =============================================================
-- Deferred constraint, indexes, triggers and analytics views.
--
-- Hand-written rather than generated: each of these needed a real decision, not
-- a type substitution.
-- =============================================================

-- -----------------------------
-- Deferred FK
--
-- departments.head_employee_id points at employees, and employees.department_id
-- points back, so one direction has to be added after both tables exist.
-- Neither side cascades, so this closes a reference cycle but not a cascade one.
-- -----------------------------
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_departments_head_employee')
  ALTER TABLE dbo.departments
    ADD CONSTRAINT fk_departments_head_employee
    FOREIGN KEY (head_employee_id) REFERENCES dbo.employees(id);
GO

-- -----------------------------
-- Indexes
-- -----------------------------
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_employees_manager' AND object_id=OBJECT_ID('dbo.employees'))
  CREATE INDEX idx_employees_manager ON dbo.employees(manager_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_employees_department' AND object_id=OBJECT_ID('dbo.employees'))
  CREATE INDEX idx_employees_department ON dbo.employees(department_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_skills_category' AND object_id=OBJECT_ID('dbo.skills'))
  CREATE INDEX idx_skills_category ON dbo.skills(category_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_role_skill_job_role' AND object_id=OBJECT_ID('dbo.job_role_skill_benchmarks'))
  CREATE INDEX idx_role_skill_job_role ON dbo.job_role_skill_benchmarks(job_role_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_role_skill_skill' AND object_id=OBJECT_ID('dbo.job_role_skill_benchmarks'))
  CREATE INDEX idx_role_skill_skill ON dbo.job_role_skill_benchmarks(skill_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_skill_assessments_emp_skill' AND object_id=OBJECT_ID('dbo.skill_assessments'))
  CREATE INDEX idx_skill_assessments_emp_skill ON dbo.skill_assessments(employee_id, skill_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_mentor_assignments_mentor' AND object_id=OBJECT_ID('dbo.mentor_assignments'))
  CREATE INDEX idx_mentor_assignments_mentor ON dbo.mentor_assignments(mentor_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_mentor_assignments_mentee' AND object_id=OBJECT_ID('dbo.mentor_assignments'))
  CREATE INDEX idx_mentor_assignments_mentee ON dbo.mentor_assignments(mentee_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_training_enrollments_employee' AND object_id=OBJECT_ID('dbo.training_enrollments'))
  CREATE INDEX idx_training_enrollments_employee ON dbo.training_enrollments(employee_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_training_enrollments_course' AND object_id=OBJECT_ID('dbo.training_enrollments'))
  CREATE INDEX idx_training_enrollments_course ON dbo.training_enrollments(course_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_approvals_approver_status' AND object_id=OBJECT_ID('dbo.approvals'))
  CREATE INDEX idx_approvals_approver_status ON dbo.approvals(approver_id, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_approvals_entity' AND object_id=OBJECT_ID('dbo.approvals'))
  CREATE INDEX idx_approvals_entity ON dbo.approvals(entity_type, entity_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_employee_experience_employee' AND object_id=OBJECT_ID('dbo.employee_experience'))
  CREATE INDEX idx_employee_experience_employee ON dbo.employee_experience(employee_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_employee_education_employee' AND object_id=OBJECT_ID('dbo.employee_education'))
  CREATE INDEX idx_employee_education_employee ON dbo.employee_education(employee_id);
GO

-- -----------------------------
-- updated_at triggers
--
-- Postgres uses ONE shared BEFORE trigger function (set_updated_at) that
-- mutates NEW.updated_at in flight. T-SQL has no BEFORE trigger and no way to
-- amend the row being written, so each table needs its own AFTER trigger that
-- issues a second UPDATE joined to `inserted`.
--
-- The TRIGGER_NESTLEVEL guard is what stops that second UPDATE re-firing the
-- trigger. Direct recursion is already off by default (the RECURSIVE_TRIGGERS
-- database option), but relying on a database-level setting for correctness is
-- how this breaks quietly on someone else's server.
-- -----------------------------

CREATE OR ALTER TRIGGER dbo.trg_organizations_updated_at ON dbo.organizations AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF TRIGGER_NESTLEVEL(OBJECT_ID('dbo.trg_organizations_updated_at')) > 1 RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
    FROM dbo.organizations t JOIN inserted i ON i.id = t.id;
END
GO

CREATE OR ALTER TRIGGER dbo.trg_job_roles_updated_at ON dbo.job_roles AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF TRIGGER_NESTLEVEL(OBJECT_ID('dbo.trg_job_roles_updated_at')) > 1 RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
    FROM dbo.job_roles t JOIN inserted i ON i.id = t.id;
END
GO

CREATE OR ALTER TRIGGER dbo.trg_employees_updated_at ON dbo.employees AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF TRIGGER_NESTLEVEL(OBJECT_ID('dbo.trg_employees_updated_at')) > 1 RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
    FROM dbo.employees t JOIN inserted i ON i.id = t.id;
END
GO

CREATE OR ALTER TRIGGER dbo.trg_skills_updated_at ON dbo.skills AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF TRIGGER_NESTLEVEL(OBJECT_ID('dbo.trg_skills_updated_at')) > 1 RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
    FROM dbo.skills t JOIN inserted i ON i.id = t.id;
END
GO

CREATE OR ALTER TRIGGER dbo.trg_training_courses_updated_at ON dbo.training_courses AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF TRIGGER_NESTLEVEL(OBJECT_ID('dbo.trg_training_courses_updated_at')) > 1 RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
    FROM dbo.training_courses t JOIN inserted i ON i.id = t.id;
END
GO

-- employee_cv is keyed on employee_id, not id.
CREATE OR ALTER TRIGGER dbo.trg_employee_cv_updated_at ON dbo.employee_cv AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF TRIGGER_NESTLEVEL(OBJECT_ID('dbo.trg_employee_cv_updated_at')) > 1 RETURN;
  UPDATE t SET updated_at = SYSUTCDATETIME()
    FROM dbo.employee_cv t JOIN inserted i ON i.employee_id = t.employee_id;
END
GO

-- =============================================================
-- Analytics views
-- =============================================================

-- The most recent assessment per (employee, skill, assessor_type).
--
-- Postgres expresses this with DISTINCT ON, which keeps the first row of each
-- group under the ORDER BY. T-SQL has no DISTINCT ON, so the canonical
-- replacement is ROW_NUMBER() partitioned by the same key and filtered to 1.
--
-- The tie-break on id is not in the Postgres original: DISTINCT ON picks an
-- arbitrary row when two assessments share assessed_at, whereas this makes the
-- choice deterministic. Deliberate, but it means the two can disagree on an
-- exact timestamp tie.
CREATE OR ALTER VIEW dbo.v_latest_skill_levels AS
SELECT employee_id, skill_id, assessor_type, assessed_level, assessed_at, assessor_employee_id
FROM (
  SELECT
    employee_id, skill_id, assessor_type, assessed_level, assessed_at, assessor_employee_id,
    ROW_NUMBER() OVER (
      PARTITION BY employee_id, skill_id, assessor_type
      ORDER BY assessed_at DESC, id DESC
    ) AS rn
  FROM dbo.skill_assessments
  WHERE status IN ('Submitted','Approved')
) ranked
WHERE rn = 1;
GO

CREATE OR ALTER VIEW dbo.v_employee_skill_matrix AS
SELECT
  e.id AS employee_id,
  e.full_name AS employee_name,
  s.id AS skill_id,
  s.name AS skill_name,
  MAX(CASE WHEN l.assessor_type = 'Self' THEN l.assessed_level END) AS self_level,
  MAX(CASE WHEN l.assessor_type = 'Manager' THEN l.assessed_level END) AS manager_level,
  MAX(CASE WHEN l.assessor_type = 'Mentor' THEN l.assessed_level END) AS mentor_level,
  COALESCE(
    MAX(CASE WHEN l.assessor_type = 'Manager' THEN l.assessed_level END),
    MAX(CASE WHEN l.assessor_type = 'Self' THEN l.assessed_level END),
    0
  ) AS effective_level
FROM dbo.employees e
JOIN dbo.employee_skill_assignments esa ON esa.employee_id = e.id
JOIN dbo.skills s ON s.id = esa.skill_id
LEFT JOIN dbo.v_latest_skill_levels l ON l.employee_id = e.id AND l.skill_id = s.id
GROUP BY e.id, e.full_name, s.id, s.name;
GO

-- 100.0 forces decimal arithmetic, exactly as in the Postgres version: with an
-- integer numerator T-SQL would do integer division and every readiness figure
-- would collapse to 0 or 100.
CREATE OR ALTER VIEW dbo.v_role_readiness AS
SELECT
  e.id AS employee_id,
  e.full_name AS employee_name,
  jr.id AS job_role_id,
  jr.role_name,
  COUNT(b.skill_id) AS required_skills,
  COUNT(CASE WHEN COALESCE(m.effective_level, 0) >= b.required_level THEN 1 END) AS skills_meeting_target,
  ROUND(
    100.0 * COUNT(CASE WHEN COALESCE(m.effective_level, 0) >= b.required_level THEN 1 END)
      / NULLIF(COUNT(b.skill_id), 0), 1
  ) AS readiness_percent
FROM dbo.employees e
JOIN dbo.job_roles jr ON jr.id = e.job_role_id
JOIN dbo.job_role_skill_benchmarks b ON b.job_role_id = jr.id
LEFT JOIN dbo.v_employee_skill_matrix m ON m.employee_id = e.id AND m.skill_id = b.skill_id
GROUP BY e.id, e.full_name, jr.id, jr.role_name;
GO

-- Org-wide figures, unscoped. Kept for parity with the Postgres tree, where a
-- comment records that nothing in the API reads it any more — it was superseded
-- by executive_dashboard() in 09_scoped_analytics.sql, which scopes each
-- employee-keyed subquery to the viewer.
CREATE OR ALTER VIEW dbo.v_executive_dashboard AS
SELECT
  (SELECT COUNT(*) FROM dbo.employees WHERE employment_status = 'Active') AS total_employees,
  (SELECT COUNT(*) FROM dbo.skills WHERE active = 1) AS strategic_skills,
  (SELECT COUNT(*) FROM dbo.employee_certifications WHERE status = 'Approved') AS certified_employees,
  (SELECT COUNT(*) FROM dbo.mentor_profiles WHERE mentor_status = 'Active') AS active_mentors,
  (SELECT COUNT(*) FROM dbo.sme_profiles WHERE active = 1) AS identified_smes,
  (SELECT COUNT(*) FROM dbo.skills WHERE criticality IN ('High','Critical')) AS critical_skill_count,
  (SELECT ROUND(AVG(CAST(readiness_percent AS decimal(10,2))), 1) FROM dbo.v_role_readiness) AS average_role_readiness_percent,
  (SELECT ROUND(AVG(CAST(progress_percent AS decimal(10,2))), 1) FROM dbo.training_enrollments) AS average_training_progress_percent;
GO

-- COUNT(DISTINCT x) FILTER (WHERE p) becomes COUNT(DISTINCT CASE WHEN p THEN x END).
-- The CASE must yield x rather than 1, or the DISTINCT would collapse every
-- matching row to a single value.
CREATE OR ALTER VIEW dbo.v_mentor_dashboard AS
SELECT
  mp.employee_id AS mentor_id,
  e.full_name AS mentor_name,
  COUNT(DISTINCT CASE WHEN ma.status = 'Active' THEN ma.mentee_id END) AS active_mentees,
  COUNT(DISTINCT CASE WHEN tsr.status IN ('Open','Assigned','In Progress') THEN tsr.id END) AS open_support_requests,
  COUNT(DISTINCT CASE WHEN mr.status = 'Submitted' THEN mr.id END) AS submitted_recommendations
FROM dbo.mentor_profiles mp
JOIN dbo.employees e ON e.id = mp.employee_id
LEFT JOIN dbo.mentor_assignments ma ON ma.mentor_id = mp.employee_id
LEFT JOIN dbo.technical_support_requests tsr ON tsr.mentor_id = mp.employee_id
LEFT JOIN dbo.mentor_recommendations mr ON mr.mentor_id = mp.employee_id
GROUP BY mp.employee_id, e.full_name;
GO
