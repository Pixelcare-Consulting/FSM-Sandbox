import { getSupabaseClient } from '../supabase/client';
import { jobMediaService } from '../supabase/database';

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const dateStr = date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateStr} - ${timeStr}`;
}

/**
 * @param {string} jobId
 * @returns {Promise<object[]>}
 */
export async function fetchJobMediaImages(jobId) {
  if (!jobId) {
    return [];
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const allMedia = await jobMediaService.getByJobId(jobId, supabase);
  const mediaRecords = (allMedia || []).filter(
    (record) => (record.media_type || 'image') !== 'pdf'
  );

  const userIds = [...new Set(mediaRecords.map((r) => r.created_by).filter(Boolean))];
  const technicianMap = {};
  if (userIds.length > 0) {
    const { data: technicians } = await supabase
      .from('technicians')
      .select('user_id, full_name')
      .in('user_id', userIds);
    if (technicians) {
      technicians.forEach((tech) => {
        technicianMap[tech.user_id] = tech.full_name;
      });
    }
  }

  return mediaRecords.map((record) => {
    const urlParts = record.image_url?.split('/') || [];
    const filename =
      record.filename ||
      urlParts[urlParts.length - 1] ||
      `file-${record.id?.substring(0, 8) || 'img'}`;
    const createdByFullName = record.created_by
      ? technicianMap[record.created_by] ||
        record.created_by_user?.username ||
        record.created_by
      : null;

    return {
      id: record.id,
      name: filename,
      url: record.image_url,
      description: record.description || '',
      timestamp: record.created_at ? formatTimestamp(record.created_at) : '',
      media_type: record.media_type || 'image',
      technician_job_id: record.technician_job_id,
      job_id: record.job_id,
      created_by: record.created_by,
      created_by_full_name: createdByFullName,
    };
  });
}
