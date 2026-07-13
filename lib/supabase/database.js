/**
 * Database service layer for Supabase
 * Provides abstraction for common database operations
 */

import { isJobStatusCompleted } from '../jobs/isJobStatusCompleted';

// Turbopack can compile `require('./server')` to an empty stub when this module is bundled
// (see ES interop elsewhere). Instantiate admin clients directly from @supabase/supabase-js
// instead — same credentials as lib/supabase/server.js.

function getCreateClientFn() {
  const mod = require('@supabase/supabase-js');
  return mod.createClient;
}

let _supabaseAdminSingleton = null;

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase admin credentials are not configured');
  }

  if (!_supabaseAdminSingleton) {
    const createClient = getCreateClientFn();
    _supabaseAdminSingleton = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return _supabaseAdminSingleton;
}

function getSupabaseAdminFactory() {
  return () => getSupabaseAdminClient();
}

function createServerClientBound(accessToken) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase credentials are not configured');
  }

  const createClient = getCreateClientFn();

  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Get the appropriate Supabase client
 * @param {string} accessToken - Optional access token for user-specific client
 * @returns {Object} Supabase client
 */
function getClient(accessToken = null) {
  if (typeof window !== 'undefined') {
    // Client-side: use user client
    const { getSupabaseClient } = require('./client');
    return getSupabaseClient();
  }

  // Server-side: use admin client or user client with token
  if (accessToken) {
    return createServerClientBound(accessToken);
  }

  return getSupabaseAdminFactory()();
}

/**
 * Generic query builder for Supabase
 */
export class SupabaseQuery {
  constructor(table, client = null) {
    this.table = table;
    this.client = client || getClient();
    this.query = this.client.from(table);
  }

  select(columns = '*') {
    this.query = this.query.select(columns);
    return this;
  }

  where(column, operator, value) {
    if (operator === '==') {
      this.query = this.query.eq(column, value);
    } else if (operator === '!=') {
      this.query = this.query.neq(column, value);
    } else if (operator === '>') {
      this.query = this.query.gt(column, value);
    } else if (operator === '>=') {
      this.query = this.query.gte(column, value);
    } else if (operator === '<') {
      this.query = this.query.lt(column, value);
    } else if (operator === '<=') {
      this.query = this.query.lte(column, value);
    } else if (operator === 'in') {
      this.query = this.query.in(column, value);
    } else if (operator === 'contains') {
      this.query = this.query.contains(column, value);
    }
    return this;
  }

  orderBy(column, ascending = true) {
    this.query = this.query.order(column, { ascending });
    return this;
  }

  limit(count) {
    this.query = this.query.limit(count);
    return this;
  }

  async execute() {
    return await this.query;
  }
}

/** Slim user profile for session validation, bootstrap, and profile lookups. */
export const USER_SESSION_SELECT = `
  id,
  username,
  role,
  status,
  current_session_id,
  updated_at,
  technicians (
    id,
    full_name,
    avatar_url
  )
`;

/** @deprecated Use USER_SESSION_SELECT */
export const USER_PROFILE_SELECT = USER_SESSION_SELECT;

/**
 * User operations
 */
export const userService = {
  async findByIdForSession(id, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('users')
      .select(USER_SESSION_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('❌ Database error in findByIdForSession:', {
        message: error.message,
        code: error.code,
        userId: id,
      });
      throw error;
    }

    return data;
  },

  async findByEmailForSession(email, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('users')
      .select(USER_SESSION_SELECT)
      .eq('username', email)
      .is('deleted_at', null)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('❌ Database error in findByEmailForSession:', {
        message: error.message,
        code: error.code,
      });
      throw error;
    }

    return data;
  },

  async findByEmail(email, client = null) {
    return this.findByEmailForSession(email, client);
  },

  async findById(id, client = null) {
    return this.findByIdForSession(id, client);
  },

  async findByUid(uid, client = null) {
    // In Supabase, we'll use the user's auth.uid which maps to users.id
    return this.findById(uid, client);
  },

  async getAll(client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('users')
      .select('*, technicians(*)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async create(userData, client = null) {
    const db = client || getClient();
    
    // Ensure timestamp fields are not explicitly set to null
    // Let database defaults handle created_at and updated_at
    const sanitizedData = { ...userData };
    if (sanitizedData.created_at === null || sanitizedData.created_at === 'null') {
      delete sanitizedData.created_at;
    }
    if (sanitizedData.updated_at === null || sanitizedData.updated_at === 'null') {
      delete sanitizedData.updated_at;
    }
    
    const { data, error } = await db
      .from('users')
      .insert(sanitizedData)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Database error in userService.create:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  },

  async update(id, updates, client = null) {
    const db = client || getClient();
    
    // Ensure timestamp fields are not explicitly set to null
    // Let database triggers handle updated_at
    const sanitizedUpdates = { ...updates };
    if (sanitizedUpdates.created_at === null || sanitizedUpdates.created_at === 'null') {
      delete sanitizedUpdates.created_at;
    }
    if (sanitizedUpdates.updated_at === null || sanitizedUpdates.updated_at === 'null') {
      // Don't delete updated_at - let the trigger handle it
      // But ensure it's not set to null string
      delete sanitizedUpdates.updated_at;
    }
    
    const { data, error } = await db
      .from('users')
      .update(sanitizedUpdates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Database error in userService.update:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        updateData: sanitizedUpdates
      });
      throw error;
    }
    return data;
  },

  async delete(id, client = null) {
    const db = client || getClient();
    
    // Soft delete by setting deleted_at timestamp
    const { data, error } = await db
      .from('users')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Database error in userService.delete:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        userId: id
      });
      throw error;
    }
    return data;
  }
};

/**
 * When a job is marked completed, backfill technician_jobs timestamps so incentive rollups
 * (completed_at − started_at) are populated even if only assignment_status was updated.
 * Does not overwrite existing started_at / completed_at.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} jobId
 * @param {{ scheduled_start?: string|null, created_at?: string|null }} jobRow
 */
async function syncTechnicianJobsOnJobCompleted(db, jobId, jobRow) {
  const nowIso = new Date().toISOString();
  const fallbackStart = jobRow?.scheduled_start || jobRow?.created_at || nowIso;

  const { data: rows, error } = await db
    .from("technician_jobs")
    .select("id, started_at, completed_at")
    .eq("job_id", jobId)
    .is("deleted_at", null);

  if (error) {
    console.error("syncTechnicianJobsOnJobCompleted: fetch technician_jobs", error);
    return;
  }

  for (const row of rows || []) {
    const patch = {
      assignment_status: "COMPLETED",
      updated_at: nowIso,
    };
    if (!row.completed_at) patch.completed_at = nowIso;
    if (!row.started_at) patch.started_at = fallbackStart;

    const { error: upErr } = await db.from("technician_jobs").update(patch).eq("id", row.id);
    if (upErr) {
      console.error("syncTechnicianJobsOnJobCompleted: update technician_job", row.id, upErr);
    }
  }
}

/** Flat job row + direct relations — no tasks, technician_jobs, or equipments. */
export const JOB_HEADER_SELECT = `
  *,
  customer:customer_id(*),
  location:location_id(*),
  service_call:service_call_id(*),
  sales_order:sales_order_id(document_number, document_status, document_total),
  contact:contact_id(id, first_name, middle_name, last_name, tel1, tel2, email, customer_location_id),
  payment_profile:payment_profile_id(*),
  created_by_user:created_by(
    id,
    username
  )
`;

/** job_tasks rows for a single job (list/detail task panes). */
export const JOB_TASKS_SELECT = `
  *,
  completed_by_technician:technicians!completed_by_technician_id(
    id,
    full_name
  )
`;

const JOB_TECHNICIAN_JOBS_SELECT = `
  *,
  technician:technician_id(
    *,
    user:users!technicians_user_id_fkey(*)
  )
`;

const JOB_DETAIL_SELECT = `
  ${JOB_HEADER_SELECT},
  technician_jobs(${JOB_TECHNICIAN_JOBS_SELECT}),
  job_tasks(${JOB_TASKS_SELECT}),
  job_equipments(
    *,
    equipment:equipment_id(*)
  )
`;

function filterActiveTechnicianJobs(data) {
  if (data && Array.isArray(data.technician_jobs)) {
    data.technician_jobs = data.technician_jobs.filter((tj) => tj.deleted_at == null);
  }
  return data;
}

/**
 * Job operations
 */
export const jobService = {
  async getAll(filters = {}, client = null) {
    const db = client || getClient();
    let query = db
      .from('jobs')
      .select(`
        *,
        customer:customer_id(*),
        location:location_id(*),
        service_call:service_call_id(*),
        job_tasks(
          *,
          completed_by_technician:technicians!completed_by_technician_id(
            id,
            full_name
          )
        ),
        job_contact_type(*),
        technician_jobs(
          *,
          technician:technician_id(
            *,
            user:user_id(*)
          )
        )
      `)
      .is('deleted_at', null);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.priority) {
      query = query.eq('priority', filters.priority);
    }
    if (filters.customer_id) {
      query = query.eq('customer_id', filters.customer_id);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async findById(id, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('jobs')
      .select(JOB_DETAIL_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return filterActiveTechnicianJobs(data);
  },

  /** Header + direct relations only — for realtime header patches (no nested graph). */
  async findHeaderById(id, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('jobs')
      .select(JOB_HEADER_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data;
  },

  /** Tasks for one job — slim fetch for TaskList and task-only realtime. */
  async findTasksByJobId(jobId, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('job_tasks')
      .select(JOB_TASKS_SELECT)
      .eq('job_id', jobId)
      .order('task_order', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async findByJobNumber(jobNumber, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('jobs')
      .select(JOB_DETAIL_SELECT)
      .eq('job_number', jobNumber)
      .is('deleted_at', null)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return filterActiveTechnicianJobs(data);
  },

  async create(jobData, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('jobs')
      .insert(jobData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async update(id, updates, client = null) {
    const db = client || getClient();
    const updateData = { ...updates };
    if (updateData.updated_at === undefined) {
      updateData.updated_at = new Date().toISOString();
    }

    const { data, error } = await db
      .from('jobs')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;

    if (data?.status && isJobStatusCompleted(data.status)) {
      try {
        await syncTechnicianJobsOnJobCompleted(db, id, data);
      } catch (e) {
        console.error('syncTechnicianJobsOnJobCompleted failed', e);
      }
    }

    try {
      const { refreshTechnicianHoursForJobId } = await import('./technicianHours');
      const rh = await refreshTechnicianHoursForJobId(db, id);
      if (rh?.error) console.error('refreshTechnicianHoursForJobId failed', rh.error);
    } catch (e) {
      console.error('refreshTechnicianHoursForJobId failed', e);
    }

    return data;
  },

  /**
   * Find job by ID with all related data including media and signatures
   * @param {string} id - Job ID
   * @param {Object} client - Optional Supabase client
   * @param {Object} options - Options for what to include
   * @returns {Promise<Object>} Job data with related information
   */
  async findByIdWithMedia(id, client = null, options = { includeMedia: true, includeSignatures: true }) {
    const db = client || getClient();
    const jobData = await this.findById(id, client);
    
    if (!jobData) {
      return null;
    }

    // Fetch job media if requested
    if (options.includeMedia) {
      try {
        const { data: jobMedia } = await db
          .from('job_media')
          .select(`
            *,
            created_by_user:created_by(id, username)
          `)
          .eq('job_id', id)
          .order('created_at', { ascending: false });
        
        // Enrich job media with full_name from technicians
        if (jobMedia && jobMedia.length > 0) {
          const userIds = [...new Set(jobMedia
            .map(img => img.created_by)
            .filter(Boolean))];
          
          if (userIds.length > 0) {
            try {
              const { data: technicians } = await db
                .from('technicians')
                .select('user_id, full_name')
                .in('user_id', userIds);
              
              if (technicians) {
                const technicianMap = {};
                technicians.forEach(tech => {
                  technicianMap[tech.user_id] = tech.full_name;
                });
                
                jobMedia.forEach(img => {
                  if (img.created_by) {
                    img.created_by_full_name = technicianMap[img.created_by] 
                      || img.created_by_user?.username 
                      || img.created_by;
                  }
                });
              }
            } catch (techError) {
              console.warn('Error fetching technician full names for job media:', techError);
            }
          }
        }
        
        jobData.job_media = jobMedia || [];
        jobData.job_images = jobMedia || []; // Alias for compatibility
      } catch (error) {
        console.warn('Error fetching job media:', error);
        jobData.job_media = [];
        jobData.job_images = [];
      }
    }

    // Fetch job signatures if requested
    if (options.includeSignatures && jobData.technician_jobs) {
      try {
        const technicianJobIds = jobData.technician_jobs.map(tj => tj.id);
        if (technicianJobIds.length > 0) {
          const { data: jobSignatures } = await db
            .from('job_signatures')
            .select('*')
            .in('technician_job_id', technicianJobIds);
          
          jobData.job_signatures = jobSignatures || [];
        } else {
          jobData.job_signatures = [];
        }
      } catch (error) {
        console.warn('Error fetching job signatures:', error);
        jobData.job_signatures = [];
      }
    }

    return jobData;
  }
};

/**
 * Customer operations
 */
export const customerService = {
  async getAll(client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('customer')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async findByCode(customerCode, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('customer')
      .select(`
        *,
        contacts(*),
        customer_location(*),
        locations(*),
        equipments(*)
      `)
      .eq('customer_code', customerCode)
      .is('deleted_at', null)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    return data;
  },

  async findById(id, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('customer')
      .select(`
        *,
        contacts(*),
        customer_location(*),
        locations(*),
        equipments(*)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    
    return data;
  },

  async create(customerData, client = null) {
    const db = client || getClient();
    
    // Ensure timestamp fields are not explicitly set to null
    const sanitizedData = { ...customerData };
    if (sanitizedData.created_at === null || sanitizedData.created_at === 'null') {
      delete sanitizedData.created_at;
    }
    if (sanitizedData.updated_at === null || sanitizedData.updated_at === 'null') {
      delete sanitizedData.updated_at;
    }
    
    const { data, error } = await db
      .from('customer')
      .insert(sanitizedData)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Database error in customerService.create:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  },

  async update(id, updates, client = null) {
    const db = client || getClient();
    const sanitizedUpdates = { ...updates };
    if (sanitizedUpdates.created_at === null || sanitizedUpdates.created_at === 'null') delete sanitizedUpdates.created_at;
    if (sanitizedUpdates.updated_at === null || sanitizedUpdates.updated_at === 'null') delete sanitizedUpdates.updated_at;

    const { data, error } = await db
      .from('customer')
      .update(sanitizedUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('❌ Database error in customerService.update:', { message: error.message, code: error.code });
      throw error;
    }
    return data;
  },

  async delete(id, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('customer')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('❌ Database error in customerService.delete:', { message: error.message, code: error.code });
      throw error;
    }
    return data;
  },

  async getGenericCustomers(client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('customer')
      .select('id, customer_code, customer_name, customer_address, phone_number, email, synced_to_sap_at, sap_card_code, lead_id, block, unit, notes, created_at, updated_at')
      .eq('source', 'portal')
      .is('deleted_at', null)
      .order('customer_name', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  /**
   * SAP / imported customers in portal DB (master list): source = 'sap' or legacy NULL.
   * Used for job create "SAP Customers" dropdown without calling SAP Service Layer.
   *
   * PostgREST caps each response at 1000 rows; this method pages with `.range()` until a short
   * page or empty result (safety: at most 500 pages ≈ 500k rows).
   */
  async getSapMasterlistCustomers(client = null) {
    const db = client || getClient();
    const PAGE = 1000;
    const MAX_PAGES = 500;
    const all = [];

    for (let p = 0; p < MAX_PAGES; p += 1) {
      const from = p * PAGE;
      const { data, error } = await db
        .from('customer')
        .select(
          'id, customer_code, customer_name, customer_address, phone_number, email, source, sap_card_code, synced_to_sap_at, created_at, updated_at'
        )
        .or('source.eq.sap,source.is.null')
        .is('deleted_at', null)
        .order('customer_code', { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }

    return all;
  },

  /**
   * SAP leads in portal DB (master list): public.sap_lead from Excel / migrate:aifm-sap-leads.
   * Paged like getSapMasterlistCustomers (PostgREST 1000-row cap per request).
   */
  async getSapMasterlistLeads(client = null) {
    const db = client || getClient();
    const PAGE = 1000;
    const MAX_PAGES = 500;
    const all = [];

    for (let p = 0; p < MAX_PAGES; p += 1) {
      const from = p * PAGE;
      const { data, error } = await db
        .from('sap_lead')
        .select('id, lead_code, lead_name, lead_address, phone_number, email, created_at, updated_at')
        .is('deleted_at', null)
        .order('lead_code', { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
    }

    return all;
  },

  /**
   * Get next portal customer code in format CP00001, CP00002, ...
   * Used for generic/portal customers, leads converted to customers, and AIFM import placeholders.
   * Counts any existing `customer_code` matching `^CP\\d+$` (not only source=portal) so numbering stays unique.
   * @param {Object} client - Supabase client (required for server-side)
   * @returns {Promise<string>} Next CP code e.g. CP00001
   */
  async getNextPortalCardCode(client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('customer')
      .select('customer_code')
      .ilike('customer_code', 'CP%')
      .is('deleted_at', null);

    if (error) throw error;

    const cpMatch = /^CP(\d+)$/i;
    let nextNum = 1;
    if (data && data.length > 0) {
      const numbers = data
        .map((r) => {
          const m = (r.customer_code || '').match(cpMatch);
          return m ? parseInt(m[1], 10) : 0;
        })
        .filter((n) => n > 0);
      if (numbers.length > 0) nextNum = Math.max(...numbers) + 1;
    }
    return 'CP' + String(nextNum).padStart(5, '0');
  },

  async findOrCreate(customerCode, customerName, additionalData = {}, client = null) {
    const db = client || getClient();
    
    // Try to find existing customer
    let customer = await this.findByCode(customerCode, client);
    
    if (customer) {
      return customer;
    }
    
    // Create new customer if not found
    const customerData = {
      customer_code: customerCode,
      customer_name: customerName,
      ...additionalData
    };
    
    return await this.create(customerData, client);
  },

  /**
   * Check if customers exist by their codes (simplified query without joins)
   * @param {Array} customerCodes - Array of customer codes to check
   * @param {Object} client - Optional Supabase client
   * @returns {Set} Set of existing customer codes
   */
  async checkExistingCustomers(customerCodes = [], client = null) {
    const db = client || getClient();
    
    if (!db || !Array.isArray(customerCodes) || customerCodes.length === 0) {
      return new Set();
    }

    try {
      // Use a simple query without joins to avoid 406 errors
      const { data, error } = await db
        .from('customer')
        .select('customer_code')
        .in('customer_code', customerCodes)
        .is('deleted_at', null);

      if (error) {
        console.error('Error checking existing customers:', error);
        return new Set();
      }

      return new Set((data || []).map(c => c.customer_code));
    } catch (error) {
      console.error('Error checking existing customers:', error);
      return new Set();
    }
  },

  /**
   * Save customers from SAP format to Supabase
   * Only saves if customer doesn't exist (based on customer_code)
   * @param {Array} sapCustomers - Array of customer objects from SAP
   * @param {Object} client - Optional Supabase client
   * @returns {Object} Result with saved count and skipped count
   */
  async saveCustomersFromSAP(sapCustomers = [], client = null) {
    const db = client || getClient();
    
    if (!db) {
      throw new Error('Supabase client not available');
    }

    if (!Array.isArray(sapCustomers) || sapCustomers.length === 0) {
      return {
        saved: 0,
        skipped: 0,
        errors: [],
        message: 'No customers to save'
      };
    }

    // Extract all customer codes first
    const customerCodes = sapCustomers
      .map(c => c.CardCode)
      .filter(code => code); // Remove any null/undefined codes

    if (customerCodes.length === 0) {
      return {
        saved: 0,
        skipped: 0,
        errors: [],
        message: 'No valid customer codes found'
      };
    }

    // Batch check for existing customers (check in chunks of 100 to avoid URL length issues)
    const existingCodes = new Set();
    const checkBatchSize = 100;
    
    for (let i = 0; i < customerCodes.length; i += checkBatchSize) {
      const batch = customerCodes.slice(i, i + checkBatchSize);
      const existingBatch = await this.checkExistingCustomers(batch, client);
      existingBatch.forEach(code => existingCodes.add(code));
    }

    let savedCount = 0;
    let skippedCount = 0;
    const errors = [];

    // Process customers in batches for insertion
    const insertBatchSize = 50; // Insert in batches of 50
    const customersToInsert = [];

    for (const sapCustomer of sapCustomers) {
      try {
        const customerCode = sapCustomer.CardCode;
        
        if (!customerCode) {
          errors.push({
            customer: sapCustomer.CardName || 'Unknown',
            error: 'Missing customer code (CardCode)'
          });
          continue;
        }

        // Check if customer already exists (using our pre-fetched set)
        if (existingCodes.has(customerCode)) {
          skippedCount++;
          continue;
        }

        // Format address from SAP data
        let formattedAddress = '';
        if (sapCustomer.BPAddresses && sapCustomer.BPAddresses.length > 0) {
          // Use the default billing address or first address
          const defaultAddress = sapCustomer.BPAddresses.find(addr => addr.Default === 'Y') || sapCustomer.BPAddresses[0];
          const addressParts = [
            defaultAddress.BuildingFloorRoom || defaultAddress.AddressName,
            defaultAddress.Street,
            defaultAddress.City,
            defaultAddress.ZipCode,
            defaultAddress.Country === 'SG' ? 'Singapore' : defaultAddress.Country
          ].filter(Boolean);
          formattedAddress = addressParts.join(', ');
        } else {
          // Fallback to basic address fields
          const addressParts = [
            sapCustomer.Building,
            sapCustomer.Street,
            sapCustomer.City,
            sapCustomer.ZipCode,
            sapCustomer.Country === 'SG' ? 'Singapore' : sapCustomer.Country
          ].filter(Boolean);
          formattedAddress = addressParts.join(', ') || sapCustomer.Address || sapCustomer.MailAddress || '';
        }

        // Prepare customer data for Supabase
        const customerData = {
          customer_code: customerCode,
          customer_name: sapCustomer.CardName || '',
          customer_address: formattedAddress,
          phone_number: sapCustomer.Phone1 || sapCustomer.Phone2 || null,
          email: sapCustomer.EmailAddress || null
        };

        customersToInsert.push(customerData);

        // Insert in batches
        if (customersToInsert.length >= insertBatchSize) {
          try {
            const { error: insertError } = await db
              .from('customer')
              .insert(customersToInsert);

            if (insertError) {
              // If batch insert fails, try individual inserts
              console.warn('Batch insert failed, trying individual inserts:', insertError);
              for (const customer of customersToInsert) {
                try {
                  await this.create(customer, client);
                  savedCount++;
                } catch (individualError) {
                  errors.push({
                    customer: customer.customer_name || customer.customer_code,
                    error: individualError.message || 'Insert failed'
                  });
                }
              }
            } else {
              savedCount += customersToInsert.length;
            }
            customersToInsert.length = 0; // Clear the array
          } catch (batchError) {
            console.error('Batch insert error:', batchError);
            errors.push({
              customer: 'Batch insert',
              error: batchError.message || 'Batch insert failed'
            });
            customersToInsert.length = 0;
          }
        }

      } catch (error) {
        console.error(`Error processing customer ${sapCustomer.CardCode || 'Unknown'}:`, error);
        errors.push({
          customer: sapCustomer.CardName || sapCustomer.CardCode || 'Unknown',
          error: error.message || 'Unknown error'
        });
      }
    }

    // Insert any remaining customers
    if (customersToInsert.length > 0) {
      try {
        const { error: insertError } = await db
          .from('customer')
          .insert(customersToInsert);

        if (insertError) {
          // If batch insert fails, try individual inserts
          for (const customer of customersToInsert) {
            try {
              await this.create(customer, client);
              savedCount++;
            } catch (individualError) {
              errors.push({
                customer: customer.customer_name || customer.customer_code,
                error: individualError.message || 'Insert failed'
              });
            }
          }
        } else {
          savedCount += customersToInsert.length;
        }
      } catch (batchError) {
        console.error('Final batch insert error:', batchError);
        errors.push({
          customer: 'Final batch insert',
          error: batchError.message || 'Batch insert failed'
        });
      }
    }

    return {
      saved: savedCount,
      skipped: skippedCount,
      errors,
      total: sapCustomers.length,
      message: `Saved ${savedCount} customers, skipped ${skippedCount} existing customers`
    };
  }
};

/**
 * Lead operations
 */
export const leadService = {
  async getAll(filters = {}, client = null, limit = null, offset = 0) {
    const db = client || getClient();
    let query = db
      .from('leads')
      .select(`
        *,
        customer:customer_id(
          id,
          customer_code,
          customer_name,
          phone_number,
          block,
          unit,
          synced_to_sap_at,
          sap_card_code
        )
      `)
      .is('deleted_at', null);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.source) {
      query = query.eq('source', filters.source);
    }
    if (filters.email) {
      query = query.ilike('email', `%${filters.email}%`);
    }
    if (filters.search) {
      query = query.or(`full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,handphone.ilike.%${filters.search}%`);
    }

    query = query.order('submitted_at', { ascending: false });

    // Add pagination if limit is specified
    if (limit && limit > 0) {
      query = query.range(offset, offset + limit - 1);
    }

    const { data, error } = await query;
    if (error) {
      console.error('❌ Database error in leadService.getAll:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  },

  async findById(id, client = null) {
    const idStr = String(id || '').trim();
    if (!idStr || idStr.startsWith('cust-')) {
      return null;
    }
    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(idStr)) {
      return null;
    }

    const db = client || getClient();
    const { data, error } = await db
      .from('leads')
      .select(`
        *,
        customer:customer_id(
          id,
          customer_code,
          customer_name,
          phone_number,
          block,
          unit,
          synced_to_sap_at,
          sap_card_code
        )
      `)
      .eq('id', idStr)
      .is('deleted_at', null)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('❌ Database error in leadService.findById:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        leadId: id
      });
      throw error;
    }
    
    return data;
  },

  async findByEmail(email, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('leads')
      .select('*')
      .eq('email', email)
      .is('deleted_at', null)
      .order('submitted_at', { ascending: false });
    
    if (error && error.code !== 'PGRST116') {
      console.error('❌ Database error in leadService.findByEmail:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    
    return data || [];
  },

  async create(leadData, client = null) {
    const db = client || getClient();
    
    // Ensure timestamp fields are not explicitly set to null
    const sanitizedData = { ...leadData };
    if (sanitizedData.created_at === null || sanitizedData.created_at === 'null') {
      delete sanitizedData.created_at;
    }
    if (sanitizedData.updated_at === null || sanitizedData.updated_at === 'null') {
      delete sanitizedData.updated_at;
    }
    if (sanitizedData.submitted_at === null || sanitizedData.submitted_at === 'null') {
      delete sanitizedData.submitted_at;
    }
    
    // Convert string dates to proper format if needed
    const dateFields = ['first_service_date', 'second_service_date', 'third_service_date', 'fourth_service_date'];
    dateFields.forEach(field => {
      if (sanitizedData[field] && sanitizedData[field] === '-') {
        delete sanitizedData[field];
      }
    });

    // Convert boolean strings to booleans
    if (typeof sanitizedData.agreed_to_terms === 'string') {
      sanitizedData.agreed_to_terms = sanitizedData.agreed_to_terms === 'Yes' || sanitizedData.agreed_to_terms === 'true';
    }
    if (typeof sanitizedData.personal_info_consent === 'string') {
      sanitizedData.personal_info_consent = sanitizedData.personal_info_consent === 'Yes' || sanitizedData.personal_info_consent === 'true';
    }
    
    const { data, error } = await db
      .from('leads')
      .insert(sanitizedData)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Database error in leadService.create:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    return data;
  },

  async update(id, updates, client = null) {
    const db = client || getClient();
    
    // Ensure timestamp fields are not explicitly set to null
    const sanitizedUpdates = { ...updates };
    if (sanitizedUpdates.created_at === null || sanitizedUpdates.created_at === 'null') {
      delete sanitizedUpdates.created_at;
    }
    if (sanitizedUpdates.updated_at === null || sanitizedUpdates.updated_at === 'null') {
      delete sanitizedUpdates.updated_at;
    }

    // Convert string dates to proper format if needed
    const dateFields = ['first_service_date', 'second_service_date', 'third_service_date', 'fourth_service_date'];
    dateFields.forEach(field => {
      if (sanitizedUpdates[field] && sanitizedUpdates[field] === '-') {
        delete sanitizedUpdates[field];
      }
    });

    // Convert boolean strings to booleans
    if (typeof sanitizedUpdates.agreed_to_terms === 'string') {
      sanitizedUpdates.agreed_to_terms = sanitizedUpdates.agreed_to_terms === 'Yes' || sanitizedUpdates.agreed_to_terms === 'true';
    }
    if (typeof sanitizedUpdates.personal_info_consent === 'string') {
      sanitizedUpdates.personal_info_consent = sanitizedUpdates.personal_info_consent === 'Yes' || sanitizedUpdates.personal_info_consent === 'true';
    }
    
    const { data, error } = await db
      .from('leads')
      .update(sanitizedUpdates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Database error in leadService.update:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        updateData: sanitizedUpdates
      });
      throw error;
    }
    return data;
  },

  async delete(id, client = null) {
    const db = client || getClient();
    
    // Soft delete by setting deleted_at timestamp
    const { data, error } = await db
      .from('leads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Database error in leadService.delete:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        leadId: id
      });
      throw error;
    }
    return data;
  },

  async convertToCustomer(leadId, customerId, client = null) {
    const db = client || getClient();
    
    const { data, error } = await db
      .from('leads')
      .update({
        customer_id: customerId,
        status: 'CONVERTED',
        converted_at: new Date().toISOString()
      })
      .eq('id', leadId)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Database error in leadService.convertToCustomer:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        leadId,
        customerId
      });
      throw error;
    }
    return data;
  },

  async bulkCreate(leadsArray, client = null) {
    const db = client || getClient();
    
    if (!Array.isArray(leadsArray) || leadsArray.length === 0) {
      return { created: 0, errors: [] };
    }

    // Transform and sanitize all leads
    const sanitizedLeads = leadsArray.map(lead => {
      const sanitized = { ...lead };
      
      // Remove null timestamp fields
      if (sanitized.created_at === null || sanitized.created_at === 'null') {
        delete sanitized.created_at;
      }
      if (sanitized.updated_at === null || sanitized.updated_at === 'null') {
        delete sanitized.updated_at;
      }
      if (sanitized.submitted_at === null || sanitized.submitted_at === 'null') {
        delete sanitized.submitted_at;
      }

      // Convert date fields
      const dateFields = ['first_service_date', 'second_service_date', 'third_service_date', 'fourth_service_date'];
      dateFields.forEach(field => {
        if (sanitized[field] && sanitized[field] === '-') {
          delete sanitized[field];
        }
      });

      // Convert boolean strings to booleans
      if (typeof sanitized.agreed_to_terms === 'string') {
        sanitized.agreed_to_terms = sanitized.agreed_to_terms === 'Yes' || sanitized.agreed_to_terms === 'true';
      }
      if (typeof sanitized.personal_info_consent === 'string') {
        sanitized.personal_info_consent = sanitized.personal_info_consent === 'Yes' || sanitized.personal_info_consent === 'true';
      }

      return sanitized;
    });

    // Try bulk insert, but handle unique constraint violations
    let created = 0;
    const errors = [];
    
    // Insert one by one to handle duplicates gracefully
    for (const lead of sanitizedLeads) {
      try {
        const { data, error } = await db
          .from('leads')
          .insert(lead)
          .select()
          .single();
        
        if (error) {
          // If it's a unique constraint violation (duplicate), skip it
          if (error.code === '23505' || error.message.includes('duplicate') || error.message.includes('unique')) {
            errors.push({
              email: lead.email,
              responseId: lead.google_form_response_id,
              error: 'Duplicate entry (already exists)'
            });
            continue;
          }
          throw error;
        }
        
        created++;
      } catch (err) {
        // Handle unique constraint violations gracefully
        if (err.code === '23505' || err.message.includes('duplicate') || err.message.includes('unique')) {
          errors.push({
            email: lead.email,
            responseId: lead.google_form_response_id,
            error: 'Duplicate entry (already exists)'
          });
        } else {
          errors.push({
            email: lead.email,
            responseId: lead.google_form_response_id,
            error: err.message || 'Unknown error'
          });
        }
      }
    }
    
    return {
      created,
      errors: errors.length > 0 ? errors : undefined
    };
  }
};

/**
 * Notification operations
 */
export const notificationService = {
  /**
   * @param {string[]} workerIds - `notifications.worker_id` values (public.users.id). Multiple cookies
   *   may differ (e.g. auth uid vs technician id); OR them and include broadcast rows (null worker).
   */
  async getByWorkerIds(workerIds, limit = 10, client = null) {
    const db = client || getClient();
    const unique = [...new Set((workerIds || []).filter(Boolean))];
    if (!unique.length) {
      return [];
    }

    const orClause = `${unique.map((id) => `worker_id.eq.${id}`).join(',')},worker_id.is.null`;

    const { data, error } = await db
      .from('notifications')
      .select('*')
      .or(orClause)
      .eq('hidden', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (error.code === 'PGRST116' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('Could not find the table')) {
        console.warn('Notifications table does not exist yet. Please run the migration: lib/supabase/migrations/create_notifications_table.sql');
        return [];
      }
      throw error;
    }
    return data || [];
  },

  async getByWorkerId(workerId, limit = 10, client = null) {
    if (!workerId) return [];
    return this.getByWorkerIds([workerId], limit, client);
  }
};

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function sortMemosByPriorityThenDate(rows) {
  return [...(rows || [])].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 1;
    const pb = PRIORITY_RANK[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

function isMemoNotExpired(row) {
  if (!row.expires_at) return true;
  return new Date(row.expires_at) > new Date();
}

/**
 * Company memos (portal announcements — header ticker, sign-in, etc.)
 */
export const companyMemoService = {
  async listForHeaderTicker(client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('company_memos')
      .select(
        'id, subject, body, priority, expires_at, show_in_header, created_at, created_by, creator:users!company_memos_created_by_fkey ( username, technicians ( full_name ) )'
      )
      .eq('show_in_header', true)
      .is('deleted_at', null);

    if (error) {
      if (error.code === 'PGRST116' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('Could not find the table')) {
        console.warn('company_memos table missing or embed failed; run create_company_memos_table.sql', error.message);
        return [];
      }
      throw error;
    }
    const active = (data || []).filter(isMemoNotExpired);
    return sortMemosByPriorityThenDate(active);
  },

  async listForSignIn(client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('company_memos')
      .select(
        'id, subject, body, priority, expires_at, show_on_sign_in, created_at, creator:users!company_memos_created_by_fkey ( username, technicians ( full_name ) )'
      )
      .eq('show_on_sign_in', true)
      .is('deleted_at', null);

    if (error) {
      if (error.code === 'PGRST116' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('Could not find the table')) {
        console.warn('company_memos table missing or embed failed; run create_company_memos_table.sql', error.message);
        return [];
      }
      throw error;
    }
    const active = (data || []).filter(isMemoNotExpired);
    return sortMemosByPriorityThenDate(active);
  },

  /**
   * Portal release notes — memos in the Update Logs folder, newest first.
   * Includes expired memos (What's New is a permanent archive; ticker/sign-in still filter expiry).
   */
  async listForUpdateLogs(client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('company_memos')
      .select(
        'id, subject, body, priority, expires_at, folder, created_at, show_on_sign_in, show_in_header, creator:users!company_memos_created_by_fkey ( username, technicians ( full_name ) )'
      )
      .eq('folder', 'Update Logs')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === 'PGRST116' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('Could not find the table')) {
        console.warn('company_memos table missing or embed failed; run create_company_memos_table.sql', error.message);
        return [];
      }
      throw error;
    }
    return data || [];
  },

  async listAllForAdmin(client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('company_memos')
      .select(
        '*, creator:users!company_memos_created_by_fkey ( id, username )'
      )
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === 'PGRST116' || error.code === 'PGRST205' || error.message?.includes('does not exist') || error.message?.includes('Could not find the table')) {
        console.warn('company_memos table missing; run create_company_memos_table.sql');
        return [];
      }
      throw error;
    }
    return data || [];
  },

  async getById(id, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('company_memos')
      .select(
        '*, creator:users!company_memos_created_by_fkey ( id, username )'
      )
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async create(row, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('company_memos')
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id, updates, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('company_memos')
      .update(updates)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async softDelete(id, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('company_memos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};

/**
 * Follow-up operations
 */
export const followUpService = {
  async getByJobId(jobId, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('followups')
      .select(`
        *,
        user:user_id(
          id,
          username
        ),
        technician:technician_id(
          id,
          full_name,
          email
        )
      `)
      .eq('job_id', jobId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async create(followUpData, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('followups')
      .insert(followUpData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async update(id, updates, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('followups')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

/**
 * Job Media operations
 */
export const jobMediaService = {
  /**
   * Get all media for a job
   * @param {string} jobId - Job ID
   * @param {Object} client - Optional Supabase client
   * @param {Object} options - Options (mediaType, limit, etc.)
   * @returns {Promise<Array>} Array of media records
   */
  async getByJobId(jobId, client = null, options = {}) {
    const db = client || getClient();
    let query = db
      .from('job_media')
      .select(`
        *,
        created_by_user:created_by(id, username)
      `)
      .eq('job_id', jobId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (options.mediaType) {
      query = query.eq('media_type', options.mediaType);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching job media:', error);
      throw error;
    }
    
    // Fetch full_name from technicians for each created_by user
    if (data && data.length > 0) {
      const userIds = [...new Set(data
        .map(r => r.created_by)
        .filter(Boolean))];
      
      if (userIds.length > 0) {
        try {
          const { data: technicians } = await db
            .from('technicians')
            .select('user_id, full_name')
            .in('user_id', userIds);
          
          if (technicians) {
            const technicianMap = {};
            technicians.forEach(tech => {
              technicianMap[tech.user_id] = tech.full_name;
            });
            
            // Add full_name to each media record
            data.forEach(record => {
              if (record.created_by) {
                record.created_by_full_name = technicianMap[record.created_by] 
                  || record.created_by_user?.username 
                  || record.created_by;
              }
            });
          }
        } catch (techError) {
          console.warn('Error fetching technician full names for job media:', techError);
          // Continue without full_name, just use UUID or username
        }
      }
    }
    
    return data || [];
  },

  /**
   * Create a new media record
   * @param {Object} mediaData - Media data (job_id, image_url, media_type, filename, etc.)
   * @param {Object} client - Optional Supabase client
   * @returns {Promise<Object>} Created media record
   */
  async create(mediaData, client = null) {
    const db = client || getClient();
    
    const insertData = {
      job_id: mediaData.job_id,
      image_url: mediaData.image_url || mediaData.url,
      media_type: mediaData.media_type || 'image',
      created_at: new Date().toISOString(),
      description: mediaData.description || null,
      created_by: mediaData.created_by || null
    };

    // Only include filename if it exists (column might not exist before migration)
    if (mediaData.filename !== undefined) {
      insertData.filename = mediaData.filename;
    }

    // Only include technician_job_id if provided
    if (mediaData.technician_job_id) {
      insertData.technician_job_id = mediaData.technician_job_id;
    }

    // Include created_by if provided (required field)
    if (mediaData.created_by) {
      insertData.created_by = mediaData.created_by;
    }

    const { data, error } = await db
      .from('job_media')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      // If error is about missing filename column, try without it
      if (error.message && (error.message.includes('filename') || error.code === 'PGRST204')) {
        delete insertData.filename;
        const { data: retryData, error: retryError } = await db
          .from('job_media')
          .insert(insertData)
          .select()
          .single();
        
        if (retryError) {
          console.error('Error creating job media (retry):', retryError);
          throw retryError;
        }
        return retryData;
      }
      console.error('Error creating job media:', error);
      throw error;
    }
    
    return data;
  },

  /**
   * Update a media record
   * @param {string} id - Media record ID
   * @param {Object} updates - Update data
   * @param {Object} client - Optional Supabase client
   * @returns {Promise<Object>} Updated media record
   */
  async update(id, updates, client = null) {
    const db = client || getClient();
    
    const updateData = { ...updates };
    
    // Only include updated_at if column exists
    if (updateData.updated_at === undefined) {
      // Let trigger handle it if column exists
      try {
        updateData.updated_at = new Date().toISOString();
      } catch (e) {
        // Column might not exist, skip it
        delete updateData.updated_at;
      }
    }

    const { data, error } = await db
      .from('job_media')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating job media:', error);
      throw error;
    }
    
    return data;
  },

  /**
   * Delete a media record (soft delete if deleted_at exists, otherwise hard delete)
   * @param {string} id - Media record ID
   * @param {Object} client - Optional Supabase client
   * @returns {Promise<void>}
   */
  async delete(id, client = null) {
    const db = client || getClient();
    
    // Try soft delete first (if deleted_at column exists)
    const { error: softDeleteError } = await db
      .from('job_media')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (softDeleteError) {
      // If soft delete fails (column doesn't exist), do hard delete
      const { error: hardDeleteError } = await db
        .from('job_media')
        .delete()
        .eq('id', id);

      if (hardDeleteError) {
        console.error('Error deleting job media:', hardDeleteError);
        throw hardDeleteError;
      }
    }
  }
};

/**
 * Job Signature operations
 */
export const jobSignatureService = {
  /**
   * Get signatures for a job
   * @param {string} jobId - Job ID
   * @param {Object} client - Optional Supabase client
   * @returns {Promise<Array>} Array of signature records
   */
  async getByJobId(jobId, client = null) {
    const db = client || getClient();
    
    // First get technician_jobs for this job
    const { data: technicianJobs, error: tjError } = await db
      .from('technician_jobs')
      .select('id')
      .eq('job_id', jobId)
      .is('deleted_at', null);

    if (tjError) {
      console.error('Error fetching technician jobs:', tjError);
      throw tjError;
    }

    if (!technicianJobs || technicianJobs.length === 0) {
      return [];
    }

    const technicianJobIds = technicianJobs.map(tj => tj.id);
    
    const { data, error } = await db
      .from('job_signatures')
      .select('*')
      .in('technician_job_id', technicianJobIds);

    if (error) {
      console.error('Error fetching job signatures:', error);
      throw error;
    }
    
    return data || [];
  },

  /**
   * Get signature by technician_job_id
   * @param {string} technicianJobId - Technician job ID
   * @param {Object} client - Optional Supabase client
   * @returns {Promise<Object|null>} Signature record or null
   */
  async getByTechnicianJobId(technicianJobId, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('job_signatures')
      .select('*')
      .eq('technician_job_id', technicianJobId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching signature:', error);
      throw error;
    }
    
    return data;
  },

  /**
   * Create a new signature record
   * @param {Object} signatureData - Signature data
   * @param {Object} client - Optional Supabase client
   * @returns {Promise<Object>} Created signature record
   */
  async create(signatureData, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('job_signatures')
      .insert(signatureData)
      .select()
      .single();

    if (error) {
      console.error('Error creating job signature:', error);
      throw error;
    }
    
    return data;
  },

  /**
   * Update a signature record
   * @param {string} id - Signature ID
   * @param {Object} updates - Update data
   * @param {Object} client - Optional Supabase client
   * @returns {Promise<Object>} Updated signature record
   */
  async update(id, updates, client = null) {
    const db = client || getClient();
    const { data, error } = await db
      .from('job_signatures')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating job signature:', error);
      throw error;
    }
    
    return data;
  }
};

/**
 * Real-time subscription helper
 */
export function createRealtimeSubscription(table, filter, callback, client = null) {
  const db = client || getClient();
  
  const channel = db
    .channel(`${table}-changes`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: table,
        filter: filter
      },
      callback
    )
    .subscribe();

  return () => {
    db.removeChannel(channel);
  };
}

