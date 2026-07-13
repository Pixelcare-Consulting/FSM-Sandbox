import { getSupabaseClient } from '../supabase/client';

/**
 * @param {string} jobUuid
 * @returns {Promise<Array<{ id: string, type: string, signatureURL: string, signedBy: string, timestamp: string }>>}
 */
export async function fetchJobSignatures(jobUuid) {
  if (!jobUuid) {
    return [];
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data: technicianJobs, error: tjError } = await supabase
    .from('technician_jobs')
    .select('id')
    .eq('job_id', jobUuid)
    .is('deleted_at', null);

  if (tjError) {
    throw new Error(tjError.message || 'Failed to load technician jobs for signatures');
  }

  if (!technicianJobs?.length) {
    return [];
  }

  const technicianJobIds = technicianJobs.map((tj) => tj.id);
  const { data: signaturesData, error: sigError } = await supabase
    .from('job_signatures')
    .select('*')
    .in('technician_job_id', technicianJobIds);

  if (sigError) {
    throw new Error(sigError.message || 'Failed to load signatures');
  }

  if (!signaturesData?.length) {
    return [];
  }

  return signaturesData.map((sig, index) => {
    const signatureType = sig.signature_type || (index === 0 ? 'technician' : 'customer');
    return {
      id: sig.id,
      type: signatureType,
      signatureURL: sig.signature_image_url,
      signedBy: sig.signed_by || sig.customer_name || 'Unknown',
      timestamp: sig.signed_at || sig.created_at,
    };
  });
}
