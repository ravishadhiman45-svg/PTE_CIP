-- =============================================================
-- PTE CIP PROXY SEED DATA
-- This file populates a complete demo dataset for PTE CIP.
-- Run after 01_schema.sql.
-- =============================================================

BEGIN;

-- Organization and structure
INSERT INTO organizations (id, code, name, description) VALUES
('00000000-0000-0000-0000-000000000001','MSIL-PTE','PTE Capability Organization','Proxy organization for Powertrain Engineering capability management demo')
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations (id, organization_id, code, name, city, state) VALUES
('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','GUR-RD','R&D Campus Gurugram','Gurugram','Haryana'),
('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','ROH-PLANT','Rohtak Test Center','Rohtak','Haryana')
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO business_units (id, organization_id, code, name, description) VALUES
('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000001','PTE','Powertrain Engineering','Powertrain engineering functions covering ICE, hybrid, EV, testing, quality and validation')
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO departments (id, business_unit_id, code, name, description) VALUES
('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','PTQ','Powertrain Quality','Problem solving, field quality, diagnostics and warranty analytics'),
('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000201','ED','Engine Design','Engine, transmission and mechanical system design'),
('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000201','EVS','EV Systems','EV powertrain, battery, controls and safety'),
('00000000-0000-0000-0000-000000000304','00000000-0000-0000-0000-000000000201','BAT','Battery Systems','Battery technology, SOH, warranty and BMS interface'),
('00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000201','VNT','Validation & Testing','Bench, vehicle, durability, NVH and system validation'),
('00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000201','LND','Capability Development Cell','Central training, learning operations and capability governance')
ON CONFLICT (business_unit_id, code) DO NOTHING;

INSERT INTO teams (id, department_id, code, name) VALUES
('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000301','PTQ-DIAG','Diagnostics & Issue Resolution'),
('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000302','ED-TRN','Transmission Systems'),
('00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000303','EVS-VAL','EV Validation'),
('00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-000000000304','BAT-SOH','Battery SOH Analytics'),
('00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000305','VNT-BENCH','Bench & Vehicle Testing'),
('00000000-0000-0000-0000-000000000406','00000000-0000-0000-0000-000000000306','LND-OPS','Learning Operations')
ON CONFLICT (department_id, code) DO NOTHING;

-- Job roles
INSERT INTO job_roles (id, code, role_name, role_family, function_area, role_level, criticality, is_future_role, description) VALUES
('00000000-0000-0000-0000-000000000501','EXEC-DIR','Executive Director','Leadership','Powertrain','Executive','Critical',false,'Leadership view for strategic capability planning'),
('00000000-0000-0000-0000-000000000502','HEAD-PTE','Head, Powertrain','Leadership','Powertrain','Senior Leadership','Critical',false,'Functional head for powertrain engineering capability'),
('00000000-0000-0000-0000-000000000503','PT-QUALITY-ENG','Powertrain Quality Engineer','Engineering','Quality','Engineer','High',false,'Issue resolution, warranty analysis and field quality improvement'),
('00000000-0000-0000-0000-000000000504','EV-VAL-ENG','EV Systems Validation Engineer','Engineering','EV Systems','Engineer','Critical',true,'Validates EV system performance, safety, durability and compliance'),
('00000000-0000-0000-0000-000000000505','BAT-SOH-ANL','Battery SOH Analyst','Engineering','Battery','Engineer','Critical',true,'Analyzes battery state of health, warranty patterns and ageing signatures'),
('00000000-0000-0000-0000-000000000506','CTRL-ENG','Controls Engineer','Engineering','Controls','Engineer','Critical',true,'Works on ECU, CAN/LIN, diagnostics and control logic validation'),
('00000000-0000-0000-0000-000000000507','THERMAL-ENG','Thermal Systems Engineer','Engineering','Thermal','Engineer','High',true,'Thermal modelling, simulation and thermal validation'),
('00000000-0000-0000-0000-000000000508','DIAG-ENG','Diagnostics Engineer','Engineering','Diagnostics','Engineer','High',true,'OBD, DTC, fault tree, ECU diagnostics and vehicle network troubleshooting'),
('00000000-0000-0000-0000-000000000509','PROJECT-LEAD','Project Lead','Program Management','Powertrain','Manager','High',false,'Cross-functional delivery, milestone tracking and stakeholder management'),
('00000000-0000-0000-0000-000000000510','LND-COORD','Training Coordinator','Capability Development','Learning','Coordinator','High',false,'Coordinates SME-led course creation, training delivery and tracking'),
('00000000-0000-0000-0000-000000000511','SME-MENTOR','Powertrain Capability Mentor','Capability Development','Mentoring','Expert','Critical',false,'Mentors employees, validates skill levels and supports project application')
ON CONFLICT (code) DO NOTHING;

-- Employees
INSERT INTO employees (id, employee_code, full_name, email, gender, department_id, team_id, job_role_id, location_id, grade, joining_date, employment_status) VALUES
('00000000-0000-0000-0000-000000000601','PTE0001','Rahul Sharma','rahul.sharma@ptecip.local','Male','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000101','ED','2010-04-01','Active'),
('00000000-0000-0000-0000-000000000602','PTE0002','Neha Verma','neha.verma@ptecip.local','Female','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000101','DGM','2011-06-15','Active'),
('00000000-0000-0000-0000-000000000603','PTE0003','Shalini Srivastava','shalini.srivastava@ptecip.local','Female','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000000101','GM','2012-01-12','Active'),
('00000000-0000-0000-0000-000000000604','PTE0004','Gurpreet Singh','gurpreet.singh@ptecip.local','Male','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000511','00000000-0000-0000-0000-000000000101','DGM','2013-09-20','Active'),
('00000000-0000-0000-0000-000000000605','PTE0005','Zoya Bhat','zoya.bhat@ptecip.local','Female','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000508','00000000-0000-0000-0000-000000000101','Manager','2016-08-05','Active'),
('00000000-0000-0000-0000-000000000606','PTE0006','Abhishek Tiwari','abhishek.tiwari@ptecip.local','Male','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000506','00000000-0000-0000-0000-000000000101','DGM','2014-03-03','Active'),
('00000000-0000-0000-0000-000000000607','PTE0007','Moumita Bose','moumita.bose@ptecip.local','Female','00000000-0000-0000-0000-000000000304','00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-000000000505','00000000-0000-0000-0000-000000000101','Manager','2015-10-10','Active'),
('00000000-0000-0000-0000-000000000608','PTE0008','Aamir Lone','aamir.lone@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000507','00000000-0000-0000-0000-000000000102','Manager','2017-05-18','Active'),
('00000000-0000-0000-0000-000000000609','PTE0009','Mahendra Rathore','mahendra.rathore@ptecip.local','Male','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000507','00000000-0000-0000-0000-000000000101','Manager','2016-02-11','Active'),
('00000000-0000-0000-0000-000000000610','PTE0010','Nidhi Tripathi','nidhi.tripathi@ptecip.local','Female','00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000406','00000000-0000-0000-0000-000000000510','00000000-0000-0000-0000-000000000101','Manager','2018-07-09','Active'),
('00000000-0000-0000-0000-000000000611','PTE0011','Jasleen Kaur','jasleen.kaur@ptecip.local','Female','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000000101','AM','2020-02-10','Active'),
('00000000-0000-0000-0000-000000000612','PTE0012','Riya Mukherjee','riya.mukherjee@ptecip.local','Female','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000508','00000000-0000-0000-0000-000000000101','AM','2021-05-12','Active'),
('00000000-0000-0000-0000-000000000613','PTE0013','Vivek Mishra','vivek.mishra@ptecip.local','Male','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000101','DM','2019-11-03','Active'),
('00000000-0000-0000-0000-000000000614','PTE0014','Anirban Chatterjee','anirban.chatterjee@ptecip.local','Male','00000000-0000-0000-0000-000000000304','00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-000000000505','00000000-0000-0000-0000-000000000101','DM','2020-08-25','Active'),
('00000000-0000-0000-0000-000000000615','PTE0015','Ritu Saxena','ritu.saxena@ptecip.local','Female','00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000406','00000000-0000-0000-0000-000000000510','00000000-0000-0000-0000-000000000101','AM','2022-01-17','Active'),
('00000000-0000-0000-0000-000000000616','PTE0016','Meenakshi Shekhawat','meenakshi.shekhawat@ptecip.local','Female','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000101','DM','2019-04-22','Active'),
('00000000-0000-0000-0000-000000000617','PTE0017','Harmeet Sandhu','harmeet.sandhu@ptecip.local','Male','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000102','AM','2021-12-06','Active'),
('00000000-0000-0000-0000-000000000618','PTE0018','Kavita Purohit','kavita.purohit@ptecip.local','Female','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000000102','AM','2022-06-13','Active'),
('00000000-0000-0000-0000-000000000619','PTE0019','Irfan Mir','irfan.mir@ptecip.local','Male','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000506','00000000-0000-0000-0000-000000000101','DM','2018-09-14','Active'),
('00000000-0000-0000-0000-000000000620','PTE0020','Pooja Bansal','pooja.bansal@ptecip.local','Female','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000000101','AM','2021-03-30','Active')
ON CONFLICT (employee_code) DO NOTHING;

-- Managers and department heads
UPDATE employees SET manager_id='00000000-0000-0000-0000-000000000601' WHERE id IN ('00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000603');
UPDATE employees SET manager_id='00000000-0000-0000-0000-000000000602' WHERE id IN ('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000606','00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000000620');
UPDATE employees SET manager_id='00000000-0000-0000-0000-000000000603' WHERE id IN ('00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000000612','00000000-0000-0000-0000-000000000613','00000000-0000-0000-0000-000000000619');
UPDATE employees SET manager_id='00000000-0000-0000-0000-000000000607' WHERE id='00000000-0000-0000-0000-000000000614';
UPDATE employees SET manager_id='00000000-0000-0000-0000-000000000609' WHERE id='00000000-0000-0000-0000-000000000616';
UPDATE employees SET manager_id='00000000-0000-0000-0000-000000000608' WHERE id IN ('00000000-0000-0000-0000-000000000617','00000000-0000-0000-0000-000000000618');
UPDATE employees SET manager_id='00000000-0000-0000-0000-000000000610' WHERE id='00000000-0000-0000-0000-000000000615';

UPDATE departments SET head_employee_id='00000000-0000-0000-0000-000000000603' WHERE id='00000000-0000-0000-0000-000000000301';
UPDATE departments SET head_employee_id='00000000-0000-0000-0000-000000000609' WHERE id='00000000-0000-0000-0000-000000000302';
UPDATE departments SET head_employee_id='00000000-0000-0000-0000-000000000602' WHERE id='00000000-0000-0000-0000-000000000303';
UPDATE departments SET head_employee_id='00000000-0000-0000-0000-000000000607' WHERE id='00000000-0000-0000-0000-000000000304';
UPDATE departments SET head_employee_id='00000000-0000-0000-0000-000000000608' WHERE id='00000000-0000-0000-0000-000000000305';
UPDATE departments SET head_employee_id='00000000-0000-0000-0000-000000000610' WHERE id='00000000-0000-0000-0000-000000000306';

-- Permission roles and users
INSERT INTO app_permission_roles (id, role_key, role_name, description) VALUES
('00000000-0000-0000-0000-000000000701','admin','Admin','Full platform administration'),
('00000000-0000-0000-0000-000000000702','executive','Executive Viewer','Leadership dashboard and analytics'),
('00000000-0000-0000-0000-000000000703','department_head','Department Head','Department capability governance'),
('00000000-0000-0000-0000-000000000704','manager','Manager','Team assessment and approvals'),
('00000000-0000-0000-0000-000000000705','employee','Employee','Personal skill passport and learning plan'),
('00000000-0000-0000-0000-000000000706','mentor','Mentor','Mentoring and validation workflow'),
('00000000-0000-0000-0000-000000000707','sme','SME','Content ownership and advanced skill validation'),
('00000000-0000-0000-0000-000000000708','training_coordinator','Training Coordinator','Course development and rollout operations')
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO app_users (id, employee_id, email, display_name, last_login_at)
SELECT gen_random_uuid(), id, email, full_name, NOW() - INTERVAL '2 days' FROM employees
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id FROM app_users au JOIN app_permission_roles pr ON pr.role_key='employee'
ON CONFLICT DO NOTHING;
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id FROM app_users au JOIN employees e ON e.id=au.employee_id JOIN app_permission_roles pr ON pr.role_key='manager'
WHERE e.id IN ('00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000603','00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000000608','00000000-0000-0000-0000-000000000609','00000000-0000-0000-0000-000000000610')
ON CONFLICT DO NOTHING;
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id FROM app_users au JOIN employees e ON e.id=au.employee_id JOIN app_permission_roles pr ON pr.role_key='executive'
WHERE e.id='00000000-0000-0000-0000-000000000601'
ON CONFLICT DO NOTHING;
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id FROM app_users au JOIN employees e ON e.id=au.employee_id JOIN app_permission_roles pr ON pr.role_key='admin'
WHERE e.id='00000000-0000-0000-0000-000000000610'
ON CONFLICT DO NOTHING;

-- Extra persona role mappings (dept head, mentor, sme, coordinator) for richer role-based UI
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id FROM app_users au JOIN employees e ON e.id=au.employee_id JOIN app_permission_roles pr ON pr.role_key='department_head'
WHERE e.id='00000000-0000-0000-0000-000000000602'
ON CONFLICT DO NOTHING;
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id FROM app_users au JOIN employees e ON e.id=au.employee_id JOIN app_permission_roles pr ON pr.role_key='mentor'
WHERE e.id IN ('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000000606','00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000000608','00000000-0000-0000-0000-000000000609')
ON CONFLICT DO NOTHING;
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id FROM app_users au JOIN employees e ON e.id=au.employee_id JOIN app_permission_roles pr ON pr.role_key='sme'
WHERE e.id IN ('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000000606','00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000000608','00000000-0000-0000-0000-000000000609')
ON CONFLICT DO NOTHING;
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id FROM app_users au JOIN employees e ON e.id=au.employee_id JOIN app_permission_roles pr ON pr.role_key='training_coordinator'
WHERE e.id IN ('00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000615')
ON CONFLICT DO NOTHING;

-- Skill categories and skills
INSERT INTO skill_categories (id, code, name, description) VALUES
('00000000-0000-0000-0000-000000000901','MECH','Mechanical Engineering','Mechanical powertrain fundamentals'),
('00000000-0000-0000-0000-000000000902','ELEC','Automotive Electronics','Electronics, sensors, actuators and ECU architecture'),
('00000000-0000-0000-0000-000000000903','CTRL','Controls & Communication','Control logic and vehicle networks'),
('00000000-0000-0000-0000-000000000904','EV','EV & Hybrid Systems','EV, hybrid and electrified powertrain systems'),
('00000000-0000-0000-0000-000000000905','BAT','Battery Systems','Battery technology and analytics'),
('00000000-0000-0000-0000-000000000906','THERM','Thermal & NVH','Thermal, cooling, NVH and durability'),
('00000000-0000-0000-0000-000000000907','DIAG','Diagnostics & OBD','Diagnostics, OBD, DTC and issue resolution'),
('00000000-0000-0000-0000-000000000908','DATA','Data Analytics','Data analysis, modelling and prediction'),
('00000000-0000-0000-0000-000000000909','SAFE','Safety & Cybersecurity','Functional safety, HV safety and cybersecurity'),
('00000000-0000-0000-0000-000000000910','PM','Project & Leadership','Project management, planning and mentoring')
ON CONFLICT (code) DO NOTHING;

INSERT INTO skills (id, code, name, category_id, description, criticality, future_relevance, owner_sme_id) VALUES
('00000000-0000-0000-0000-000000001001','ECU-BASICS','Automotive Electronics Fundamentals','00000000-0000-0000-0000-000000000902','Basic electronics, sensors, actuators and ECU architecture','Critical','Very High','00000000-0000-0000-0000-000000000606'),
('00000000-0000-0000-0000-000000001002','CAN-LIN','CAN / LIN Communication','00000000-0000-0000-0000-000000000903','Vehicle network communication protocols, message frames, diagnostics, DBC, signal flow and network validation','Critical','Very High','00000000-0000-0000-0000-000000000604'),
('00000000-0000-0000-0000-000000001003','BAT-SOH','Battery SOH Analysis','00000000-0000-0000-0000-000000000905','State-of-health estimation and warranty analytics','Critical','Very High','00000000-0000-0000-0000-000000000607'),
('00000000-0000-0000-0000-000000001004','CLUTCH-THERM','Clutch Thermal Modeling','00000000-0000-0000-0000-000000000906','Thermal model development for clutch abuse and wear prediction','High','High','00000000-0000-0000-0000-000000000609'),
('00000000-0000-0000-0000-000000001005','EV-SYS','EV Powertrain Systems','00000000-0000-0000-0000-000000000904','EV architecture, e-axle, inverter, motor and system interface','Critical','Very High','00000000-0000-0000-0000-000000000602'),
('00000000-0000-0000-0000-000000001006','HYBRID-SYS','Hybrid Powertrain Architecture','00000000-0000-0000-0000-000000000904','Hybrid modes, energy flow, engine-motor interaction and validation needs','Critical','Very High','00000000-0000-0000-0000-000000000608'),
('00000000-0000-0000-0000-000000001007','DIAG-OBD','Diagnostics & OBD','00000000-0000-0000-0000-000000000907','DTC, OBD, fault isolation, diagnostic flow and service validation','High','High','00000000-0000-0000-0000-000000000605'),
('00000000-0000-0000-0000-000000001008','THERMAL-MGMT','Thermal Management','00000000-0000-0000-0000-000000000906','Cooling systems, thermal targets, transient loads and validation','High','Very High','00000000-0000-0000-0000-000000000609'),
('00000000-0000-0000-0000-000000001009','DATA-ANALYTICS','Data Analytics for Warranty','00000000-0000-0000-0000-000000000908','Trend analysis, anomaly detection and warranty data interpretation','High','Very High','00000000-0000-0000-0000-000000000607'),
('00000000-0000-0000-0000-000000001010','FUNC-SAFETY','Functional Safety Awareness','00000000-0000-0000-0000-000000000909','Functional safety concepts, hazards, ASIL awareness and safety case basics','Critical','Very High','00000000-0000-0000-0000-000000000605'),
('00000000-0000-0000-0000-000000001011','EV-SAFETY','EV Safety Level 1','00000000-0000-0000-0000-000000000909','HV safety, safe handling, isolation and emergency protocols','Critical','Very High','00000000-0000-0000-0000-000000000605'),
('00000000-0000-0000-0000-000000001012','NVH','Powertrain NVH Basics','00000000-0000-0000-0000-000000000906','Noise, vibration, harshness measurement and root cause analysis','Medium','High','00000000-0000-0000-0000-000000000608'),
('00000000-0000-0000-0000-000000001013','MBD','Model-Based Development','00000000-0000-0000-0000-000000000903','Model-based design, Simulink concepts, validation and code generation awareness','High','Very High','00000000-0000-0000-0000-000000000606'),
('00000000-0000-0000-0000-000000001014','CYBER-BASICS','Automotive Cybersecurity Basics','00000000-0000-0000-0000-000000000909','Cybersecurity awareness for connected vehicle systems','High','Very High','00000000-0000-0000-0000-000000000606'),
('00000000-0000-0000-0000-000000001015','PROJ-MGMT','Project Management','00000000-0000-0000-0000-000000000910','Planning, execution, milestone control and stakeholder alignment','High','High','00000000-0000-0000-0000-000000000603')
ON CONFLICT (code) DO NOTHING;

INSERT INTO skill_labels (id, label_name, label_color) VALUES
('00000000-0000-0000-0000-000000001101','Foundation','#3B82F6'),
('00000000-0000-0000-0000-000000001102','EV','#10B981'),
('00000000-0000-0000-0000-000000001103','Controls','#06B6D4'),
('00000000-0000-0000-0000-000000001104','Battery','#22C55E'),
('00000000-0000-0000-0000-000000001105','Diagnostics','#F59E0B'),
('00000000-0000-0000-0000-000000001106','Simulation','#8B5CF6'),
('00000000-0000-0000-0000-000000001107','Data','#A855F7'),
('00000000-0000-0000-0000-000000001108','Safety','#EF4444'),
('00000000-0000-0000-0000-000000001109','Future Critical','#F97316')
ON CONFLICT (label_name) DO NOTHING;

INSERT INTO skill_label_map (skill_id, label_id) VALUES
('00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000001101'),
('00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000001103'),
('00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000001103'),
('00000000-0000-0000-0000-000000001003','00000000-0000-0000-0000-000000001104'),
('00000000-0000-0000-0000-000000001003','00000000-0000-0000-0000-000000001107'),
('00000000-0000-0000-0000-000000001004','00000000-0000-0000-0000-000000001106'),
('00000000-0000-0000-0000-000000001005','00000000-0000-0000-0000-000000001102'),
('00000000-0000-0000-0000-000000001006','00000000-0000-0000-0000-000000001102'),
('00000000-0000-0000-0000-000000001007','00000000-0000-0000-0000-000000001105'),
('00000000-0000-0000-0000-000000001010','00000000-0000-0000-0000-000000001108'),
('00000000-0000-0000-0000-000000001014','00000000-0000-0000-0000-000000001109')
ON CONFLICT DO NOTHING;

-- Generic level definitions for every skill
INSERT INTO skill_level_definitions (skill_id, level_no, level_title, level_definition)
SELECT s.id, v.level_no, v.level_title, v.level_definition
FROM skills s
CROSS JOIN (VALUES
(1,'Awareness','Understands basic terminology, purpose and safety precautions.'),
(2,'Working Knowledge','Can explain concepts and perform simple tasks with guidance.'),
(3,'Practitioner','Can apply the skill independently in regular projects.'),
(4,'Advanced Practitioner','Can solve complex issues, guide others and validate outputs.'),
(5,'Expert / SME','Can define standards, mentor others, create training and approve capability.')
) AS v(level_no, level_title, level_definition)
ON CONFLICT (skill_id, level_no) DO NOTHING;

-- Role benchmarks
INSERT INTO job_role_skill_benchmarks (job_role_id, skill_id, required_level, mandatory, priority, target_year) VALUES
('00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000001005',4,true,'Strategic',2026),
('00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000001011',3,true,'Core',2026),
('00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000001008',3,true,'Core',2026),
('00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000001010',3,true,'Core',2026),
('00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000001007',3,true,'Core',2026),
('00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000001009',2,true,'Foundation',2026),
('00000000-0000-0000-0000-000000000506','00000000-0000-0000-0000-000000001001',4,true,'Core',2026),
('00000000-0000-0000-0000-000000000506','00000000-0000-0000-0000-000000001002',4,true,'Strategic',2026),
('00000000-0000-0000-0000-000000000506','00000000-0000-0000-0000-000000001013',3,true,'Core',2026),
('00000000-0000-0000-0000-000000000506','00000000-0000-0000-0000-000000001014',2,true,'Foundation',2028),
('00000000-0000-0000-0000-000000000505','00000000-0000-0000-0000-000000001003',4,true,'Strategic',2026),
('00000000-0000-0000-0000-000000000505','00000000-0000-0000-0000-000000001009',4,true,'Core',2026),
('00000000-0000-0000-0000-000000000505','00000000-0000-0000-0000-000000001005',3,true,'Core',2026),
('00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000001007',4,true,'Core',2026),
('00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000001009',3,true,'Core',2026),
('00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000001001',2,true,'Foundation',2026),
('00000000-0000-0000-0000-000000000507','00000000-0000-0000-0000-000000001008',4,true,'Strategic',2026),
('00000000-0000-0000-0000-000000000507','00000000-0000-0000-0000-000000001004',4,true,'Core',2026),
('00000000-0000-0000-0000-000000000508','00000000-0000-0000-0000-000000001002',4,true,'Core',2026),
('00000000-0000-0000-0000-000000000508','00000000-0000-0000-0000-000000001007',4,true,'Strategic',2026),
('00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000001015',4,true,'Core',2026)
ON CONFLICT (job_role_id, skill_id) DO NOTHING;

-- Employee skill assignments for active demo users
INSERT INTO employee_skill_assignments (employee_id, skill_id, assigned_by_employee_id, target_level, focus_flag)
SELECT e.id, s.id, COALESCE(e.manager_id,'00000000-0000-0000-0000-000000000603'), 3, false
FROM employees e CROSS JOIN skills s
WHERE e.id IN ('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000000612','00000000-0000-0000-0000-000000000613','00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000000618','00000000-0000-0000-0000-000000000620')
  AND s.id IN ('00000000-0000-0000-0000-000000001001','00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000001003','00000000-0000-0000-0000-000000001005','00000000-0000-0000-0000-000000001007','00000000-0000-0000-0000-000000001008','00000000-0000-0000-0000-000000001010','00000000-0000-0000-0000-000000001011')
ON CONFLICT (employee_id, skill_id) DO NOTHING;

-- Mentors, SMEs and coordinators
INSERT INTO mentor_profiles (employee_id, mentor_status, max_mentees, office_hours, bio) VALUES
('00000000-0000-0000-0000-000000000604','Active',25,'Tue 4 PM - 5 PM','Mentor for CAN, LIN, vehicle networks and EV validation.'),
('00000000-0000-0000-0000-000000000605','Active',20,'Thu 3 PM - 4 PM','Mentor for diagnostics, OBD and EV safety.'),
('00000000-0000-0000-0000-000000000606','Active',18,'Wed 5 PM - 6 PM','Mentor for automotive electronics, controls and MBD.'),
('00000000-0000-0000-0000-000000000607','Active',18,'Fri 3 PM - 4 PM','Mentor for battery SOH, warranty analytics and data interpretation.'),
('00000000-0000-0000-0000-000000000608','Active',15,'Mon 4 PM - 5 PM','Mentor for hybrid systems, thermal and NVH.'),
('00000000-0000-0000-0000-000000000609','Active',15,'Wed 3 PM - 4 PM','Mentor for thermal modeling and clutch thermal systems.')
ON CONFLICT (employee_id) DO NOTHING;

INSERT INTO sme_profiles (employee_id, expertise_summary, content_development_capacity) VALUES
('00000000-0000-0000-0000-000000000604','CAN/LIN communication, network validation and vehicle diagnostics','2 courses per quarter'),
('00000000-0000-0000-0000-000000000605','Diagnostics, OBD, EV safety and functional safety awareness','2 courses per quarter'),
('00000000-0000-0000-0000-000000000606','Automotive electronics, ECU basics, MBD and cybersecurity basics','2 courses per quarter'),
('00000000-0000-0000-0000-000000000607','Battery SOH analysis, warranty data analytics and ageing analysis','1 advanced course per quarter'),
('00000000-0000-0000-0000-000000000608','Hybrid powertrain architecture and thermal validation','1 course per quarter'),
('00000000-0000-0000-0000-000000000609','Clutch thermal modeling and thermal management','1 course per quarter')
ON CONFLICT (employee_id) DO NOTHING;

INSERT INTO mentor_skill_map (mentor_id, skill_id, mentor_level, can_certify) VALUES
('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000001002',5,true),
('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000001005',4,false),
('00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000001007',5,true),
('00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000001011',4,true),
('00000000-0000-0000-0000-000000000606','00000000-0000-0000-0000-000000001001',5,true),
('00000000-0000-0000-0000-000000000606','00000000-0000-0000-0000-000000001013',4,false),
('00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000001003',5,true),
('00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000001009',5,false),
('00000000-0000-0000-0000-000000000608','00000000-0000-0000-0000-000000001006',5,true),
('00000000-0000-0000-0000-000000000609','00000000-0000-0000-0000-000000001004',5,true),
('00000000-0000-0000-0000-000000000609','00000000-0000-0000-0000-000000001008',4,false)
ON CONFLICT DO NOTHING;

-- Training courses
INSERT INTO training_courses (id, course_code, title, description, course_type, delivery_mode, duration_hours, difficulty, owner_sme_id, coordinator_id, linked_job_role_id, status, post_training_mentoring_days) VALUES
('00000000-0000-0000-0000-000000002001','TRN-ECU-FND','Automotive Electronics Fundamentals','Foundation course for mechanical engineers covering sensors, actuators, ECU architecture and signal flow.','Course','ILT',3,'Foundation','00000000-0000-0000-0000-000000000606','00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000506','Published',90),
('00000000-0000-0000-0000-000000002002','TRN-CAN-LIN','CAN / LIN Practical Diagnostics','Hands-on workshop for CAN/LIN messages, DBC, signal interpretation and network fault diagnosis.','Workshop','ILT',8,'Intermediate','00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000508','Published',90),
('00000000-0000-0000-0000-000000002003','TRN-BAT-SOH','Battery SOH & Warranty Analytics','Advanced program on SOH trends, ageing indicators, warranty data and analytics workflow.','Course','ILT',16,'Advanced','00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000000615','00000000-0000-0000-0000-000000000505','Published',120),
('00000000-0000-0000-0000-000000002004','TRN-HYB-ARCH','Hybrid Powertrain Architecture','Overview of hybrid modes, system layout, engine-motor interaction and validation considerations.','Seminar','ILT',4,'Foundation','00000000-0000-0000-0000-000000000608','00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000504','Published',60),
('00000000-0000-0000-0000-000000002005','CRT-EV-SAFE-L1','EV Safety Level 1','Mandatory EV high-voltage safety certification.','Certification','Mixed',2,'Foundation','00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000504','Published',90),
('00000000-0000-0000-0000-000000002006','TRN-THERM-BASIC','Thermal Management Basics','Fundamentals of cooling, heat flow, thermal targets and validation.','Course','Self Paced',4,'Foundation','00000000-0000-0000-0000-000000000609','00000000-0000-0000-0000-000000000615','00000000-0000-0000-0000-000000000507','Published',60),
('00000000-0000-0000-0000-000000002007','TRN-MBD-BASIC','Model-Based Development Basics','Introduction to model-based development, simulations and validation flow.','Course','Online',6,'Intermediate','00000000-0000-0000-0000-000000000606','00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000506','Published',90),
('00000000-0000-0000-0000-000000002008','TRN-FS-AWARE','Functional Safety Awareness','Awareness program on functional safety concepts and role-level responsibility.','Webinar','Online',2,'Foundation','00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000504','Published',60)
ON CONFLICT (course_code) DO NOTHING;

INSERT INTO course_skill_map (course_id, skill_id, target_level_after_completion) VALUES
('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000001001',2),
('00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000001002',3),
('00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000001003',3),
('00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000001009',3),
('00000000-0000-0000-0000-000000002004','00000000-0000-0000-0000-000000001006',2),
('00000000-0000-0000-0000-000000002005','00000000-0000-0000-0000-000000001011',3),
('00000000-0000-0000-0000-000000002006','00000000-0000-0000-0000-000000001008',2),
('00000000-0000-0000-0000-000000002007','00000000-0000-0000-0000-000000001013',2),
('00000000-0000-0000-0000-000000002008','00000000-0000-0000-0000-000000001010',2)
ON CONFLICT DO NOTHING;

INSERT INTO course_modules (course_id, module_order, module_title, duration_minutes) VALUES
('00000000-0000-0000-0000-000000002001',1,'Electronics Basics and Powertrain Context',45),
('00000000-0000-0000-0000-000000002001',2,'Sensors, Actuators and ECU Architecture',60),
('00000000-0000-0000-0000-000000002001',3,'Live Demonstration and Q&A',75),
('00000000-0000-0000-0000-000000002002',1,'CAN and LIN Fundamentals',90),
('00000000-0000-0000-0000-000000002002',2,'DBC and Signal Interpretation',120),
('00000000-0000-0000-0000-000000002002',3,'Fault Diagnosis Lab',240),
('00000000-0000-0000-0000-000000002003',1,'Battery Ageing and SOH Fundamentals',180),
('00000000-0000-0000-0000-000000002003',2,'Warranty Data Analytics Case Study',240)
ON CONFLICT (course_id, module_order) DO NOTHING;

INSERT INTO training_enrollments (course_id, employee_id, nominated_by, status, progress_percent, score, completed_at) VALUES
('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000000603','Completed',100,88,'2026-03-12 13:10:00+05:30'),
('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000000612','00000000-0000-0000-0000-000000000603','Completed',100,82,'2026-03-12 13:10:00+05:30'),
('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000000613','00000000-0000-0000-0000-000000000603','Completed',100,75,'2026-03-12 13:10:00+05:30'),
('00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000000603','In Progress',60,NULL,NULL),
('00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000000612','00000000-0000-0000-0000-000000000603','Approved',0,NULL,NULL),
('00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000000607','Approved',0,NULL,NULL)
ON CONFLICT (course_id, employee_id) DO NOTHING;

INSERT INTO learning_plan_items (employee_id, course_id, assigned_by, status, priority, progress_percent, due_date, notes) VALUES
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000000603','To Do','High',0,'2026-06-30','Required for EV systems validation readiness'),
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000000603','In Progress','High',60,'2026-04-30','Mentor support from Gurpreet Singh'),
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000000603','Completed','Medium',100,'2026-03-15','Foundation completed'),
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000002006','00000000-0000-0000-0000-000000000604','Archived','Low',100,'2025-12-31','Archived after completion'),
('00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000000607','In Progress','Critical',25,'2026-05-30','Advanced battery analytics pathway')
ON CONFLICT DO NOTHING;

-- Mentor assignments and technical support
INSERT INTO mentor_assignments (id, mentor_id, mentee_id, skill_id, start_date, status, assignment_reason) VALUES
('00000000-0000-0000-0000-000000002201','00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000001002','2026-02-01','Active','CAN/LIN skill development for EV validation role'),
('00000000-0000-0000-0000-000000002202','00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000612','00000000-0000-0000-0000-000000001002','2026-02-01','Active','Diagnostic project support'),
('00000000-0000-0000-0000-000000002203','00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000001003','2026-03-01','Active','Battery SOH analytics capability'),
('00000000-0000-0000-0000-000000002204','00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000000613','00000000-0000-0000-0000-000000001007','2026-03-01','Active','Diagnostics capability improvement'),
('00000000-0000-0000-0000-000000002205','00000000-0000-0000-0000-000000000609','00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000001008','2026-03-10','Active','Thermal management basics for EV validation')
ON CONFLICT DO NOTHING;

INSERT INTO mentoring_sessions (mentor_assignment_id, session_date, mode, topic, notes, action_items) VALUES
('00000000-0000-0000-0000-000000002201','2026-03-25 16:00:00+05:30','One-to-One','CAN trace review','Reviewed signal flow and DBC interpretation.','Practice reading CAN frames from sample log.'),
('00000000-0000-0000-0000-000000002203','2026-03-24 15:00:00+05:30','Project Review','Battery SOH case data','Discussed warranty analysis approach.','Prepare ageing trend summary.'),
('00000000-0000-0000-0000-000000002204','2026-03-23 16:00:00+05:30','Office Hour','OBD DTC query','Clarified freeze frame data usage.','Submit diagnostic fault tree.')
ON CONFLICT DO NOTHING;

INSERT INTO technical_support_requests (employee_id, mentor_id, skill_id, request_title, request_detail, priority, status) VALUES
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000001002','Need help interpreting CAN trace','Signal counters and message periodicity are unclear for bench test trace.','High','In Progress'),
('00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000001003','SOH model validation approach','Need review of feature selection for warranty analytics.','Medium','Assigned'),
('00000000-0000-0000-0000-000000000613','00000000-0000-0000-0000-000000000605','00000000-0000-0000-0000-000000001007','OBD readiness monitor doubt','Need guidance on OBD readiness monitor interpretation.','Medium','Open')
ON CONFLICT DO NOTHING;

-- Skill ratings (self, manager and mentor)
INSERT INTO skill_assessments (employee_id, skill_id, assessor_employee_id, assessor_type, assessed_level, confidence_level, comments, status, assessed_at) VALUES
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000000611','Self',4,4,'Can read CAN logs and identify basic signal issues.','Submitted','2026-03-05 10:00:00+05:30'),
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000000603','Manager',3,4,'Good progress; needs independent validation exposure.','Approved','2026-03-06 15:00:00+05:30'),
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000000604','Mentor',4,5,'Can interpret DBC and trace issues with limited guidance.','Approved','2026-03-12 16:00:00+05:30'),
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000001005','00000000-0000-0000-0000-000000000603','Manager',3,4,'Ready for EV validation projects with support.','Approved','2026-03-06 15:00:00+05:30'),
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000001003','00000000-0000-0000-0000-000000000603','Manager',2,3,'Needs SOH fundamentals training.','Approved','2026-03-06 15:00:00+05:30'),
('00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000001003','00000000-0000-0000-0000-000000000614','Self',3,4,'Can analyze warranty data; need deeper algorithm knowledge.','Submitted','2026-03-10 12:00:00+05:30'),
('00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000001003','00000000-0000-0000-0000-000000000607','Mentor',3,4,'Good data orientation; recommend advanced SOH module.','Approved','2026-03-12 14:00:00+05:30'),
('00000000-0000-0000-0000-000000000613','00000000-0000-0000-0000-000000001007','00000000-0000-0000-0000-000000000603','Manager',3,3,'Needs OBD practice and documentation discipline.','Approved','2026-03-06 15:00:00+05:30')
ON CONFLICT DO NOTHING;

-- Course development pipeline: unique SME + coordinator model
INSERT INTO course_development_requests (id, request_code, capability_gap_title, skill_id, source, business_need, status, sme_id, coordinator_id, volunteer_id, target_launch_date) VALUES
('00000000-0000-0000-0000-000000002601','CDR-BAT-SOH-001','Battery SOH capability gap for EV readiness','00000000-0000-0000-0000-000000001003','Future Skills Dashboard','Future EV warranty analytics requires stronger SOH capability across battery and quality teams.','SME Review','00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000615','2026-05-15'),
('00000000-0000-0000-0000-000000002602','CDR-CAN-LIN-001','CAN/LIN practical diagnostics foundation','00000000-0000-0000-0000-000000001002','Assessment Gap','Assessment indicates mechanical engineers need practical vehicle network exposure.','Published','00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000610','00000000-0000-0000-0000-000000000615','2026-04-10')
ON CONFLICT (request_code) DO NOTHING;

INSERT INTO course_development_stages (request_id, stage_order, stage_name, owner_id, status, due_date, completed_at) VALUES
('00000000-0000-0000-0000-000000002601',1,'Need Identified','00000000-0000-0000-0000-000000000602','Completed','2026-03-15','2026-03-15 10:00:00+05:30'),
('00000000-0000-0000-0000-000000002601',2,'SME Assigned','00000000-0000-0000-0000-000000000607','Completed','2026-03-20','2026-03-18 10:00:00+05:30'),
('00000000-0000-0000-0000-000000002601',3,'Training Coordinator Assigned','00000000-0000-0000-0000-000000000610','Completed','2026-03-22','2026-03-20 10:00:00+05:30'),
('00000000-0000-0000-0000-000000002601',4,'Draft Material','00000000-0000-0000-0000-000000000615','Completed','2026-04-15','2026-04-12 10:00:00+05:30'),
('00000000-0000-0000-0000-000000002601',5,'SME Review','00000000-0000-0000-0000-000000000607','In Progress','2026-04-30',NULL),
('00000000-0000-0000-0000-000000002601',6,'Pilot Session','00000000-0000-0000-0000-000000000607','Pending','2026-05-10',NULL),
('00000000-0000-0000-0000-000000002601',7,'Publish Course','00000000-0000-0000-0000-000000000610','Pending','2026-05-15',NULL)
ON CONFLICT (request_id, stage_order) DO NOTHING;

INSERT INTO mentor_recommendations (mentor_id, employee_id, skill_id, recommended_level, recommended_role_id, recommended_course_id, readiness, recommendation_text, status) VALUES
('00000000-0000-0000-0000-000000000604','00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000001002',4,'00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-000000002002','Ready in 3 Months','Jasleen can interpret network traces and should receive project exposure for complete validation ownership.','Submitted'),
('00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000001003',3,'00000000-0000-0000-0000-000000000505','00000000-0000-0000-0000-000000002003','Ready in 6 Months','Anirban understands warranty data patterns and should complete advanced SOH analytics training.','Submitted')
ON CONFLICT DO NOTHING;

-- Certifications
INSERT INTO certifications (id, certification_code, title, description, certification_type, validity_months, approver_role) VALUES
('00000000-0000-0000-0000-000000002701','CERT-EV-SAFE-L1','EV Safety Level 1','Internal certification for safe handling of EV high-voltage systems.','Mandatory',36,'SME'),
('00000000-0000-0000-0000-000000002702','CERT-CAN-DIAG','CAN Diagnostic Practitioner','Certification for practical CAN/LIN diagnostic capability.','Internal',36,'Mentor'),
('00000000-0000-0000-0000-000000002703','CERT-BAT-SOH','Battery SOH Internal Certification','Certification for battery SOH analytics and warranty interpretation.','Internal',24,'SME'),
('00000000-0000-0000-0000-000000002704','CERT-FS-AWARE','Functional Safety Awareness','Awareness certification for functional safety basics.','Internal',24,'SME')
ON CONFLICT (certification_code) DO NOTHING;

INSERT INTO certification_skill_map (certification_id, skill_id, required_level) VALUES
('00000000-0000-0000-0000-000000002701','00000000-0000-0000-0000-000000001011',3),
('00000000-0000-0000-0000-000000002702','00000000-0000-0000-0000-000000001002',3),
('00000000-0000-0000-0000-000000002703','00000000-0000-0000-0000-000000001003',3),
('00000000-0000-0000-0000-000000002704','00000000-0000-0000-0000-000000001010',2)
ON CONFLICT DO NOTHING;

INSERT INTO employee_certifications (employee_id, certification_id, status, requested_date, approved_date, issued_date, expiry_date, approved_by, comments) VALUES
('00000000-0000-0000-0000-000000000609','00000000-0000-0000-0000-000000002701','Approved','2026-02-01','2026-02-10','2026-02-10','2029-02-10','00000000-0000-0000-0000-000000000605','Approved after refresher assessment.'),
('00000000-0000-0000-0000-000000000611','00000000-0000-0000-0000-000000002702','Approved','2026-02-15','2026-02-20','2026-02-20','2029-02-20','00000000-0000-0000-0000-000000000604','Approved by mentor after practical diagnostics review.'),
('00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000002703','Requested','2026-03-25',NULL,NULL,NULL,'00000000-0000-0000-0000-000000000607','Awaiting practical case validation.'),
('00000000-0000-0000-0000-000000000612','00000000-0000-0000-0000-000000002704','Requested','2026-03-28',NULL,NULL,NULL,'00000000-0000-0000-0000-000000000605','Pending manager confirmation.'),
('00000000-0000-0000-0000-000000000613','00000000-0000-0000-0000-000000002701','Expired','2024-01-10','2024-01-10','2024-01-10','2026-01-10','00000000-0000-0000-0000-000000000605','Renewal due.')
ON CONFLICT DO NOTHING;

-- Inbox and approvals
INSERT INTO inbox_items (recipient_employee_id, item_type, title, body, related_entity_type, related_entity_id, status, priority, due_at) VALUES
('00000000-0000-0000-0000-000000000603','Assessment','Manager review pending for Riya Mukherjee','Please review FY26 skill assessment for Riya Mukherjee.','assessment_campaign','00000000-0000-0000-0000-000000002401','Unread','High','2026-03-31 18:00:00+05:30'),
('00000000-0000-0000-0000-000000000604','Mentor Request','Mentor review pending for Jasleen Kaur','Please validate CAN/LIN practical skill level.','mentor_assignment','00000000-0000-0000-0000-000000002201','Read','High','2026-03-28 18:00:00+05:30'),
('00000000-0000-0000-0000-000000000610','Approval','Course publish approval required','Battery SOH course is in SME review and needs publish readiness check.','course_development_request','00000000-0000-0000-0000-000000002601','Unread','Medium','2026-04-30 18:00:00+05:30'),
('00000000-0000-0000-0000-000000000611','Training','CAN / LIN Practical Diagnostics assigned','You have been nominated for CAN / LIN Practical Diagnostics.','training_course','00000000-0000-0000-0000-000000002002','Unread','High','2026-04-10 09:30:00+05:30'),
('00000000-0000-0000-0000-000000000613','Certification','EV Safety Level 1 renewal due','Please complete renewal before certificate expiry.','certification','00000000-0000-0000-0000-000000002701','Unread','Critical','2026-04-15 18:00:00+05:30')
ON CONFLICT DO NOTHING;

INSERT INTO approvals (approval_type, requested_by, approver_id, entity_type, entity_id, status, decision_comments) VALUES
('Training Nomination','00000000-0000-0000-0000-000000000603','00000000-0000-0000-0000-000000000610','training_course','00000000-0000-0000-0000-000000002002','Pending',NULL),
('Certification','00000000-0000-0000-0000-000000000614','00000000-0000-0000-0000-000000000607','employee_certification','00000000-0000-0000-0000-000000002703','Pending',NULL),
('Course Publish','00000000-0000-0000-0000-000000000607','00000000-0000-0000-0000-000000000610','course_development_request','00000000-0000-0000-0000-000000002601','Pending',NULL)
ON CONFLICT DO NOTHING;

-- Admin settings
INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES
('branding', '{"productName":"PTE CIP","fullName":"Powertrain Engineering Capability Intelligence Platform","theme":"dark","primaryAccent":"#3B82F6"}', '00000000-0000-0000-0000-000000000610'),
('skillLevelScale', '{"min":1,"max":5,"labels":["Awareness","Working Knowledge","Practitioner","Advanced Practitioner","Expert / SME"]}', '00000000-0000-0000-0000-000000000610'),
('assessmentWorkflow', '{"steps":["Self","Manager","Mentor","SME Validation"],"allowMentorOverride":false}', '00000000-0000-0000-0000-000000000610'),
('mentorModel', '{"postTrainingMentoringDaysDefault":90,"allowTechnicalSupportRequests":true,"allowRoleRecommendation":true}', '00000000-0000-0000-0000-000000000610')
ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_by=EXCLUDED.updated_by, updated_at=NOW();

INSERT INTO audit_logs (actor_employee_id, action, entity_type, entity_id, after_data) VALUES
('00000000-0000-0000-0000-000000000610','Seeded proxy database','system_settings',NULL,'{"source":"PTE CIP proxy seed"}'::jsonb),
('00000000-0000-0000-0000-000000000603','Created assessment campaign','assessment_campaign','00000000-0000-0000-0000-000000002401','{"campaign":"FY26 Powertrain Capability Review"}'::jsonb)
ON CONFLICT DO NOTHING;

COMMIT;
