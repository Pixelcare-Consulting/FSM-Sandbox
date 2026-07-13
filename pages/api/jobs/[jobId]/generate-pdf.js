import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import { jobService } from '../../../../lib/supabase/database';
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import QRCode from 'qrcode';
import JobSheetPDF from '../../../../components/JobSheetPDF';
import { requireSession } from '../../../../lib/auth/requireSession';
import { resolveJobMediaCreatedBy } from '../../../../lib/jobs/jobMedia';
import { matchCustomerLocation } from '../../../../lib/jobs/resolveJobDisplayAddress';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
} from '../../../../lib/services/auditLog';

async function fetchPdfBytesFromStorageUrl(imageUrl, adminClient) {
  if (!imageUrl) return null;

  const storageMatch = imageUrl.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (storageMatch && adminClient) {
    const [, bucket, path] = storageMatch;
    const cacheKey = `${bucket}:${path}`;
    const cached = storageDownloadCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.buffer;
    }

    const { data: metaList } = await adminClient.storage.from(bucket).list(
      path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
      { search: path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path, limit: 1 }
    );
    const meta = metaList?.[0];
    if (cached && meta?.updated_at && cached.updatedAt === meta.updated_at) {
      cached.expiresAt = Date.now() + STORAGE_DOWNLOAD_CACHE_MS;
      return cached.buffer;
    }

    const { data, error } = await adminClient.storage.from(bucket).download(path);
    if (!error && data) {
      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      storageDownloadCache.set(cacheKey, {
        buffer,
        updatedAt: meta?.updated_at || null,
        expiresAt: Date.now() + STORAGE_DOWNLOAD_CACHE_MS,
      });
      return buffer;
    }
  }

  const response = await fetch(imageUrl);
  if (!response.ok) return null;
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

const STORAGE_DOWNLOAD_CACHE_MS = 120000;
const storageDownloadCache = new Map();

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function detectImageMimeType(buffer, contentTypeHeader) {
  if (contentTypeHeader) {
    const contentType = contentTypeHeader.split(';')[0].trim().toLowerCase();
    if (ALLOWED_IMAGE_MIME_TYPES.includes(contentType)) {
      return contentType;
    }
  }

  if (!buffer || buffer.length < 3) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // GIF: GIF87a / GIF89a
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return 'image/png';
}

function bufferToDataUrl(buffer, contentType) {
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

function sendPdfDownload(res, pdfBuffer, filename, { cached = false } = {}) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (cached) {
    res.setHeader('X-PDF-Cached', 'true');
  }
  return res.status(200).send(pdfBuffer);
}

// Helper function to convert image URL to base64 data URL
async function imageUrlToBase64(imageUrl, adminClient) {
  if (!imageUrl) return null;

  try {
    const storageMatch = imageUrl.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    const cacheKey = storageMatch ? `${storageMatch[1]}:${storageMatch[2]}` : null;

    if (cacheKey) {
      const cached = storageDownloadCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt && cached.base64) {
        return cached.base64;
      }
    }

    let buffer = null;
    let contentTypeHint = null;

    if (storageMatch && adminClient) {
      const cached = cacheKey ? storageDownloadCache.get(cacheKey) : null;
      if (cached && Date.now() < cached.expiresAt && cached.buffer) {
        buffer = cached.buffer;
      } else {
        buffer = await fetchPdfBytesFromStorageUrl(imageUrl, adminClient);
      }
    }

    if (!buffer) {
      const response = await fetch(imageUrl);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      contentTypeHint = response.headers.get('content-type');
    }

    const contentType = detectImageMimeType(buffer, contentTypeHint);
    const dataUrl = bufferToDataUrl(buffer, contentType);

    if (cacheKey) {
      const existing = storageDownloadCache.get(cacheKey) || {};
      storageDownloadCache.set(cacheKey, {
        ...existing,
        buffer,
        base64: dataUrl,
        expiresAt: Date.now() + STORAGE_DOWNLOAD_CACHE_MS,
      });
    }

    return dataUrl;
  } catch (error) {
    console.warn('Error converting image to base64:', error);
    return null;
  }
}

async function enrichJobImagesForPdf(jobImages, adminClient, jobId) {
  if (!jobImages || jobImages.length === 0) {
    return [];
  }

  const imageCandidates = jobImages.filter(
    (img) => img.media_type !== 'pdf' && img.image_url
  );

  if (imageCandidates.length === 0) {
    return jobImages;
  }

  const conversions = await Promise.all(
    imageCandidates.map(async (img) => {
      const dataUrl = await imageUrlToBase64(img.image_url, adminClient);
      return { img, dataUrl };
    })
  );

  const failedCount = conversions.filter((result) => !result.dataUrl).length;
  if (failedCount > 0) {
    console.warn(
      `[PDF Generation] Job ${jobId}: ${failedCount}/${imageCandidates.length} service image(s) could not be converted to base64`
    );
  }

  const convertedByKey = new Map();
  conversions.forEach(({ img, dataUrl }) => {
    if (dataUrl) {
      convertedByKey.set(img.id || img.image_url, dataUrl);
    }
  });

  return jobImages
    .map((img) => {
      if (img.media_type === 'pdf' || !img.image_url) {
        return img;
      }

      const dataUrl = convertedByKey.get(img.id || img.image_url);
      if (!dataUrl) {
        return null;
      }

      return {
        ...img,
        image_src: dataUrl,
      };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const { jobId } = req.query;
    const isDownloadMode = req.query.download === '1';

    if (!jobId) {
      return res.status(400).json({ 
        error: 'Missing required parameter: jobId' 
      });
    }

    // Fetch complete job data with all related information
    const admin = getSupabaseAdmin();
    const jobData = await jobService.findById(jobId, admin);

    if (!jobData) {
      return res.status(404).json({ 
        error: 'Job not found' 
      });
    }

    // PDF is available for all job statuses (pending, in progress, completed, etc.)

    // Validate that payment QR code is generated before allowing PDF generation
    if (!jobData.payment_qr_code_string || !jobData.payment_qr_uen) {
      void writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.JOB_PDF_GENERATE,
        category: AUDIT_CATEGORIES.JOB,
        entityType: 'job',
        entityId: jobId,
        entityLabel: jobData.job_number || jobId,
        description: 'Job PDF generation failed: payment QR code missing',
        details: { missing_qr: true },
        status: AUDIT_STATUS.FAILURE,
      });
      return res.status(400).json({ 
        error: 'Payment QR code must be generated before creating PDF. Please generate the QR code in the Payment Confirmation section first.',
        missingFields: {
          qrCodeString: !jobData.payment_qr_code_string,
          uen: !jobData.payment_qr_uen
        }
      });
    }

    // Fetch followups with notes for Task Performed section
    let followUps = [];
    try {
      const { data: followUpsData } = await admin
        .from('followups')
        .select('id, notes, type, status, created_at')
        .eq('job_id', jobId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      
      if (followUpsData) {
        followUps = followUpsData;
      }
    } catch (followUpError) {
      console.warn('Error fetching followups:', followUpError);
    }

    // Fetch task completions with completion notes
    let taskCompletions = [];
    if (jobData.technician_jobs && jobData.technician_jobs.length > 0) {
      try {
        const technicianJobIds = jobData.technician_jobs.map(tj => tj.id);
        const { data: completionsData } = await admin
          .from('task_completions')
          .select('id, completion_notes, completed_at, technician_job_id')
          .in('technician_job_id', technicianJobIds);
        
        if (completionsData) {
          taskCompletions = completionsData;
        }
      } catch (completionError) {
        console.warn('Error fetching task completions:', completionError);
      }
    }

    // Fetch job images if available (with created_by user info)
    // Exclude soft-deleted images
    const { data: jobImages } = await admin
      .from('job_media')
      .select(`
        *,
        created_by_user:created_by(id, username)
      `)
      .eq('job_id', jobId)
      .is('deleted_at', null);
    
    // Enrich job images with full_name from technicians
    if (jobImages && jobImages.length > 0) {
      const userIds = [...new Set(jobImages
        .map(img => img.created_by)
        .filter(Boolean))];
      
      if (userIds.length > 0) {
        try {
          const { data: technicians } = await admin
            .from('technicians')
            .select('user_id, full_name')
            .in('user_id', userIds);
          
          if (technicians) {
            const technicianMap = {};
            technicians.forEach(tech => {
              technicianMap[tech.user_id] = tech.full_name;
            });
            
            jobImages.forEach(img => {
              if (img.created_by) {
                img.created_by_full_name = technicianMap[img.created_by] 
                  || img.created_by_user?.username 
                  || img.created_by;
              }
            });
          }
        } catch (techError) {
          console.warn('Error fetching technician full names for job images:', techError);
        }
      }
    }

    // Fetch job signatures if available
    const { data: jobSignatures } = await admin
      .from('job_signatures')
      .select('*')
      .in('technician_job_id', 
        (jobData.technician_jobs || []).map(tj => tj.id)
      );

    // Fetch company logo from company_details
    let companyLogoUrl = null;
    try {
      const { data: companyDetails } = await admin
        .from('company_details')
        .select('logo')
        .eq('id', 'companyInfo')
        .single();
      if (companyDetails?.logo) {
        companyLogoUrl = companyDetails.logo;
      }
    } catch (logoError) {
      console.warn('Error fetching company logo:', logoError);
    }

    // Pay Now details: use job's payment_profile, else default profile
    let payNowDetails = null;
    try {
      let profile = jobData.payment_profile || null;
      if (!profile && jobData.payment_profile_id) {
        const { data: p } = await admin.from('payment_profiles').select('*').eq('id', jobData.payment_profile_id).is('deleted_at', null).single();
        profile = p;
      }
      if (!profile) {
        const { data: defaultProfile } = await admin.from('payment_profiles').select('*').is('deleted_at', null).eq('is_default', true).single();
        profile = defaultProfile;
      }
      if (!profile) {
        const { data: firstProfile } = await admin.from('payment_profiles').select('*').is('deleted_at', null).order('sort_order').limit(1);
        profile = firstProfile?.[0];
      }
      if (profile) {
        payNowDetails = {
          pay_to: profile.pay_to,
          bank_name: profile.bank_name,
          account_no: profile.account_no,
          paynow: profile.paynow_uen || profile.paynow_uen_qr
        };
      }
    } catch (profileError) {
      console.warn('Error fetching payment profile:', profileError);
    }

    // Fetch user details for created_by to get full name from technicians table
    let createdByFullName = null;
    console.log('🔍 [PDF Generation] Job created_by ID:', jobData.created_by);
    console.log('🔍 [PDF Generation] Job created_by_user:', jobData.created_by_user);
    
    // Fetch full_name from technicians table using user_id
    if (jobData.created_by) {
      try {
        const { data: technicianData, error } = await admin
          .from('technicians')
          .select('full_name, first_name, last_name')
          .eq('user_id', jobData.created_by)
          .is('deleted_at', null)
          .single();
        
        console.log('📊 [PDF Generation] Technician data fetched:', technicianData);
        
        if (technicianData && !error) {
          createdByFullName = technicianData.full_name || 
                              `${technicianData.first_name || ''} ${technicianData.last_name || ''}`.trim() ||
                              '';
          console.log('✅ [PDF Generation] Using technician full_name:', createdByFullName);
        } else {
          console.warn('⚠️ [PDF Generation] No technician found for user_id:', jobData.created_by);
        }
      } catch (techError) {
        console.error('❌ [PDF Generation] Error fetching technician data:', techError);
      }
    }
    
    // Fallback to username if no technician record found
    if (!createdByFullName && jobData.created_by_user && jobData.created_by_user.username) {
      createdByFullName = jobData.created_by_user.username;
      console.log('✅ [PDF Generation] Fallback to created_by_user.username:', createdByFullName);
    }
    
    // Last resort: try auth metadata
    if (!createdByFullName && jobData.created_by) {
      try {
        const { data: authUser, error } = await admin.auth.admin.getUserById(jobData.created_by);
        
        console.log('📊 [PDF Generation] Auth user data fetched:', authUser);
        
        if (authUser && authUser.user) {
          createdByFullName = authUser.user.user_metadata?.full_name || 
                              authUser.user.email ||
                              '';
          console.log('✅ [PDF Generation] Using auth metadata full_name:', createdByFullName);
        }
      } catch (authError) {
        console.error('❌ [PDF Generation] Error fetching auth user:', authError);
      }
    }

    // Fetch customer contact details for Attention / Tel / Email section
    let contactDetails = null;
    // customer_location rows — same source job view uses for address resolution
    let customerLocations = [];
    let customerLocation = null;
    if (jobData.customer_id) {
      try {
        if (jobData.contact) {
          const contact = jobData.contact;
          contactDetails = {
            contactFullname: `${contact.first_name || ''} ${contact.middle_name || ''} ${contact.last_name || ''}`.trim() || '',
            phoneNumber: contact.tel1 || '',
            mobilePhone: contact.tel2 || '',
            email: contact.email || '',
          };
        } else if (jobData.contact_id) {
          const { data: contact } = await admin
            .from('contacts')
            .select('*')
            .eq('id', jobData.contact_id)
            .maybeSingle();

          if (contact) {
            contactDetails = {
              contactFullname: `${contact.first_name || ''} ${contact.middle_name || ''} ${contact.last_name || ''}`.trim() || '',
              phoneNumber: contact.tel1 || '',
              mobilePhone: contact.tel2 || '',
              email: contact.email || '',
            };
          }
        }

        if (!contactDetails) {
          if (jobData.customer?.customer_name || jobData.customer?.phone_number || jobData.customer?.email) {
            contactDetails = {
              contactFullname: jobData.customer?.customer_name || '',
              phoneNumber: '',
              mobilePhone: jobData.customer?.phone_number || '',
              email: jobData.customer?.email || '',
            };
          }

          const { data: contacts } = await admin
            .from('contacts')
            .select('*')
            .eq('customer_id', jobData.customer_id)
            .limit(1);

          if (contacts && contacts.length > 0) {
            const contact = contacts[0];
            contactDetails = {
              contactFullname: `${contact.first_name || ''} ${contact.middle_name || ''} ${contact.last_name || ''}`.trim() || '',
              phoneNumber: contact.tel1 || '',
              mobilePhone: contact.tel2 || '',
              email: contact.email || '',
            };
          }
        }
      } catch (contactError) {
        console.warn('Error fetching contact details:', contactError);
      }

      try {
        const { data: locRows } = await admin
          .from('customer_location')
          .select('*')
          .eq('customer_id', jobData.customer_id)
          .order('site_id', { ascending: true });

        customerLocations = locRows || [];
        customerLocation = matchCustomerLocation(
          customerLocations,
          jobData.location?.id || jobData.location_id,
          jobData.location?.location_name || jobData.location?.locationName
        );
      } catch (locationError) {
        console.warn('Error fetching customer locations for PDF:', locationError);
      }
    }

    // Add images and signatures to job data
    // Only use createdByFullName if it's not a UUID
    let finalCreatedByName = '';
    console.log('🔍 [PDF Generation] createdByFullName before UUID check:', createdByFullName);
    
    if (createdByFullName && createdByFullName.length > 0) {
      // Check if it's a UUID format - if not, use it
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(createdByFullName);
      console.log('🔍 [PDF Generation] Is UUID?', isUUID);
      
      if (!isUUID) {
        finalCreatedByName = createdByFullName;
      } else {
        console.warn('⚠️ [PDF Generation] Rejected UUID as name:', createdByFullName);
      }
    }
    
    console.log('✅ [PDF Generation] Final createdByName:', finalCreatedByName);
    
    // Create createdBy object for PDF component to access
    const createdByObject = {
      fullName: finalCreatedByName,
      full_name: finalCreatedByName
    };
    
    console.log('📦 [PDF Generation] createdBy object for PDF:', createdByObject);
    
    // Convert images to base64 for React PDF
    let signatureBase64 = null;
    if (jobSignatures && jobSignatures.length > 0 && jobSignatures[0].signature_image_url) {
      signatureBase64 = await imageUrlToBase64(jobSignatures[0].signature_image_url, admin);
    }

    let logoBase64 = null;
    if (companyLogoUrl) {
      logoBase64 = await imageUrlToBase64(companyLogoUrl, admin);
    }
    
    // Fallback to static logo if no database logo is available
    const finalLogoUrl = logoBase64 || companyLogoUrl || '/SAS-LOGO.png';

    // Generate QR code image from QR code string if available
    let qrCodeBase64 = null;
    if (jobData.payment_qr_code_string) {
      try {
        qrCodeBase64 = await QRCode.toDataURL(jobData.payment_qr_code_string, {
          width: 150,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });
      } catch (qrError) {
        console.warn('Error generating QR code image for PDF:', qrError);
      }
    }

    // Convert service images to base64 for React-PDF (raw storage URLs lack file extensions)
    const pdfJobImages = await enrichJobImagesForPdf(jobImages, admin, jobId);

    const enrichedJobData = {
      ...jobData,
      job_images: pdfJobImages,
      signature: {
        signature_image_url: signatureBase64 || (jobSignatures && jobSignatures.length > 0 ? jobSignatures[0].signature_image_url : null)
      },
      companyLogoUrl: finalLogoUrl,
      paymentQrCodeImage: qrCodeBase64,
      createdByFullName: finalCreatedByName,
      createdBy: createdByObject,
      contactDetails: contactDetails,
      customerLocations,
      customerLocation: customerLocation || jobData.customerLocation || null,
      payNowDetails: payNowDetails,
      followups: followUps.reduce((acc, fu) => {
        acc[fu.id] = fu;
        return acc;
      }, {}),
      task_completions: taskCompletions
    };

    console.log('📦 [PDF Generation] Enriched job data passed to PDF component:', {
      createdByFullName: enrichedJobData.createdByFullName,
      createdBy: enrichedJobData.createdBy,
      created_by: enrichedJobData.created_by,
      created_by_user: enrichedJobData.created_by_user
    });

    // Check if PDF already exists for this job to avoid regeneration
    const jobNumber = jobData.job_number || jobData.jobNo || 'UNKNOWN';
    const { data: existingPDFs } = await admin
      .from('job_media')
      .select('image_url, filename, created_at')
      .eq('job_id', jobId)
      .eq('media_type', 'pdf')
      .order('created_at', { ascending: false })
      .limit(1);

    // If PDF exists and user didn't force regenerate, return existing PDF
    if (existingPDFs && existingPDFs.length > 0 && !req.query.force) {
      const pdfRecord = existingPDFs[0];
      const pdfCreatedMs = pdfRecord.created_at ? new Date(pdfRecord.created_at).getTime() : 0;
      const jobUpdatedMs = jobData.updated_at ? new Date(jobData.updated_at).getTime() : 0;
      const pdfStillFresh = !jobUpdatedMs || (pdfCreatedMs && pdfCreatedMs >= jobUpdatedMs);
      const cachedFilename = pdfRecord.filename || `jobsheet-${jobNumber}.pdf`;

      if (pdfStillFresh) {
        if (isDownloadMode) {
          const cachedPdfBuffer = await fetchPdfBytesFromStorageUrl(pdfRecord.image_url, admin);
          if (!cachedPdfBuffer) {
            return res.status(500).json({ error: 'Failed to fetch existing PDF for download' });
          }
          return sendPdfDownload(res, cachedPdfBuffer, cachedFilename, { cached: true });
        }

        return res.status(200).json({
          success: true,
          url: pdfRecord.image_url,
          filename: cachedFilename,
          cached: true,
          message: 'Using existing PDF. Add ?force=true to regenerate.'
        });
      }
    }

    // Generate PDF using React component
    let pdfBuffer;
    try {
      pdfBuffer = await renderToBuffer(React.createElement(JobSheetPDF, { jobData: enrichedJobData }));
    } catch (pdfError) {
      console.error('Error generating PDF with React component:', pdfError);
      throw new Error(`PDF generation failed: ${pdfError.message}`);
    }

    // Generate unique filename with timestamp to avoid conflicts
    const timestamp = Date.now();
    const filename = `jobsheet-${jobNumber}-${timestamp}.pdf`;
    const filePath = `jobs/${jobId}/${filename}`;

    // Upload PDF to Supabase storage with upsert to overwrite if exists
    const { data: uploadData, error: uploadError } = await admin.storage
      .from('job_service_media')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true // Overwrite if exists
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = admin.storage
      .from('job_service_media')
      .getPublicUrl(filePath);

    // Store or update PDF reference in job_media table
    try {
      // Check if record already exists (by job_id and media_type only, since filename might not exist)
      // Use lowercase to match constraint
      const { data: existingRecords } = await admin
        .from('job_media')
        .select('id, filename')
        .eq('job_id', jobId)
        .eq('media_type', 'pdf'.toLowerCase())
        .order('created_at', { ascending: false })
        .limit(1);

      const existingRecord = existingRecords && existingRecords.length > 0 ? existingRecords[0] : null;

      if (existingRecord) {
        // Update existing record
        const updateData = {
          image_url: urlData.publicUrl
        };
        
        // Only include updated_at if column exists
        try {
          updateData.updated_at = new Date().toISOString();
        } catch (e) {
          // Column might not exist, skip it
        }
        
        await admin
          .from('job_media')
          .update(updateData)
          .eq('id', existingRecord.id);
      } else {
        const createdBy = resolveJobMediaCreatedBy(req, jobData);
        const insertData = {
          job_id: jobId,
          image_url: urlData.publicUrl,
          media_type: 'pdf'.toLowerCase(),
          created_at: new Date().toISOString(),
          filename: filename,
        };

        if (createdBy) {
          insertData.created_by = createdBy;
        }

        const { error: mediaError } = await admin
          .from('job_media')
          .insert(insertData);

        if (mediaError) {
          if (mediaError.message && (mediaError.message.includes('filename') || mediaError.code === 'PGRST204')) {
            delete insertData.filename;
            const { error: retryError } = await admin
              .from('job_media')
              .insert(insertData);

            if (retryError) {
              console.warn('Failed to store PDF reference in job_media (retry without filename):', retryError);
            } else {
              console.info('PDF reference stored without filename column (migration needed)');
            }
          } else if (mediaError.code === '23502' && mediaError.message.includes('created_by')) {
            console.warn('Failed to store PDF reference in job_media - created_by is required but not available:', mediaError);
          } else if (
            mediaError.code === '23514' &&
            (mediaError.message?.includes('media_type') || mediaError.message?.includes('job_media_media_type_check'))
          ) {
            console.warn(
              'Failed to store PDF reference in job_media: media_type CHECK constraint violation. ' +
              'Run lib/supabase/migrations/fix_job_media_media_type_constraint.sql on production Supabase ' +
              '(or apply via Supabase SQL editor) to allow media_type=pdf.'
            );
          } else {
            console.warn('Failed to store PDF reference in job_media:', mediaError);
          }
        }
      }
    } catch (mediaErr) {
      console.warn('Error storing PDF reference:', mediaErr);
      // Don't fail the request if this fails
    }

    if (isDownloadMode) {
      void writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.JOB_PDF_GENERATE,
        category: AUDIT_CATEGORIES.JOB,
        entityType: 'job',
        entityId: jobId,
        entityLabel: jobData.job_number || jobId,
        description: `Job PDF generated for ${jobData.job_number || jobId}`,
        details: { filename, cached: false, download: true },
        status: AUDIT_STATUS.SUCCESS,
      });
      return sendPdfDownload(res, pdfBuffer, filename);
    }

    void writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.JOB_PDF_GENERATE,
      category: AUDIT_CATEGORIES.JOB,
      entityType: 'job',
      entityId: jobId,
      entityLabel: jobData.job_number || jobId,
      description: `Job PDF generated for ${jobData.job_number || jobId}`,
      details: { filename, url: urlData.publicUrl },
      status: AUDIT_STATUS.SUCCESS,
    });

    res.status(200).json({
      success: true,
      url: urlData.publicUrl,
      path: uploadData.path,
      filename: filename
    });

  } catch (error) {
    console.error('Error generating job PDF:', error);
    void writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.JOB_PDF_GENERATE,
      category: AUDIT_CATEGORIES.JOB,
      entityType: 'job',
      entityId: req.query?.jobId || null,
      entityLabel: req.query?.jobId || null,
      description: `Job PDF generation failed: ${error.message || 'unknown error'}`,
      status: AUDIT_STATUS.FAILURE,
    });
    res.status(500).json({ 
      error: error.message || 'Failed to generate PDF' 
    });
  }
}

