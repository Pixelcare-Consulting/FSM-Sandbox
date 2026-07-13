-- =============================================
-- FSM SYSTEM - OPTIMIZED SCHEMA
-- Consolidated from lib/supabase/migrations/*.sql
-- =============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================
-- TABLES
-- =============================================

-- Users Table (AUDIT: Track user account changes)
-- Note: password is nullable because passwords are now stored in Supabase Auth (auth.users)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255), -- Nullable: passwords stored in Supabase Auth
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    role VARCHAR(20) DEFAULT 'TECHNICIAN' CHECK (role IN ('ADMIN', 'TECHNICIAN', 'CUSTOMER')),
    is_logged_in BOOLEAN NOT NULL DEFAULT false,
    current_session_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Audit Logs (AUDIT: Full portal action trail)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'system',
    entity_type VARCHAR(50),
    entity_id VARCHAR(255),
    entity_label VARCHAR(500),
    description TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    changes JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'success'
        CHECK (status IN ('success', 'failure', 'warning', 'pending')),
    source VARCHAR(50) NOT NULL DEFAULT 'portal'
        CHECK (source IN ('portal', 'api', 'system', 'cron', 'migration')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recent Activities (session / worker activity log)
CREATE TABLE recent_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    type VARCHAR(50) DEFAULT 'session_management',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications (worker notifications)
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    type VARCHAR(50),
    read BOOLEAN DEFAULT false,
    hidden BOOLEAN DEFAULT false,
    action_href TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Technicians Table (AUDIT: Track technician profile changes)
CREATE TABLE technicians (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    -- Personal Information
    first_name VARCHAR(255),
    middle_name VARCHAR(255),
    last_name VARCHAR(255),
    gender VARCHAR(20) CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
    date_of_birth DATE,
    profile_picture TEXT,
    avatar_url TEXT,
    bio TEXT,
    color VARCHAR(7),
    -- Contact Information
    phone_number VARCHAR(50),
    primary_phone VARCHAR(50),
    secondary_phone VARCHAR(50),
    active_phone_1 BOOLEAN DEFAULT false,
    active_phone_2 BOOLEAN DEFAULT false,
    street_address TEXT,
    state_province VARCHAR(255),
    zip_code VARCHAR(20),
    city VARCHAR(255),
    country VARCHAR(10),
    -- Emergency Contact
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(50),
    emergency_relationship VARCHAR(100),
    -- Work Permit Information
    nric_fin_work_permit_number VARCHAR(50),
    work_permit_expiry_date DATE,
    -- Skills (stored as JSONB array)
    skills JSONB DEFAULT '[]'::jsonb,
    -- SAP / Incentive
    sap_tech_code VARCHAR(100),
    job_incentive_hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
    sap_udt_total_income NUMERIC(14, 4) NOT NULL DEFAULT 0,
    sap_udt_total_working_hrs NUMERIC(14, 4) NOT NULL DEFAULT 0,
    sap_udt_snapshot_label TEXT,
    sap_udt_snapshot_at TIMESTAMPTZ,
    -- Status and Tracking
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    is_online BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Customer Table (AUDIT: Track customer records)
CREATE TABLE customer (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_code VARCHAR(100) UNIQUE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_address TEXT,
    phone_number VARCHAR(50),
    email VARCHAR(255),
    sap_card_code VARCHAR(20),
    bill_to_default VARCHAR(100),
    ship_to_default VARCHAR(100),
    synced_to_sap_at TIMESTAMP WITH TIME ZONE,
    sap_sync_verified_at TIMESTAMPTZ,
    sap_sync_environment VARCHAR(50),
    lead_id UUID,
    source VARCHAR(20) CHECK (source IS NULL OR source IN ('portal', 'sap')),
    block VARCHAR(100),
    unit VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Locations Table (AUDIT: Track location changes for compliance)
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customer(id) ON DELETE CASCADE,
    location_name VARCHAR(255),
    current_longitude VARCHAR(50),
    current_latitude VARCHAR(50),
    destination_longitude VARCHAR(50),
    destination_latitude VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Customer Location Table (NO AUDIT: Reference data)
CREATE TABLE customer_location (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    site_id VARCHAR(100),
    building VARCHAR(255),
    street_number VARCHAR(50),
    street VARCHAR(255),
    block VARCHAR(100),
    address TEXT,
    city VARCHAR(255),
    country_name VARCHAR(255),
    zip_code VARCHAR(20),
    address_type VARCHAR(50),
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL
);

-- Customer Address Details (editable portal address metadata)
CREATE TABLE customer_address_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_code VARCHAR(100) NOT NULL,
    address_name VARCHAR(255) NOT NULL,
    address_type VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Active',
    address_notes TEXT,
    customer_location_id UUID REFERENCES customer_location(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(customer_code, address_name)
);

-- Customer Notes
CREATE TABLE customer_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    user_email VARCHAR(255),
    tags JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Customer Creation Drafts (portal → SAP BusinessPartners)
CREATE TABLE customer_creation_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'synced', 'failed')),
    sap_card_code VARCHAR(20),
    error_message TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Contacts Table (NO AUDIT: Reference data, can be recreated)
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    customer_location_id UUID REFERENCES customer_location(id) ON DELETE SET NULL,
    first_name VARCHAR(255) NOT NULL,
    middle_name VARCHAR(255),
    last_name VARCHAR(255) NOT NULL,
    tel1 VARCHAR(50),
    tel2 VARCHAR(50),
    email VARCHAR(255)
);

-- Equipments Table (AUDIT: Track equipment lifecycle)
CREATE TABLE equipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    item_code VARCHAR(100) NOT NULL,
    serial_number VARCHAR(100),
    model_series VARCHAR(255),
    item_group VARCHAR(255),
    brand VARCHAR(255),
    item_name VARCHAR(255) NOT NULL,
    equipment_location VARCHAR(255),
    warranty_start_date DATE,
    warranty_end_date DATE,
    equipment_type VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Sales Quotation Table (AUDIT: Financial records must be tracked)
CREATE TABLE sales_quotation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    card_code VARCHAR(100),
    comments TEXT,
    doc_date VARCHAR(50),
    doc_name VARCHAR(255),
    doc_total NUMERIC(15, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Sales Order Table (AUDIT: Financial records must be tracked)
CREATE TABLE sales_order (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_number VARCHAR(100) UNIQUE NOT NULL,
    document_status VARCHAR(50),
    document_total DECIMAL(15, 2),
    sap_found BOOLEAN DEFAULT false,
    sap_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Service Call Table (AUDIT: Track customer service requests)
CREATE TABLE service_call (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    call_number VARCHAR(100) UNIQUE NOT NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED')),
    description TEXT,
    priority VARCHAR(20) DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    customer_name_sap VARCHAR(255),
    sap_create_date DATE,
    sap_create_time VARCHAR(20),
    sap_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Leads Table (AUDIT: Track customer leads from forms and other sources)
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    google_form_response_id VARCHAR(255) UNIQUE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    salutation VARCHAR(50),
    handphone VARCHAR(50),
    block VARCHAR(100),
    unit VARCHAR(100),
    building VARCHAR(255),
    street VARCHAR(255),
    postcode VARCHAR(50),
    country VARCHAR(100),
    address TEXT,
    first_service_date DATE,
    second_service_date DATE,
    third_service_date DATE,
    fourth_service_date DATE,
    time_slot VARCHAR(255),
    agreed_to_terms BOOLEAN DEFAULT false,
    personal_info_consent BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONTACTED', 'CONVERTED', 'REJECTED', 'COMPLETED', 'Portal')),
    source VARCHAR(100) DEFAULT 'GOOGLE_FORM',
    notes TEXT,
    customer_id UUID REFERENCES customer(id) ON DELETE SET NULL,
    converted_at TIMESTAMP WITH TIME ZONE,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Circular FK: customer.lead_id → leads (leads table now exists)
ALTER TABLE customer
    ADD CONSTRAINT customer_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);

-- SAP Lead masterlist (parallel to portal leads)
CREATE TABLE sap_lead (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_code VARCHAR(100) NOT NULL,
    lead_name VARCHAR(255) NOT NULL,
    lead_address TEXT,
    phone_number VARCHAR(50),
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT sap_lead_lead_code_unique UNIQUE (lead_code)
);

CREATE TABLE sap_lead_location (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sap_lead_id UUID NOT NULL REFERENCES sap_lead(id) ON DELETE CASCADE,
    site_id VARCHAR(100),
    building VARCHAR(255),
    street_number VARCHAR(50),
    street VARCHAR(255),
    block VARCHAR(100),
    address TEXT,
    city VARCHAR(255),
    country_name VARCHAR(255),
    zip_code VARCHAR(20),
    address_type VARCHAR(50),
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL
);

CREATE TABLE sap_lead_contact (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sap_lead_id UUID NOT NULL REFERENCES sap_lead(id) ON DELETE CASCADE,
    sap_lead_location_id UUID REFERENCES sap_lead_location(id) ON DELETE SET NULL,
    first_name VARCHAR(255) NOT NULL,
    middle_name VARCHAR(255),
    last_name VARCHAR(255) NOT NULL,
    tel1 VARCHAR(50),
    tel2 VARCHAR(50),
    email VARCHAR(255)
);

-- Location Technicians Table (NO AUDIT: Tracking/logging data, ephemeral)
CREATE TABLE location_technicians (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    current_longitude VARCHAR(50),
    current_latitude VARCHAR(50),
    destination_longitude VARCHAR(50),
    destination_latitude VARCHAR(50),
    tracked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payment Profiles (must exist before jobs.payment_profile_id FK)
CREATE TABLE payment_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    label VARCHAR(100) NOT NULL,
    pay_to VARCHAR(255),
    bank_name VARCHAR(255),
    account_no VARCHAR(100),
    paynow_uen VARCHAR(50),
    paynow_uen_qr VARCHAR(80),
    payment_instruction TEXT,
    is_default BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Jobs Table (AUDIT: Critical business data)
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customer(id) ON DELETE CASCADE,
    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    service_call_id UUID REFERENCES service_call(id) ON DELETE SET NULL,
    sales_order_id UUID REFERENCES sales_order(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    payment_profile_id UUID REFERENCES payment_profiles(id) ON DELETE SET NULL,
    job_number VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    status VARCHAR(32) DEFAULT 'PENDING',
    scheduled_start TIMESTAMP WITH TIME ZONE,
    scheduled_end TIMESTAMP WITH TIME ZONE,
    sap_activity_id VARCHAR(50),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    sap_cm_number VARCHAR(100),
    sap_cm_status VARCHAR(20),
    sap_job_income NUMERIC(14, 4) NOT NULL DEFAULT 0,
    payment_qr_uen VARCHAR(50),
    payment_qr_amount INTEGER,
    payment_qr_editable BOOLEAN DEFAULT false,
    payment_qr_expiry VARCHAR(8),
    payment_qr_ref_number VARCHAR(255),
    payment_qr_company VARCHAR(255),
    payment_qr_code_string TEXT,
    payment_qr_inv_number VARCHAR(255),
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'partial', 'failed')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Job Payments (received customer PayNow / bank credits)
CREATE TABLE job_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    bank_reference VARCHAR(255),
    source VARCHAR(50) NOT NULL DEFAULT 'manual',
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job Contact Type Table (NO AUDIT: Configuration/lookup data)
CREATE TABLE job_contact_type (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    code INTEGER,
    name VARCHAR(255) NOT NULL
);

-- Job Category Table (NO AUDIT: Classification data)
CREATE TABLE job_category (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    description TEXT
);

-- Job Contact Type Options Table (NO AUDIT: Master lookup, seeded from SAP OCLT)
CREATE TABLE job_contact_type_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code INTEGER,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    sap_synced_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT job_contact_type_options_code_unique UNIQUE (code)
);

-- Job Subject Options Table (NO AUDIT: Master lookup, seeded from SAP U_API_JOB_CATEGORY)
CREATE TABLE job_subject_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sap_job_cat_id TEXT,
    name TEXT,
    code TEXT,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    sap_synced_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT job_subject_options_sap_job_cat_id_unique UNIQUE (sap_job_cat_id)
);

-- Job Status Table (NO AUDIT: Historical log, inherently timestamped)
CREATE TABLE job_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    description TEXT,
    status_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job Schedule Table (AUDIT: Important for planning and compliance)
CREATE TABLE job_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    job_status_id UUID REFERENCES job_status(id) ON DELETE SET NULL,
    job_tech VARCHAR(255),
    jsdate DATE,
    jedate DATE,
    jstime TIME,
    jetime TIME,
    dur_type VARCHAR(50),
    dur VARCHAR(50),
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job Equipments Table (NO AUDIT: Transactional data)
CREATE TABLE job_equipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    equipment_id UUID NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
    quantity_used INTEGER DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Technician Jobs Table (AUDIT: Critical for job assignment tracking)
CREATE TABLE technician_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    assignment_status VARCHAR(20) DEFAULT 'ASSIGNED' CHECK (assignment_status IN ('ASSIGNED', 'STARTED', 'COMPLETED', 'CANCELLED')),
    technician_remarks TEXT,
    service_notes TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    accumulated_hours NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Technician hours (materialized FSM labor per assignment for incentive rollups)
CREATE TABLE technician_hours (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_job_id UUID NOT NULL REFERENCES technician_jobs(id) ON DELETE CASCADE,
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    labor_hours NUMERIC(14, 4) NOT NULL DEFAULT 0,
    period_anchor_at TIMESTAMP WITH TIME ZONE,
    computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    is_synced BOOLEAN NOT NULL DEFAULT FALSE,
    synced_at TIMESTAMPTZ,
    CONSTRAINT technician_hours_technician_job_id_unique UNIQUE (technician_job_id)
);

-- Job Tasks Table (NO AUDIT: Task templates, can be recreated)
CREATE TABLE job_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    task_name TEXT NOT NULL,
    task_description TEXT,
    task_order INTEGER DEFAULT 0,
    is_required BOOLEAN DEFAULT true,
    is_completed BOOLEAN DEFAULT NULL,
    completed_by_technician_id UUID REFERENCES technicians(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Task Completions Table (AUDIT: Important for compliance and billing)
CREATE TABLE task_completions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_job_id UUID NOT NULL REFERENCES technician_jobs(id) ON DELETE CASCADE,
    job_task_id UUID NOT NULL REFERENCES job_tasks(id) ON DELETE CASCADE,
    is_completed BOOLEAN DEFAULT false,
    completion_notes TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(technician_job_id, job_task_id)
);

-- Job Media Table (AUDIT: Track job-related media files - images, PDFs, etc.)
CREATE TABLE job_media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    technician_job_id UUID REFERENCES technician_jobs(id) ON DELETE SET NULL,
    image_url TEXT NOT NULL,
    media_type VARCHAR(50) DEFAULT 'image' CHECK (media_type IN ('image', 'pdf', 'video', 'document')),
    filename VARCHAR(255),
    description TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Job Signatures Table (AUDIT: Legal compliance - must never be deleted)
CREATE TABLE job_signatures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_job_id UUID NOT NULL REFERENCES technician_jobs(id) ON DELETE CASCADE,
    signature_image_url TEXT NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_feedback TEXT,
    signed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(technician_job_id)
);

-- Attendance Table (AUDIT: Critical for payroll and compliance)
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    technician_job_id UUID REFERENCES technician_jobs(id) ON DELETE SET NULL,
    clock_in TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    clock_out TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Technicians Schedule Table (NO AUDIT: Junction table, minimal data)
CREATE TABLE technicians_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE
);

-- Followups Table (AUDIT: Track follow-up actions)
CREATE TABLE followups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    technician_id UUID REFERENCES technicians(id) ON DELETE SET NULL,
    status_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status_updated_by_account TEXT,
    type VARCHAR(50),
    status VARCHAR(50),
    priority VARCHAR(20),
    notes TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Scheduling Windows Table (NO AUDIT: Configuration data)
CREATE TABLE scheduling_windows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    label VARCHAR(255) NOT NULL,
    time_start TIME NOT NULL,
    time_end TIME NOT NULL,
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Settings Table (NO AUDIT: Configuration data)
CREATE TABLE settings (
    id VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Company Details Table (AUDIT: Track company information changes)
CREATE TABLE company_details (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255),
    logo TEXT,
    address TEXT,
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(255),
    pay_to VARCHAR(255),
    bank_name VARCHAR(255),
    account_no VARCHAR(100),
    paynow VARCHAR(50),
    payment_instruction TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Company Memos Table (AUDIT: Portal announcements)
CREATE TABLE company_memos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject VARCHAR(500) NOT NULL,
    body TEXT,
    priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_group_memo BOOLEAN NOT NULL DEFAULT false,
    target_group VARCHAR(255),
    show_on_sign_in BOOLEAN NOT NULL DEFAULT false,
    show_on_job_screen BOOLEAN NOT NULL DEFAULT false,
    show_on_dispatch_screen BOOLEAN NOT NULL DEFAULT false,
    show_in_header BOOLEAN NOT NULL DEFAULT true,
    only_creator_can_edit BOOLEAN NOT NULL DEFAULT false,
    folder VARCHAR(100) NOT NULL DEFAULT 'General',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Google Forms Table (AUDIT: Track Google Forms URLs)
CREATE TABLE google_forms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    form_id VARCHAR(255),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT check_google_forms_url CHECK (url LIKE '%docs.google.com/forms%')
);

-- Job Sync Logs (SAP sync audit)
CREATE TABLE job_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    direction VARCHAR(20) NOT NULL CHECK (direction IN ('to_sap', 'from_sap')),
    action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'sync')),
    sap_activity_id VARCHAR(50),
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failure', 'skipped')),
    request_payload JSONB,
    response_payload JSONB,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job Email Log (idempotent transactional email tracking)
CREATE TABLE job_email_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    template_key VARCHAR(50) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(job_id, template_key)
);

-- Job Technician Admin Messages
CREATE TABLE job_technician_admin_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
    technician_job_id UUID REFERENCES technician_jobs(id) ON DELETE SET NULL,
    admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_type VARCHAR(50) NOT NULL CHECK (sender_type IN ('ADMIN', 'TECHNICIAN')),
    message TEXT,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT check_message_or_image CHECK (
        (message IS NOT NULL AND message != '') OR
        (image_url IS NOT NULL AND image_url != '')
    )
);

-- Job Migration Upload (Excel import staging)
CREATE TABLE job_migration_upload (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(512) NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'MAPPED', 'APPLIED', 'PARTIAL', 'FAILED')),
    rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    column_mapping JSONB,
    applied_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SAP Job Incentive Results Cache
CREATE TABLE job_incentive_results (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    sap_tech_code VARCHAR(100) NOT NULL,
    year SMALLINT NOT NULL,
    month SMALLINT NOT NULL,
    income NUMERIC(14, 4) DEFAULT 0,
    expense NUMERIC(14, 4) DEFAULT 0,
    working_hrs NUMERIC(14, 4) DEFAULT 0,
    income_per_dollar NUMERIC(14, 6) DEFAULT 0,
    income_per_hour NUMERIC(14, 6) DEFAULT 0,
    fetched_from_sap_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT job_incentive_results_pkey PRIMARY KEY (id),
    CONSTRAINT job_incentive_results_tech_period UNIQUE (technician_id, year, month)
);

CREATE TABLE job_incentive_detail_results (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    job_incentive_result_id UUID NOT NULL REFERENCES job_incentive_results(id) ON DELETE CASCADE,
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    document_type VARCHAR(40),
    document_date DATE,
    document_entry VARCHAR(80),
    document_number VARCHAR(100),
    bp_code VARCHAR(50),
    bp_name VARCHAR(255),
    document_amount NUMERIC(14, 4) DEFAULT 0,
    incentive_amount NUMERIC(14, 4) DEFAULT 0,
    fetched_from_sap_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT job_incentive_detail_results_pkey PRIMARY KEY (id)
);

-- Email Triggers Registry
CREATE TABLE email_triggers (
    trigger_id VARCHAR(64) PRIMARY KEY,
    label VARCHAR(255) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Email Templates Registry
CREATE TABLE email_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(32) NOT NULL DEFAULT 'system',
    legacy_key VARCHAR(64),
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    merge_field_schema JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE email_trigger_bindings (
    trigger_id VARCHAR(64) PRIMARY KEY,
    template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE email_template_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
    scope_type VARCHAR(32) NOT NULL,
    scope_id UUID NOT NULL,
    subject TEXT,
    body_html TEXT,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(template_id, scope_type, scope_id)
);

CREATE TABLE email_template_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
    version INT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(template_id, version)
);

-- Technician Employee Profile Extension Tables
CREATE TABLE technician_employment_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    employee_type VARCHAR(100),
    job_title VARCHAR(255),
    department VARCHAR(255),
    hire_date DATE,
    original_hire_date DATE,
    adjusted_service_date DATE,
    release_date DATE,
    manager_supervisor VARCHAR(255),
    group_assignment VARCHAR(255),
    industry_start_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT technician_employment_details_technician_unique UNIQUE (technician_id)
);

CREATE TABLE technician_access_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    is_admin BOOLEAN DEFAULT false,
    is_field_worker BOOLEAN DEFAULT true,
    access_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT technician_access_settings_technician_unique UNIQUE (technician_id)
);

CREATE TABLE technician_payroll_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    employee_id VARCHAR(100),
    nickname VARCHAR(255),
    regular_rate_hour NUMERIC(10, 2) DEFAULT 0,
    regular_rate_job NUMERIC(10, 2) DEFAULT 0,
    commission_rate NUMERIC(10, 4) DEFAULT 0,
    calculate_overtime VARCHAR(100),
    overtime1_starts_after NUMERIC(10, 2),
    overtime1_rate NUMERIC(10, 2) DEFAULT 0,
    overtime2_starts_after NUMERIC(10, 2),
    overtime2_rate NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT technician_payroll_profiles_technician_unique UNIQUE (technician_id)
);

CREATE TABLE payroll_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    label VARCHAR(255) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(32) DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'paid')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT payroll_periods_date_range CHECK (period_end >= period_start)
);

CREATE TABLE payroll_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    hours_worked NUMERIC(10, 2) DEFAULT 0,
    job_commission NUMERIC(14, 4) DEFAULT 0,
    gross_pay NUMERIC(14, 4) DEFAULT 0,
    deductions NUMERIC(14, 4) DEFAULT 0,
    net_pay NUMERIC(14, 4) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT payroll_entries_period_technician_unique UNIQUE (payroll_period_id, technician_id)
);

CREATE TABLE payroll_disbursements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payroll_period_id UUID REFERENCES payroll_periods(id) ON DELETE SET NULL,
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    disbursement_method VARCHAR(50) DEFAULT 'bank_transfer',
    status VARCHAR(32) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
    paid_at TIMESTAMP WITH TIME ZONE,
    bank_reference VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE technician_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    day_key VARCHAR(16) NOT NULL,
    shift_number SMALLINT NOT NULL CHECK (shift_number IN (1, 2)),
    start_time TIME,
    end_time TIME,
    is_working BOOLEAN DEFAULT true,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE technician_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    document_type VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    document_number VARCHAR(255),
    expiration_date DATE,
    notify_before_expiry BOOLEAN DEFAULT false,
    storage_bucket VARCHAR(100) DEFAULT 'documents',
    storage_path TEXT,
    file_url TEXT,
    file_name VARCHAR(255),
    file_type VARCHAR(255),
    file_size BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE technician_other_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    language_preference VARCHAR(100) DEFAULT 'English (US)',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT technician_other_details_technician_unique UNIQUE (technician_id)
);

-- Calendar Events (company holidays / technician leave)
CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope VARCHAR(20) NOT NULL CHECK (scope IN ('company', 'technician')),
    technician_id UUID REFERENCES technicians(id) ON DELETE CASCADE,
    event_type VARCHAR(30) NOT NULL CHECK (
        event_type IN ('holiday', 'company_day_off', 'leave', 'medical', 'other')
    ),
    title VARCHAR(500) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    all_day BOOLEAN NOT NULL DEFAULT true,
    start_time TIME,
    end_time TIME,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT calendar_events_date_range CHECK (end_date >= start_date),
    CONSTRAINT calendar_events_scope_technician CHECK (
        (scope = 'company' AND technician_id IS NULL)
        OR (scope = 'technician' AND technician_id IS NOT NULL)
    ),
    CONSTRAINT calendar_events_company_types CHECK (
        scope <> 'company'
        OR event_type IN ('holiday', 'company_day_off')
    ),
    CONSTRAINT calendar_events_technician_types CHECK (
        scope <> 'technician'
        OR event_type IN ('leave', 'medical', 'other')
    )
);

-- User Migration Upload (Excel import staging)
CREATE TABLE user_migration_upload (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(512) NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'PARTIAL', 'FAILED')),
    rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    applied_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================

-- Users
CREATE INDEX idx_users_username ON users(username) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role ON users(role) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_is_logged_in ON users(is_logged_in) WHERE deleted_at IS NULL AND is_logged_in = true;

-- Audit Logs
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_category ON audit_logs(category);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_status ON audit_logs(status);

-- Recent Activities
CREATE INDEX idx_recent_activities_worker_id ON recent_activities(worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX idx_recent_activities_timestamp ON recent_activities(timestamp DESC);
CREATE INDEX idx_recent_activities_action ON recent_activities(action);
CREATE INDEX idx_recent_activities_type ON recent_activities(type);

-- Notifications
CREATE INDEX idx_notifications_worker_id ON notifications(worker_id);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_notifications_hidden ON notifications(hidden);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_worker_hidden_created_at ON notifications(worker_id, hidden, created_at DESC);
CREATE INDEX idx_notifications_broadcast_hidden_created_at ON notifications(created_at DESC) WHERE hidden = false AND worker_id IS NULL;
CREATE INDEX idx_notifications_worker_hidden_read ON notifications(worker_id, hidden, read) WHERE hidden = false;

-- Technicians
CREATE INDEX idx_technicians_user_id ON technicians(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technicians_email ON technicians(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_technicians_status ON technicians(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_technicians_is_online ON technicians(is_online) WHERE deleted_at IS NULL;
CREATE INDEX idx_technicians_first_name ON technicians(first_name) WHERE deleted_at IS NULL;
CREATE INDEX idx_technicians_last_name ON technicians(last_name) WHERE deleted_at IS NULL;
CREATE INDEX idx_technicians_gender ON technicians(gender) WHERE deleted_at IS NULL;
CREATE INDEX idx_technicians_date_of_birth ON technicians(date_of_birth) WHERE deleted_at IS NULL;
CREATE INDEX idx_technicians_sap_tech_code ON technicians(sap_tech_code) WHERE sap_tech_code IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_technicians_color ON technicians(color) WHERE color IS NOT NULL;

-- Customer
CREATE INDEX idx_customer_customer_code ON customer(customer_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_email ON customer(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_source ON customer(source) WHERE deleted_at IS NULL AND source IS NOT NULL;
CREATE INDEX idx_customer_lead_id ON customer(lead_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_code_trgm ON customer USING gin (customer_code gin_trgm_ops);
CREATE INDEX idx_customer_name_trgm ON customer USING gin (customer_name gin_trgm_ops);
CREATE INDEX idx_customer_phone_trgm ON customer USING gin (phone_number gin_trgm_ops);
CREATE INDEX idx_customer_email_trgm ON customer USING gin (email gin_trgm_ops);

-- Customer Address Details
CREATE INDEX idx_customer_address_details_customer_code ON customer_address_details(customer_code);
CREATE INDEX idx_customer_address_details_address_name ON customer_address_details(address_name);
CREATE INDEX idx_customer_address_details_status ON customer_address_details(status);
CREATE INDEX idx_customer_address_details_deleted_at ON customer_address_details(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_address_details_customer_location_id ON customer_address_details(customer_location_id) WHERE customer_location_id IS NOT NULL;

-- Customer Notes
CREATE INDEX idx_customer_notes_customer_id ON customer_notes(customer_id);
CREATE INDEX idx_customer_notes_created_at ON customer_notes(created_at DESC);
CREATE INDEX idx_customer_notes_deleted_at ON customer_notes(deleted_at) WHERE deleted_at IS NULL;

-- Customer Creation Drafts
CREATE INDEX idx_customer_creation_drafts_status ON customer_creation_drafts(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_creation_drafts_sap_card_code ON customer_creation_drafts(sap_card_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_creation_drafts_created_at ON customer_creation_drafts(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_customer_creation_drafts_created_by ON customer_creation_drafts(created_by) WHERE deleted_at IS NULL;

-- Contacts
CREATE INDEX idx_contacts_customer_id ON contacts(customer_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_customer_location_id ON contacts(customer_location_id) WHERE customer_location_id IS NOT NULL;

-- Customer Location
CREATE INDEX idx_customer_location_customer_id ON customer_location(customer_id);
CREATE INDEX idx_customer_location_customer_id_id ON customer_location(customer_id, id);
CREATE INDEX idx_customer_location_site_id ON customer_location(site_id);
CREATE INDEX idx_customer_location_location_id ON customer_location(location_id) WHERE location_id IS NOT NULL;

-- Locations
CREATE INDEX idx_locations_customer_id ON locations(customer_id) WHERE deleted_at IS NULL;

-- Equipments
CREATE INDEX idx_equipments_customer_id ON equipments(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_equipments_item_code ON equipments(item_code) WHERE deleted_at IS NULL;

-- Sales Order
CREATE INDEX idx_sales_order_sap_found ON sales_order(sap_found) WHERE deleted_at IS NULL;

-- Service Call
CREATE INDEX idx_service_call_customer_id ON service_call(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_service_call_call_number ON service_call(call_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_service_call_status ON service_call(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_service_call_sap_synced_at ON service_call(sap_synced_at) WHERE deleted_at IS NULL;

-- Leads
CREATE INDEX idx_leads_email ON leads(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_status ON leads(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_customer_id ON leads(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_submitted_at ON leads(submitted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_first_service_date ON leads(first_service_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_source ON leads(source) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_google_form_response_id ON leads(google_form_response_id) WHERE deleted_at IS NULL;

-- SAP Lead
CREATE INDEX idx_sap_lead_lead_code ON sap_lead(lead_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_sap_lead_email ON sap_lead(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_sap_lead_location_sap_lead_id ON sap_lead_location(sap_lead_id);
CREATE INDEX idx_sap_lead_location_site_id ON sap_lead_location(site_id);
CREATE INDEX idx_sap_lead_contact_sap_lead_id ON sap_lead_contact(sap_lead_id);
CREATE INDEX idx_sap_lead_contact_location_id ON sap_lead_contact(sap_lead_location_id) WHERE sap_lead_location_id IS NOT NULL;
CREATE INDEX idx_sap_lead_code_trgm ON sap_lead USING gin (lead_code gin_trgm_ops);
CREATE INDEX idx_sap_lead_name_trgm ON sap_lead USING gin (lead_name gin_trgm_ops);
CREATE INDEX idx_sap_lead_phone_trgm ON sap_lead USING gin (phone_number gin_trgm_ops);
CREATE INDEX idx_sap_lead_email_trgm ON sap_lead USING gin (email gin_trgm_ops);

-- Location Technicians
CREATE INDEX idx_location_technicians_technician_id ON location_technicians(technician_id);
CREATE INDEX idx_location_technicians_location_id ON location_technicians(location_id);
CREATE INDEX idx_location_technicians_tracked_at ON location_technicians(tracked_at);
CREATE INDEX idx_location_technicians_tracked_at_desc ON location_technicians(tracked_at DESC);
CREATE INDEX idx_location_technicians_tech_tracked ON location_technicians(technician_id, tracked_at DESC);

-- Payment Profiles
CREATE UNIQUE INDEX idx_payment_profiles_default ON payment_profiles (is_default) WHERE is_default = true AND deleted_at IS NULL;

-- Jobs
CREATE INDEX idx_jobs_customer_id ON jobs(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_location_id ON jobs(location_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_service_call_id ON jobs(service_call_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_sales_order_id ON jobs(sales_order_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_contact_id ON jobs(contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_job_number ON jobs(job_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_status ON jobs(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_priority ON jobs(priority) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_scheduled_start ON jobs(scheduled_start) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_sap_activity_id ON jobs(sap_activity_id) WHERE sap_activity_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_active_sched_start_created_at ON jobs(scheduled_start, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_active_sched_end_start ON jobs(scheduled_end, scheduled_start) WHERE deleted_at IS NULL AND scheduled_start IS NOT NULL;
CREATE INDEX idx_jobs_active_undated_created_at ON jobs(created_at DESC) WHERE deleted_at IS NULL AND scheduled_start IS NULL;

-- Job Contact Type
CREATE INDEX idx_job_contact_type_job_id ON job_contact_type(job_id);

-- Job Category
CREATE INDEX idx_job_category_job_id ON job_category(job_id);

-- Job Status
CREATE INDEX idx_job_status_job_id ON job_status(job_id);
CREATE INDEX idx_job_status_status_date ON job_status(status_date);

-- Job Schedule
CREATE INDEX idx_job_schedule_job_id ON job_schedule(job_id);
CREATE INDEX idx_job_schedule_job_status_id ON job_schedule(job_status_id);
CREATE INDEX idx_job_schedule_jsdate ON job_schedule(jsdate);
CREATE INDEX idx_job_schedule_job_id_jsdate ON job_schedule(job_id, jsdate);

-- Job Equipments
CREATE INDEX idx_job_equipments_job_id ON job_equipments(job_id);
CREATE INDEX idx_job_equipments_equipment_id ON job_equipments(equipment_id);

-- Technician Jobs
CREATE INDEX idx_technician_jobs_technician_id ON technician_jobs(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_jobs_job_id ON technician_jobs(job_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_jobs_job_id_active ON technician_jobs(job_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_jobs_status ON technician_jobs(assignment_status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_technician_jobs_unique_active ON technician_jobs (technician_id, job_id) WHERE deleted_at IS NULL;

-- Technician Hours
CREATE INDEX idx_technician_hours_technician_period ON technician_hours(technician_id, period_anchor_at);

-- Job Tasks
CREATE INDEX idx_job_tasks_job_id ON job_tasks(job_id);
CREATE INDEX idx_job_tasks_order ON job_tasks(job_id, task_order);
CREATE INDEX idx_job_tasks_completed_by_technician_id ON job_tasks(completed_by_technician_id)
    WHERE completed_by_technician_id IS NOT NULL;

-- Task Completions
CREATE INDEX idx_task_completions_technician_job_id ON task_completions(technician_job_id);
CREATE INDEX idx_task_completions_job_task_id ON task_completions(job_task_id);
CREATE INDEX idx_task_completions_completed_at ON task_completions(completed_at);

-- Job Media
CREATE INDEX idx_job_media_job_id ON job_media(job_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_media_technician_job_id ON job_media(technician_job_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_media_media_type ON job_media(media_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_media_filename ON job_media(filename) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_media_created_at ON job_media(created_at) WHERE deleted_at IS NULL;

-- Job Signatures
CREATE INDEX idx_job_signatures_technician_job_id ON job_signatures(technician_job_id);
CREATE INDEX idx_job_signatures_signed_at ON job_signatures(signed_at);

-- Attendance
CREATE INDEX idx_attendance_technician_id ON attendance(technician_id);
CREATE INDEX idx_attendance_technician_job_id ON attendance(technician_job_id);
CREATE INDEX idx_attendance_clock_in ON attendance(clock_in);

-- Technicians Schedule
CREATE INDEX idx_technicians_schedule_attendance_id ON technicians_schedule(attendance_id);
CREATE INDEX idx_technicians_schedule_job_id ON technicians_schedule(job_id);

-- Followups
CREATE INDEX idx_followups_job_id ON followups(job_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_followups_user_id ON followups(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_followups_technician_id ON followups(technician_id) WHERE deleted_at IS NULL;

-- Company Details
CREATE INDEX idx_company_details_id ON company_details(id);

-- Company Memos
CREATE INDEX idx_company_memos_deleted_at ON company_memos(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_company_memos_header ON company_memos(show_in_header) WHERE deleted_at IS NULL;
CREATE INDEX idx_company_memos_expires_at ON company_memos(expires_at);
CREATE INDEX idx_company_memos_created_by ON company_memos(created_by);
CREATE INDEX idx_company_memos_folder ON company_memos(folder) WHERE deleted_at IS NULL;

-- Google Forms
CREATE INDEX idx_google_forms_active ON google_forms(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_google_forms_form_id ON google_forms(form_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_google_forms_created_at ON google_forms(created_at);
CREATE INDEX idx_google_forms_deleted_at ON google_forms(deleted_at) WHERE deleted_at IS NULL;

-- Job Sync Logs
CREATE INDEX idx_job_sync_logs_job_id ON job_sync_logs(job_id);
CREATE INDEX idx_job_sync_logs_created_at ON job_sync_logs(created_at DESC);
CREATE INDEX idx_job_sync_logs_status ON job_sync_logs(status);

-- Job Email Log
CREATE INDEX idx_job_email_log_job_id ON job_email_log(job_id);
CREATE INDEX idx_job_email_log_template_key ON job_email_log(template_key);

-- Job Technician Admin Messages
CREATE INDEX idx_job_technician_admin_messages_job_id ON job_technician_admin_messages(job_id);
CREATE INDEX idx_job_technician_admin_messages_technician_job_id ON job_technician_admin_messages(technician_job_id);
CREATE INDEX idx_job_technician_admin_messages_created_at ON job_technician_admin_messages(created_at);
CREATE INDEX idx_job_technician_admin_messages_deleted_at ON job_technician_admin_messages(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_technician_admin_messages_admin_id ON job_technician_admin_messages(admin_id);

-- Job Migration Upload
CREATE INDEX idx_job_migration_upload_status ON job_migration_upload(status);
CREATE INDEX idx_job_migration_upload_uploaded_at ON job_migration_upload(uploaded_at);

-- Job Incentive Results
CREATE INDEX idx_job_incentive_results_period ON job_incentive_results (year DESC, month DESC);
CREATE INDEX idx_job_incentive_detail_results_parent ON job_incentive_detail_results (job_incentive_result_id);

-- Email
CREATE INDEX idx_email_triggers_system ON email_triggers(is_system);
CREATE INDEX idx_email_triggers_sort ON email_triggers(sort_order);
CREATE INDEX idx_email_templates_category ON email_templates(category);
CREATE INDEX idx_email_templates_legacy_key ON email_templates(legacy_key) WHERE legacy_key IS NOT NULL;
CREATE INDEX idx_email_templates_active ON email_templates(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_email_template_overrides_scope ON email_template_overrides(scope_type, scope_id);

-- Technician Profile Tables
CREATE INDEX idx_technician_employment_details_technician_id ON technician_employment_details(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_access_settings_technician_id ON technician_access_settings(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_payroll_profiles_technician_id ON technician_payroll_profiles(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_job_payments_job_id ON job_payments(job_id);
CREATE INDEX idx_job_payments_paid_at ON job_payments(paid_at DESC);
CREATE UNIQUE INDEX idx_job_payments_source_bank_ref_unique ON job_payments (source, bank_reference) WHERE bank_reference IS NOT NULL;
CREATE INDEX idx_payroll_periods_dates ON payroll_periods(period_start, period_end) WHERE deleted_at IS NULL;
CREATE INDEX idx_payroll_entries_period_id ON payroll_entries(payroll_period_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payroll_entries_technician_id ON payroll_entries(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payroll_disbursements_period_id ON payroll_disbursements(payroll_period_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payroll_disbursements_technician_id ON payroll_disbursements(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_schedules_technician_id ON technician_schedules(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_schedules_day_shift ON technician_schedules(technician_id, day_of_week, shift_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_documents_technician_id ON technician_documents(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_documents_expiration_date ON technician_documents(expiration_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_other_details_technician_id ON technician_other_details(technician_id) WHERE deleted_at IS NULL;

-- Calendar Events
CREATE INDEX idx_calendar_events_date_range ON calendar_events (start_date, end_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_calendar_events_technician_start ON calendar_events (technician_id, start_date) WHERE deleted_at IS NULL AND technician_id IS NOT NULL;
CREATE INDEX idx_calendar_events_scope ON calendar_events (scope) WHERE deleted_at IS NULL;

-- User Migration Upload
CREATE INDEX idx_user_migration_upload_status ON user_migration_upload(status);
CREATE INDEX idx_user_migration_upload_uploaded_at ON user_migration_upload(uploaded_at);

-- =============================================
-- FUNCTIONS
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attendance duration calculation
CREATE OR REPLACE FUNCTION calculate_attendance_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.clock_out IS NOT NULL AND NEW.clock_in IS NOT NULL THEN
        NEW.duration_minutes = EXTRACT(EPOCH FROM (NEW.clock_out - NEW.clock_in)) / 60;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Job technician admin messages updated_at
CREATE OR REPLACE FUNCTION update_job_technician_admin_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Guarded FSM labor hours per assignment
CREATE OR REPLACE FUNCTION public.fn_compute_technician_labor_hours(
  p_started_at        TIMESTAMPTZ,
  p_completed_at      TIMESTAMPTZ,
  p_accumulated_hours NUMERIC,
  p_assignment_status TEXT,
  p_scheduled_start   TIMESTAMPTZ,
  p_scheduled_end     TIMESTAMPTZ,
  p_max_hours_per_day NUMERIC DEFAULT 16
) RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_span_h    NUMERIC;
  v_days      INT;
  v_cap_h     NUMERIC;
  v_slot_h    NUMERIC;
  v_stale     BOOLEAN;
BEGIN
  IF UPPER(COALESCE(p_assignment_status, '')) <> 'COMPLETED' THEN
    RETURN 0;
  END IF;

  IF p_accumulated_hours IS NOT NULL AND p_accumulated_hours > 0 THEN
    RETURN ROUND(p_accumulated_hours::NUMERIC, 4);
  END IF;

  IF p_started_at IS NULL OR p_completed_at IS NULL OR p_completed_at <= p_started_at THEN
    RETURN 0;
  END IF;

  v_stale := p_scheduled_start IS NOT NULL
    AND p_started_at < p_scheduled_start - INTERVAL '7 days';
  IF v_stale THEN
    IF p_scheduled_start IS NOT NULL AND p_scheduled_end IS NOT NULL
       AND p_scheduled_end > p_scheduled_start THEN
      RETURN ROUND(
        (EXTRACT(EPOCH FROM (p_scheduled_end - p_scheduled_start)) / 3600.0)::NUMERIC, 4
      );
    END IF;
    RETURN 0;
  END IF;

  IF p_scheduled_end IS NOT NULL
     AND p_completed_at > p_scheduled_end + INTERVAL '2 days' THEN
    IF p_scheduled_start IS NOT NULL AND p_scheduled_end > p_scheduled_start THEN
      RETURN ROUND(
        (EXTRACT(EPOCH FROM (p_scheduled_end - p_scheduled_start)) / 3600.0)::NUMERIC, 4
      );
    END IF;
    RETURN 0;
  END IF;

  v_span_h := EXTRACT(EPOCH FROM (p_completed_at - p_started_at)) / 3600.0;

  v_days := GREATEST(
    1,
    (DATE(p_completed_at AT TIME ZONE 'Asia/Singapore')
   - DATE(p_started_at   AT TIME ZONE 'Asia/Singapore')) + 1
  );
  v_cap_h := v_days * p_max_hours_per_day;
  v_span_h := LEAST(v_span_h, v_cap_h);

  IF p_scheduled_start IS NOT NULL AND p_scheduled_end IS NOT NULL
     AND p_scheduled_end > p_scheduled_start THEN
    v_slot_h := EXTRACT(EPOCH FROM (p_scheduled_end - p_scheduled_start)) / 3600.0;
    IF v_span_h > v_slot_h * 4 THEN
      v_span_h := v_slot_h;
    END IF;
  END IF;

  RETURN ROUND(v_span_h::NUMERIC, 4);
END;
$$;

-- Period anchor for incentive month/quarter rollups
CREATE OR REPLACE FUNCTION public.fn_technician_hours_period_anchor(
  p_completed_at      TIMESTAMPTZ,
  p_assignment_status TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN UPPER(COALESCE(p_assignment_status, '')) = 'COMPLETED'
     AND p_completed_at IS NOT NULL
    THEN p_completed_at
    ELSE NULL
  END;
$$;

-- Completion trigger function: UPSERT technician_hours
CREATE OR REPLACE FUNCTION public.fn_create_technician_hours_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_labor NUMERIC;
  v_anchor TIMESTAMPTZ;
BEGIN
  IF NEW.assignment_status = 'COMPLETED'
     AND (OLD.assignment_status IS DISTINCT FROM 'COMPLETED') THEN

    SELECT scheduled_start, scheduled_end INTO v_job
    FROM jobs WHERE id = NEW.job_id;

    v_labor := fn_compute_technician_labor_hours(
      NEW.started_at, NEW.completed_at, NEW.accumulated_hours,
      NEW.assignment_status, v_job.scheduled_start, v_job.scheduled_end
    );
    v_anchor := fn_technician_hours_period_anchor(NEW.completed_at, NEW.assignment_status);

    IF v_anchor IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO technician_hours (
      technician_job_id, technician_id, labor_hours, period_anchor_at, computed_at
    ) VALUES (
      NEW.id, NEW.technician_id, v_labor, v_anchor, NOW()
    )
    ON CONFLICT (technician_job_id) DO UPDATE SET
      technician_id    = EXCLUDED.technician_id,
      labor_hours      = EXCLUDED.labor_hours,
      period_anchor_at = EXCLUDED.period_anchor_at,
      computed_at      = EXCLUDED.computed_at;
  END IF;
  RETURN NEW;
END;
$$;

-- Auto-populate leads full_name and address from parts
CREATE OR REPLACE FUNCTION update_full_name_from_parts()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.full_name IS NULL OR NEW.full_name = '') AND
       (NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL) THEN
        NEW.full_name := TRIM(CONCAT(COALESCE(NEW.first_name, ''), ' ', COALESCE(NEW.last_name, '')));
    END IF;

    IF (NEW.address IS NULL OR NEW.address = '') AND
       (NEW.building IS NOT NULL OR NEW.street IS NOT NULL OR NEW.postcode IS NOT NULL OR NEW.country IS NOT NULL) THEN
        NEW.address := TRIM(
            CONCAT_WS(', ',
                NULLIF(NEW.building, ''),
                NULLIF(NEW.street, ''),
                NULLIF(NEW.postcode, ''),
                NULLIF(NEW.country, '')
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- FSM hours sum by technician (incentive rollups)
CREATE OR REPLACE FUNCTION public.fsm_hours_sum_by_technician(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS TABLE (technician_id UUID, total_hours NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT th.technician_id,
           COALESCE(SUM(th.labor_hours), 0)::NUMERIC AS total_hours
    FROM technician_hours th
    WHERE th.period_anchor_at IS NOT NULL
      AND th.period_anchor_at >= p_start
      AND th.period_anchor_at <= p_end
    GROUP BY th.technician_id;
$$;

GRANT EXECUTE ON FUNCTION public.fsm_hours_sum_by_technician(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fsm_hours_sum_by_technician(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- Report aggregate RPCs
CREATE OR REPLACE FUNCTION public.report_job_category_aggregates()
RETURNS TABLE (description TEXT, job_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(TRIM(jc.description), ''), 'Uncategorized') AS description,
    COUNT(*)::BIGINT AS job_count
  FROM job_category jc
  INNER JOIN jobs j ON j.id = jc.job_id AND j.deleted_at IS NULL
  GROUP BY COALESCE(NULLIF(TRIM(jc.description), ''), 'Uncategorized')
  ORDER BY job_count DESC, description ASC;
$$;

CREATE OR REPLACE FUNCTION public.report_equipment_brand_aggregates()
RETURNS TABLE (brand TEXT, equipment_count BIGINT, types TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      COALESCE(NULLIF(TRIM(brand), ''), 'Unknown') AS brand,
      equipment_type
    FROM equipments
    WHERE deleted_at IS NULL
  ),
  grouped AS (
    SELECT brand, COUNT(*)::BIGINT AS equipment_count
    FROM base
    GROUP BY brand
  ),
  type_lists AS (
    SELECT
      b.brand,
      (
        SELECT string_agg(type_name, ', ')
        FROM (
          SELECT equipment_type AS type_name
          FROM base b2
          WHERE b2.brand = b.brand
            AND equipment_type IS NOT NULL
            AND TRIM(equipment_type) <> ''
          GROUP BY equipment_type
          ORDER BY type_name
          LIMIT 5
        ) sub
      ) AS types
    FROM (SELECT DISTINCT brand FROM base) b
  )
  SELECT
    g.brand,
    g.equipment_count,
    COALESCE(t.types, '—') AS types
  FROM grouped g
  LEFT JOIN type_lists t ON t.brand = g.brand
  ORDER BY g.equipment_count DESC, g.brand ASC;
$$;

CREATE OR REPLACE FUNCTION public.report_product_category_aggregates()
RETURNS TABLE (name TEXT, total_items BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(TRIM(item_group), ''), 'Unspecified') AS name,
    COUNT(*)::BIGINT AS total_items
  FROM equipments
  WHERE deleted_at IS NULL
  GROUP BY COALESCE(NULLIF(TRIM(item_group), ''), 'Unspecified')
  ORDER BY total_items DESC, name ASC;
$$;

-- Dashboard overview aggregate RPCs
CREATE OR REPLACE FUNCTION public.dashboard_job_status_counts()
RETURNS TABLE (status TEXT, job_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(status::TEXT, 'UNKNOWN') AS status, COUNT(*)::BIGINT AS job_count
  FROM jobs
  WHERE deleted_at IS NULL
  GROUP BY status;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_followup_status_counts()
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total', COUNT(*)::BIGINT,
    'logged', COUNT(*) FILTER (
      WHERE UPPER(REPLACE(COALESCE(status, ''), ' ', '_')) = 'LOGGED'
    )::BIGINT,
    'inProgress', COUNT(*) FILTER (
      WHERE UPPER(REPLACE(COALESCE(status, ''), ' ', '_')) = 'IN_PROGRESS'
    )::BIGINT,
    'closed', COUNT(*) FILTER (
      WHERE UPPER(REPLACE(COALESCE(status, ''), ' ', '_')) = 'CLOSED'
    )::BIGINT,
    'cancelled', COUNT(*) FILTER (
      WHERE UPPER(REPLACE(COALESCE(status, ''), ' ', '_')) = 'CANCELLED'
    )::BIGINT
  )
  FROM followups
  WHERE deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_job_count_in_range(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*)::BIGINT
  FROM jobs
  WHERE deleted_at IS NULL
    AND created_at >= p_start
    AND created_at < p_end;
$$;

CREATE OR REPLACE FUNCTION public.overview_job_status_display(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE UPPER(COALESCE(p_status, 'PENDING'))
    WHEN 'COMPLETED' THEN 'Completed'
    WHEN 'IN_PROGRESS' THEN 'In Progress'
    WHEN 'INPROGRESS' THEN 'In Progress'
    WHEN 'PENDING' THEN 'Created'
    WHEN 'CREATED' THEN 'Created'
    ELSE COALESCE(p_status, 'PENDING')
  END;
$$;

CREATE OR REPLACE FUNCTION public.overview_classify_bucket(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN UPPER(COALESCE(p_status, '')) LIKE '%COMPLET%'
      OR LOWER(public.overview_job_status_display(p_status)) LIKE '%complete%'
      THEN 'completed'
    WHEN UPPER(COALESCE(p_status, '')) IN ('CREATED', 'PENDING')
      OR LOWER(public.overview_job_status_display(p_status)) LIKE '%created%'
      THEN 'pending'
    WHEN UPPER(COALESCE(p_status, '')) LIKE '%PROGRESS%'
      OR LOWER(public.overview_job_status_display(p_status)) LIKE '%progress%'
      THEN 'inProgress'
    ELSE 'other'
  END;
$$;

CREATE OR REPLACE FUNCTION public._dashboard_overview_previous_count(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*)::BIGINT
  FROM jobs
  WHERE deleted_at IS NULL
    AND created_at >= (p_start - (p_end - p_start))
    AND created_at < p_start;
$$;

CREATE OR REPLACE FUNCTION public._dashboard_overview_period_slice(
  p_period TEXT,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_previous_count BIGINT,
  p_now TIMESTAMPTZ,
  p_twenty_four_hours_ago TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $slice$
DECLARE
  labels TEXT[];
  n_buckets INT;
  completed_arr BIGINT[];
  pending_arr BIGINT[];
  in_progress_arr BIGINT[];
  rec RECORD;
  idx INT;
  bucket_idx INT;
  total_tasks BIGINT := 0;
  active_workers BIGINT := 0;
  pending_tasks BIGINT := 0;
  completed_tasks BIGINT := 0;
  active_jobs_count BIGINT := 0;
  new_jobs_count BIGINT := 0;
  unassigned_count BIGINT := 0;
  high_priority_count BIGINT := 0;
  overdue_scheduled_count BIGINT := 0;
  unique_customers BIGINT := 0;
  task_growth INT;
  distribution JSON;
  top_status_raw TEXT;
  top_status_count BIGINT := 0;
  top_status_pct TEXT;
  completion_rate_pct TEXT;
  status_upper TEXT;
  is_done BOOLEAN;
BEGIN
  IF p_period = 'Today' THEN
    labels := ARRAY(
      SELECT (g::TEXT || ':00')
      FROM generate_series(0, 23) AS g
    );
    n_buckets := 24;
  ELSIF p_period = 'This Week' THEN
    labels := ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    n_buckets := 7;
  ELSIF p_period = 'This Month' THEN
    labels := ARRAY['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
    n_buckets := 5;
  ELSE
    labels := ARRAY['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    n_buckets := 12;
  END IF;

  completed_arr := array_fill(0::BIGINT, ARRAY[n_buckets]);
  pending_arr := array_fill(0::BIGINT, ARRAY[n_buckets]);
  in_progress_arr := array_fill(0::BIGINT, ARRAY[n_buckets]);

  FOR rec IN
    SELECT *
    FROM _overview_jobs_enriched
    WHERE created_at >= p_start
      AND created_at <= p_end
  LOOP
    total_tasks := total_tasks + 1;

    status_upper := UPPER(COALESCE(rec.status, ''));

    IF status_upper IN ('CREATED', 'PENDING', 'IN_PROGRESS')
      OR rec.job_status_display IN ('Created', 'In Progress') THEN
      pending_tasks := pending_tasks + 1;
    END IF;

    IF status_upper LIKE '%COMPLET%'
      OR rec.job_status_display IN ('Completed', 'Job Complete') THEN
      completed_tasks := completed_tasks + 1;
    END IF;

    IF status_upper LIKE '%PROGRESS%' OR rec.job_status_display = 'In Progress' THEN
      active_jobs_count := active_jobs_count + 1;
    END IF;

    IF (status_upper IN ('CREATED', 'PENDING') OR rec.job_status_display = 'Created')
      AND rec.created_at >= p_twenty_four_hours_ago THEN
      new_jobs_count := new_jobs_count + 1;
    END IF;

    IF rec.technician_ids IS NULL OR cardinality(rec.technician_ids) = 0 THEN
      unassigned_count := unassigned_count + 1;
    END IF;

    IF UPPER(COALESCE(rec.priority, '')) LIKE '%HIGH%'
      OR UPPER(COALESCE(rec.priority, '')) LIKE '%URGENT%'
      OR rec.priority IN ('4', 'H') THEN
      high_priority_count := high_priority_count + 1;
    END IF;

    is_done :=
      status_upper LIKE '%COMPLET%'
      OR rec.job_status_display IN ('Completed', 'Job Complete')
      OR status_upper = 'CANCELLED'
      OR rec.job_status_display = 'Cancelled';

    IF NOT is_done
      AND rec.scheduled_end IS NOT NULL
      AND rec.scheduled_end < p_now THEN
      overdue_scheduled_count := overdue_scheduled_count + 1;
    END IF;

  END LOOP;

  FOR rec IN
    SELECT *
    FROM _overview_jobs_enriched
    WHERE created_at >= p_start
      AND created_at <= p_end
  LOOP
    IF p_period = 'Today' THEN
      bucket_idx := EXTRACT(HOUR FROM rec.created_at)::INT;
    ELSIF p_period = 'This Week' THEN
      idx := EXTRACT(DOW FROM rec.created_at)::INT;
      bucket_idx := CASE WHEN idx = 0 THEN 6 ELSE idx - 1 END;
    ELSIF p_period = 'This Month' THEN
      bucket_idx := LEAST(FLOOR((EXTRACT(DAY FROM rec.created_at) - 1) / 7)::INT, 4);
    ELSE
      bucket_idx := EXTRACT(MONTH FROM rec.created_at)::INT - 1;
    END IF;

    IF bucket_idx < 0 OR bucket_idx >= n_buckets THEN
      CONTINUE;
    END IF;

    idx := bucket_idx + 1;
    IF rec.chart_bucket = 'completed' THEN
      completed_arr[idx] := completed_arr[idx] + 1;
    ELSIF rec.chart_bucket = 'pending' THEN
      pending_arr[idx] := pending_arr[idx] + 1;
    ELSIF rec.chart_bucket = 'inProgress' THEN
      in_progress_arr[idx] := in_progress_arr[idx] + 1;
    END IF;
  END LOOP;

  SELECT COUNT(DISTINCT customer_id)::BIGINT
  INTO unique_customers
  FROM _overview_jobs_enriched
  WHERE created_at >= p_start
    AND created_at <= p_end
    AND customer_id IS NOT NULL;

  SELECT COALESCE(
    (
      SELECT json_object_agg(status_raw, cnt)
      FROM (
        SELECT status_raw, COUNT(*)::BIGINT AS cnt
        FROM _overview_jobs_enriched
        WHERE created_at >= p_start
          AND created_at <= p_end
        GROUP BY status_raw
      ) d
    ),
    '{}'::JSON
  )
  INTO distribution;

  SELECT status_raw, cnt
  INTO top_status_raw, top_status_count
  FROM (
    SELECT status_raw, COUNT(*)::BIGINT AS cnt
    FROM _overview_jobs_enriched
    WHERE created_at >= p_start
      AND created_at <= p_end
    GROUP BY status_raw
    ORDER BY cnt DESC, status_raw ASC
    LIMIT 1
  ) t;

  IF p_previous_count = 0 THEN
    task_growth := CASE WHEN total_tasks > 0 THEN 100 ELSE 0 END;
  ELSE
    task_growth := ROUND(((total_tasks - p_previous_count)::NUMERIC / p_previous_count) * 100)::INT;
  END IF;

  IF total_tasks > 0 AND top_status_count > 0 THEN
    top_status_pct := ROUND((top_status_count::NUMERIC / total_tasks) * 100, 1)::TEXT;
  ELSE
    top_status_pct := NULL;
  END IF;

  IF total_tasks > 0 THEN
    completion_rate_pct := ROUND((completed_tasks::NUMERIC / total_tasks) * 100, 1)::TEXT;
  ELSE
    completion_rate_pct := '0';
  END IF;

  SELECT COUNT(DISTINCT tech_id)::BIGINT
  INTO active_workers
  FROM _overview_jobs_enriched je
  CROSS JOIN LATERAL unnest(
    CASE
      WHEN je.technician_ids IS NULL THEN ARRAY[]::UUID[]
      ELSE je.technician_ids
    END
  ) AS tech_id
  WHERE je.created_at >= p_start
    AND je.created_at <= p_end
    AND (
      UPPER(COALESCE(je.status, '')) LIKE '%PROGRESS%'
      OR je.job_status_display = 'In Progress'
    );

  RETURN json_build_object(
    'labels', labels,
    'completed', completed_arr,
    'pending', pending_arr,
    'inProgress', in_progress_arr,
    'distribution', distribution,
    'stats', json_build_object(
      'totalTasks', total_tasks,
      'activeWorkers', COALESCE(active_workers, 0),
      'pendingTasks', pending_tasks,
      'completedTasks', completed_tasks,
      'activeJobsCount', active_jobs_count,
      'newJobsCount', new_jobs_count,
      'taskGrowth', task_growth
    ),
    'insights', json_build_object(
      'periodTotal', total_tasks,
      'topStatusRaw', top_status_raw,
      'topStatusCount', COALESCE(top_status_count, 0),
      'topStatusPct', top_status_pct,
      'completedCount', completed_tasks,
      'completionRatePct', completion_rate_pct,
      'unassignedCount', unassigned_count,
      'inProgressInPeriod', active_jobs_count,
      'highPriorityCount', high_priority_count,
      'overdueScheduledCount', overdue_scheduled_count,
      'uniqueCustomers', COALESCE(unique_customers, 0)
    )
  );
END;
$slice$;

CREATE OR REPLACE FUNCTION public.dashboard_overview_periods_json()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $func$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_today_end TIMESTAMPTZ;
  v_week_start TIMESTAMPTZ;
  v_month_start TIMESTAMPTZ;
  v_year_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ;
  v_24h_ago TIMESTAMPTZ;
  v_prev_today BIGINT;
  v_prev_week BIGINT;
  v_prev_month BIGINT;
  v_prev_year BIGINT;
BEGIN
  v_now := NOW();
  v_today_start := date_trunc('day', v_now);
  v_today_end := v_today_start + INTERVAL '1 day' - INTERVAL '1 millisecond';
  v_week_start := date_trunc('week', v_now);
  v_month_start := date_trunc('month', v_now);
  v_year_start := date_trunc('year', v_now);
  v_24h_ago := v_now - INTERVAL '24 hours';

  CREATE TEMP TABLE _overview_jobs_enriched ON COMMIT DROP AS
  SELECT
    j.id,
    j.status,
    j.created_at,
    j.scheduled_end,
    j.priority,
    j.customer_id,
    public.overview_job_status_display(j.status) AS job_status_display,
    public.overview_classify_bucket(j.status) AS chart_bucket,
    COALESCE(NULLIF(TRIM(j.status::TEXT), ''), 'UNKNOWN') AS status_raw,
    COALESCE(tj.tech_ids, ARRAY[]::UUID[]) AS technician_ids
  FROM jobs j
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT tj.technician_id) AS tech_ids
    FROM technician_jobs tj
    WHERE tj.job_id = j.id
      AND tj.deleted_at IS NULL
  ) tj ON true
  WHERE j.deleted_at IS NULL
    AND j.created_at >= v_year_start
    AND j.created_at <= v_today_end;

  v_prev_today := public._dashboard_overview_previous_count(v_today_start, v_today_end);
  v_prev_week := public._dashboard_overview_previous_count(v_week_start, v_today_end);
  v_prev_month := public._dashboard_overview_previous_count(v_month_start, v_today_end);
  v_prev_year := public._dashboard_overview_previous_count(v_year_start, v_today_end);

  RETURN json_build_object(
    'Today', public._dashboard_overview_period_slice(
      'Today', v_today_start, v_today_end, v_prev_today, v_now, v_24h_ago
    ),
    'This Week', public._dashboard_overview_period_slice(
      'This Week', v_week_start, v_today_end, v_prev_week, v_now, v_24h_ago
    ),
    'This Month', public._dashboard_overview_period_slice(
      'This Month', v_month_start, v_today_end, v_prev_month, v_now, v_24h_ago
    ),
    'This Year', public._dashboard_overview_period_slice(
      'This Year', v_year_start, v_today_end, v_prev_year, v_now, v_24h_ago
    )
  );
END;
$func$;

CREATE OR REPLACE FUNCTION public.customer_location_country_stats()
RETURNS TABLE (address_count BIGINT, top_country TEXT, top_country_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT TRIM(country_name) AS country, COUNT(*)::BIGINT AS cnt
    FROM customer_location
    WHERE country_name IS NOT NULL
      AND TRIM(country_name) <> ''
    GROUP BY TRIM(country_name)
  ),
  agg AS (
    SELECT COALESCE(SUM(cnt), 0)::BIGINT AS total FROM counts
  ),
  top AS (
    SELECT country, cnt
    FROM counts
    ORDER BY cnt DESC, country ASC
    LIMIT 1
  )
  SELECT agg.total, COALESCE(top.country, ''), COALESCE(top.cnt, 0)::BIGINT
  FROM agg
  LEFT JOIN top ON true;
$$;

-- =============================================
-- TRIGGERS
-- =============================================

-- updated_at triggers (existing tables)
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_technicians_updated_at BEFORE UPDATE ON technicians
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_updated_at BEFORE UPDATE ON customer
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_equipments_updated_at BEFORE UPDATE ON equipments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_quotation_updated_at BEFORE UPDATE ON sales_quotation
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_order_updated_at BEFORE UPDATE ON sales_order
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_service_call_updated_at BEFORE UPDATE ON service_call
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_job_schedule_updated_at BEFORE UPDATE ON job_schedule
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_technician_jobs_updated_at BEFORE UPDATE ON technician_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_task_completions_updated_at BEFORE UPDATE ON task_completions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_followups_updated_at BEFORE UPDATE ON followups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scheduling_windows_updated_at BEFORE UPDATE ON scheduling_windows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_company_details_updated_at BEFORE UPDATE ON company_details
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_company_memos_updated_at BEFORE UPDATE ON company_memos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_google_forms_updated_at BEFORE UPDATE ON google_forms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_job_media_updated_at BEFORE UPDATE ON job_media
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- updated_at triggers (new tables)
CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_address_details_updated_at BEFORE UPDATE ON customer_address_details
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_notes_updated_at BEFORE UPDATE ON customer_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_creation_drafts_updated_at BEFORE UPDATE ON customer_creation_drafts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_profiles_updated_at BEFORE UPDATE ON payment_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sap_lead_updated_at BEFORE UPDATE ON sap_lead
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_job_migration_upload_updated_at BEFORE UPDATE ON job_migration_upload
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_job_incentive_results_updated_at BEFORE UPDATE ON job_incentive_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_triggers_updated_at BEFORE UPDATE ON email_triggers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_templates_updated_at BEFORE UPDATE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_trigger_bindings_updated_at BEFORE UPDATE ON email_trigger_bindings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_template_overrides_updated_at BEFORE UPDATE ON email_template_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_technician_employment_details_updated_at BEFORE UPDATE ON technician_employment_details
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_technician_access_settings_updated_at BEFORE UPDATE ON technician_access_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_technician_payroll_profiles_updated_at BEFORE UPDATE ON technician_payroll_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_job_payments_updated_at BEFORE UPDATE ON job_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payroll_periods_updated_at BEFORE UPDATE ON payroll_periods
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payroll_entries_updated_at BEFORE UPDATE ON payroll_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payroll_disbursements_updated_at BEFORE UPDATE ON payroll_disbursements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_technician_schedules_updated_at BEFORE UPDATE ON technician_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_technician_documents_updated_at BEFORE UPDATE ON technician_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_technician_other_details_updated_at BEFORE UPDATE ON technician_other_details
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_calendar_events_updated_at BEFORE UPDATE ON calendar_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_migration_upload_updated_at BEFORE UPDATE ON user_migration_upload
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Attendance duration
CREATE TRIGGER calculate_duration_before_update BEFORE UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION calculate_attendance_duration();

-- Technician hours on job completion
CREATE TRIGGER trg_technician_hours_on_job_completion
  AFTER UPDATE ON technician_jobs
  FOR EACH ROW
  EXECUTE FUNCTION fn_create_technician_hours_on_completion();

-- Leads full_name / address auto-population
CREATE TRIGGER trigger_update_full_name_from_parts
    BEFORE INSERT OR UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION update_full_name_from_parts();

-- Job technician admin messages updated_at
CREATE TRIGGER trigger_update_job_technician_admin_messages_updated_at
    BEFORE UPDATE ON job_technician_admin_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_job_technician_admin_messages_updated_at();

-- =============================================
-- ENUM VALUES REFERENCE
-- =============================================
-- User Status: ACTIVE, INACTIVE, SUSPENDED
-- User Role: ADMIN, TECHNICIAN, CUSTOMER
-- Service Call Status: OPEN, IN_PROGRESS, CLOSED, CANCELLED
-- Priority: LOW, MEDIUM, HIGH, URGENT
-- Job Status: SAP U_JobStatusID numeric strings (e.g. 554, 555, -5) or legacy text (PENDING, CREATED, etc.)
--   Column: VARCHAR(32) DEFAULT 'PENDING' — NO CHECK constraint (allows SAP numeric IDs)
-- Lead Status: PENDING, CONTACTED, CONVERTED, REJECTED, COMPLETED, Portal
-- Customer Source: portal, sap (NULL = legacy)
-- Assignment Status: ASSIGNED, STARTED, COMPLETED, CANCELLED
