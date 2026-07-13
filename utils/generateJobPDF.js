import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { formatSingaporeDate, formatSingaporeTime } from '../lib/utils/singaporeDateTime';
import { htmlToPlainText } from '../lib/utils/htmlToPlainText';
import {
  formatLocationRecordAsSingleLine,
  resolveJobDisplayAddress,
} from '../lib/jobs/resolveJobDisplayAddress.js';

/**
 * Helper function to extract storage path from Supabase storage URL
 * @param {string} url - Supabase storage URL
 * @returns {Object|null} Object with bucket and path, or null if not a Supabase URL
 */
function extractStoragePathFromUrl(url) {
  try {
    // Supabase storage URL format: https://[project].supabase.co/storage/v1/object/public/[bucket]/[path]
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const publicIndex = pathParts.indexOf('public');
    
    if (publicIndex !== -1 && publicIndex < pathParts.length - 1) {
      const bucket = pathParts[publicIndex + 1];
      const path = pathParts.slice(publicIndex + 2).join('/');
      return { bucket, path };
    }
    
    // Try regex fallback
    const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (match) {
      return { bucket: match[1], path: match[2] };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Helper function to convert image URL to base64 with timeout
 * Works in both browser and Node.js environments
 * @param {string} imageUrl - URL of the image
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
 * @param {Object} options - Options including adminClient for direct storage access
 * @returns {Promise<string>} Base64 encoded image
 */
async function imageUrlToBase64(imageUrl, timeoutMs = 5000, options = {}) {
  if (!imageUrl) return null;
  
  // Validate URL format
  try {
    new URL(imageUrl);
  } catch (error) {
    console.warn('Invalid image URL format:', imageUrl);
    return null;
  }
  
  try {
    let arrayBuffer;
    
    // If we have admin client and it's a Supabase storage URL, try direct download first
    if (options.adminClient && typeof window === 'undefined') {
      const storageInfo = extractStoragePathFromUrl(imageUrl);
      if (storageInfo) {
        try {
          const { data, error } = await options.adminClient.storage
            .from(storageInfo.bucket)
            .download(storageInfo.path);
          
          if (!error && data) {
            arrayBuffer = await data.arrayBuffer();
          } else {
            // Fall through to HTTP fetch
            throw new Error('Direct download failed, trying HTTP fetch');
          }
        } catch (directError) {
          // Fall through to HTTP fetch
          console.warn(`Direct storage download failed for ${imageUrl}, trying HTTP fetch:`, directError.message);
        }
      }
    }
    
    // If direct download didn't work or wasn't available, use HTTP fetch
    if (!arrayBuffer) {
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Image fetch timeout')), timeoutMs);
      });

      // Fetch image with timeout
      const fetchPromise = fetch(imageUrl, {
        headers: {
          'Accept': 'image/*',
        },
      }).then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        return response.arrayBuffer();
      });

      // Race between fetch and timeout
      arrayBuffer = await Promise.race([fetchPromise, timeoutPromise]);
    }
    
    // Convert to base64
    let base64;
    if (typeof Buffer !== 'undefined') {
      // Node.js environment
      base64 = Buffer.from(arrayBuffer).toString('base64');
    } else {
      // Browser environment
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64 = btoa(binary);
    }
    
    // Try to detect content type from URL
    let contentType = 'image/png'; // Default
    const urlLower = imageUrl.toLowerCase();
    if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (urlLower.includes('.gif')) {
      contentType = 'image/gif';
    } else if (urlLower.includes('.webp')) {
      contentType = 'image/webp';
    }
    
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.warn(`Error converting image to base64 (non-blocking) for ${imageUrl}:`, error.message);
    return null; // Return null instead of throwing to not block PDF generation
  }
}

/**
 * Generate a jobsheet PDF matching the sample format
 * @param {Object} jobData - Complete job data with all related information
 * @param {Object} options - Options including adminClient for direct storage access
 * @returns {Promise<Blob>} PDF blob
 */
export async function generateJobPDF(jobData, options = {}) {
  const { adminClient } = options;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);
  let yPos = margin;

  // Helper function to add a new page if needed
  const checkPageBreak = (requiredHeight) => {
    if (yPos + requiredHeight > pageHeight - margin) {
      doc.addPage();
      yPos = margin;
      return true;
    }
    return false;
  };

  // Helper function to draw a line
  const drawLine = (y) => {
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
  };

  // Helper function to draw a box around content
  const drawBox = (x, y, width, height, lineWidth = 0.5) => {
    doc.setLineWidth(lineWidth);
    doc.setDrawColor(0, 0, 0); // Black border
    doc.rect(x, y, width, height);
  };

  // Helper function to draw a section box (full width with padding)
  const drawSectionBox = (startY, endY, padding = 2) => {
    const boxX = margin;
    const boxY = startY - padding;
    const boxWidth = pageWidth - (margin * 2);
    const boxHeight = endY - startY + (padding * 2);
    drawBox(boxX, boxY, boxWidth, boxHeight);
  };

  // Helper function to format date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return formatSingaporeDate(dateString) || dateString;
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    return formatSingaporeTime(dateString, { hour12: false });
  };

  // Helper function to format date range
  const formatDateRange = (startDate, endDate) => {
    if (!startDate && !endDate) return 'N/A';
    const start = formatDate(startDate);
    const end = formatDate(endDate);
    const startTime = formatTime(startDate);
    const endTime = formatTime(endDate);
    
    if (start === end && startTime && endTime) {
      return `${start} from ${startTime} to ${endTime}`;
    } else if (start === end) {
      return start;
    } else if (startTime && endTime) {
      return `${start} from ${startTime} to ${end} ${endTime}`;
    } else {
      return `${start} - ${end}`;
    }
  };

  // ============================================
  // PAGE 1: Job Header and Details
  // ============================================
  
  // Pre-fetch images in parallel with timeout to avoid blocking
  const [logoBase64, signatureBase64] = await Promise.all([
    jobData.companyLogoUrl 
      ? imageUrlToBase64(jobData.companyLogoUrl, 3000, { adminClient }).catch(() => null)
      : Promise.resolve(null),
    jobData.signature?.signature_image_url
      ? imageUrlToBase64(jobData.signature.signature_image_url, 3000, { adminClient }).catch(() => null)
      : Promise.resolve(null)
  ]);

  // Header Section
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('JOBSHEET', pageWidth / 2, yPos + 8, { align: 'center' });
  
  // Logo area (right side) - embed company logo if available
  if (logoBase64) {
    try {
      // Add logo image (reduced size so it doesn't overshadow JOBSHEET title)
      doc.addImage(logoBase64, 'PNG', pageWidth - margin - 38, yPos, 28, 11);
    } catch (logoError) {
      console.warn('Error embedding logo, using text fallback:', logoError);
      // Fallback to text
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('sas', pageWidth - margin - 25, yPos + 5);
      doc.setFontSize(8);
      doc.text('eco / people / airconditioning', pageWidth - margin - 25, yPos + 8);
    }
  } else {
    // No logo available, use text fallback
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('sas', pageWidth - margin - 25, yPos + 5);
    doc.setFontSize(8);
    doc.text('eco / people / airconditioning', pageWidth - margin - 25, yPos + 8);
  }
  
  yPos += 18;

  // Reference and Appointment Date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const jobNumber = jobData.job_number || jobData.jobNo || 'N/A';
  doc.text(`Reference: Job #${jobNumber}`, margin, yPos);
  
  const apptDate = formatDateRange(jobData.scheduled_start, jobData.scheduled_end);
  doc.text(`Appt Date: ${apptDate}`, margin, yPos + 5);
  
  // Use createdByFullName, and if it's still a UUID, try to get name from jobData
  // Match the logic from View Job Page: job.createdBy?.fullName || "System User"
  let arrangedBy = jobData.createdByFullName || 'N/A';
  // If it's still a UUID (contains hyphens and is long), don't display it
  if (arrangedBy.includes('-') && arrangedBy.length > 30) {
    arrangedBy = 'N/A'; // Don't show UUID
  }
  // If it's N/A, try to get from jobData.createdBy if available
  if (arrangedBy === 'N/A' && jobData.createdBy?.fullName) {
    arrangedBy = jobData.createdBy.fullName;
  }
  // Final fallback to "System User" if still N/A
  if (arrangedBy === 'N/A') {
    arrangedBy = 'System User';
  }
  doc.text(`Arranged by: ${arrangedBy}`, margin, yPos + 10);
  
  yPos += 20;

  // Job Location Box - with border
  const jobLocationStartY = yPos;
  yPos += 3;
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Job Location:', margin + 2, yPos);
  
  yPos += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  const location = jobData.location || jobData.customerLocation || {};
  const customerName = jobData.customer?.customer_name || jobData.customerName || 'N/A';
  doc.text(customerName, margin + 2, yPos);
  
  yPos += 6;
  // Shared formatter — nested address objects never become "[object Object]"
  const fullAddress =
    formatLocationRecordAsSingleLine(location) ||
    resolveJobDisplayAddress(jobData) ||
    'N/A';
  
  // Split long address into multiple lines
  const addressLines = doc.splitTextToSize(fullAddress, contentWidth - 4);
  addressLines.forEach((line, index) => {
    doc.text(line, margin + 2, yPos + (index * 5));
  });
  yPos += (addressLines.length * 5) + 4;
  
  doc.text(`Attention: ${jobData.contact?.contactFullname || 'N/A'}`, margin + 2, yPos);
  yPos += 6;
  
  // Format Tel and Email - combine phone numbers with / separator, Email on separate line
  const telParts = [];
  if (jobData.contact?.phoneNumber) telParts.push(jobData.contact.phoneNumber);
  if (jobData.contact?.mobilePhone) telParts.push(jobData.contact.mobilePhone);
  
  if (telParts.length > 0) {
    doc.text(`Tel: ${telParts.join(' / ')}`, margin + 2, yPos);
    yPos += 5;
  }
  
  if (jobData.contact?.email) {
    doc.text(`Email: ${jobData.contact.email}`, margin + 2, yPos);
    yPos += 5;
  } else if (telParts.length === 0) {
    // Show placeholder if no contact info
    doc.text('Tel: / Email:', margin + 2, yPos);
    yPos += 5;
  }
  const jobLocationEndY = yPos;
  drawSectionBox(jobLocationStartY, jobLocationEndY);
  yPos += 3;

  // Technical/Appointment Remarks Box - Free text format - with border
  const techRemarksStartY = yPos;
  yPos += 3;
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Technical/Appointment Remarks:', margin + 2, yPos);
  
  yPos += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  // Build free text remarks from contact details and other info
  const contactDetails = jobData.contactDetails || jobData.contact;
  let remarksText = '';
  
  if (contactDetails) {
    const parts = [];
    if (contactDetails.contactFullname && contactDetails.contactFullname !== 'N/A') {
      parts.push(`Appt ${contactDetails.contactFullname}`);
    }
    if (contactDetails.phoneNumber && contactDetails.phoneNumber !== 'N/A') {
      parts.push(contactDetails.phoneNumber);
    }
    if (contactDetails.mobilePhone && contactDetails.mobilePhone !== 'N/A') {
      parts.push(contactDetails.mobilePhone);
    }
    if (contactDetails.email && contactDetails.email !== 'N/A') {
      parts.push(contactDetails.email);
    }
    
    // Check for additional remarks in job description or other fields
    const additionalRemarks = jobData.technical_remarks || jobData.appointment_remarks || jobData.remarks || '';
    if (additionalRemarks) {
      parts.push(additionalRemarks);
    }
    
    remarksText = parts.length > 0 ? parts.join(' - ') : 'N/A';
  } else {
    // Check if there are any remarks fields
    remarksText = jobData.technical_remarks || jobData.appointment_remarks || jobData.remarks || 'N/A';
  }
  
  // Split long text into multiple lines
  const remarksLines = doc.splitTextToSize(remarksText, contentWidth - 4);
  remarksLines.forEach((line, index) => {
    doc.text(line, margin + 2, yPos + (index * 5));
  });
  yPos += (remarksLines.length * 5) + 2;
  
  const techRemarksEndY = yPos;
  drawSectionBox(techRemarksStartY, techRemarksEndY);
  yPos += 3;

  // Visit Nature Box - with border
  const visitNatureStartY = yPos;
  yPos += 3;
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Visit Nature:', margin + 2, yPos);
  
  yPos += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  // Visit Nature: Subject dropdown value (Adhoc, Repair, etc.) – stored as title; fallback to visit_nature
  const visitNatureRaw = htmlToPlainText(jobData.visit_nature || jobData.visitNature || jobData.title || jobData.jobName || '');
  const visitNatureByNewlines = visitNatureRaw.split(/\r?\n/);
  const visitNatureLines = [];
  visitNatureByNewlines.forEach((ln) => {
    visitNatureLines.push(...doc.splitTextToSize(ln || ' ', contentWidth - 4));
  });
  if (visitNatureLines.length === 0) visitNatureLines.push('');
  visitNatureLines.forEach((line, index) => {
    if (line.trim()) doc.text(line, margin + 2, yPos + (index * 5));
  });
  yPos += (visitNatureLines.length * 5) + 2;
  
  const visitNatureEndY = yPos;
  drawSectionBox(visitNatureStartY, visitNatureEndY);
  yPos += 3;

  // Job Instruction Box - with border
  const jobInstructionStartY = yPos;
  yPos += 3;
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Job Description:', margin + 2, yPos);
  
  yPos += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  // Job Description: use job description so PDF matches "Job Description" in UI
  const jobInstructionRaw = htmlToPlainText(
    jobData.description || jobData.job_instruction || jobData.jobInstruction || jobData.instructions || 'N/A'
  );
  const jobInstructionByNewlines = jobInstructionRaw.split(/\r?\n/);
  const jobInstructionLines = [];
  jobInstructionByNewlines.forEach((ln) => {
    jobInstructionLines.push(...doc.splitTextToSize(ln || ' ', contentWidth - 4));
  });
  if (jobInstructionLines.length === 0) jobInstructionLines.push('N/A');
  jobInstructionLines.forEach((line, index) => {
    doc.text(line, margin + 2, yPos + (index * 5));
  });
  yPos += (jobInstructionLines.length * 5) + 2;
  
  const jobInstructionEndY = yPos;
  drawSectionBox(jobInstructionStartY, jobInstructionEndY);
  yPos += 3;

  // Task Performed/Follow up/Notes/Payment Box - Show actual task notes - with border
  const taskPerformedStartY = yPos;
  yPos += 3;
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Task Performed/ Follow up/ Notes/ Payment:', margin + 2, yPos);
  
  yPos += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  // Collect task notes from TASK (job_tasks) and technician input – NOT customer contact
  const taskNotes = [];

  // 1. Job tasks (task list – technician's tasks)
  const jobTasks = jobData.job_tasks || [];
  jobTasks.forEach((t, i) => {
    const name = t.task_name || t.taskName || '';
    const desc = t.task_description || t.taskDescription || '';
    if (name) taskNotes.push(`${i + 1}. ${name}${desc ? `: ${desc}` : ''}`);
  });

  // 2. Notes from technician_jobs (technician_remarks and service_notes)
  const technicianJobs = jobData.technician_jobs || [];
  technicianJobs.forEach((tj) => {
    if (tj.technician_remarks) {
      taskNotes.push(`*${tj.technician_remarks}`);
    }
    if (tj.service_notes) {
      taskNotes.push(`*${tj.service_notes}`);
    }
  });

  // 3. Notes from followups
  const followUps = jobData.followups ? Object.values(jobData.followups) : [];
  followUps.forEach((fu) => {
    if (fu.notes) {
      taskNotes.push(`*${fu.notes}`);
    }
  });

  // 4. Completion notes from task_completions
  if (jobData.task_completions) {
    jobData.task_completions.forEach((tc) => {
      if (tc.completion_notes) {
        taskNotes.push(`*${tc.completion_notes}`);
      }
    });
  }

  // If no task notes found, check for other note fields
  if (taskNotes.length === 0) {
    const fallbackNotes = jobData.task_notes || jobData.notes || jobData.follow_up_notes || '';
    if (fallbackNotes) {
      // Split by newlines or bullets
      const notesArray = fallbackNotes.split(/\n|\r/).filter(n => n.trim());
      notesArray.forEach(note => {
        taskNotes.push(note.trim().startsWith('*') ? note.trim() : `*${note.trim()}`);
      });
    }
  }
  
  // Display task notes
  if (taskNotes.length > 0) {
    taskNotes.forEach((note) => {
      const noteLines = doc.splitTextToSize(note, contentWidth - 4);
      noteLines.forEach((line, index) => {
        doc.text(line, margin + 2, yPos + (index * 5));
      });
      yPos += (noteLines.length * 5) + 2;
    });
  } else {
    // No notes available
    doc.text('N/A', margin + 2, yPos);
    yPos += 5;
  }
  
  yPos += 2;
  const taskPerformedEndY = yPos;
  drawSectionBox(taskPerformedStartY, taskPerformedEndY);
  yPos += 3;

  // Payment Details and Customer Signature (Two columns) - with border
  const paymentSignatureStartY = yPos;
  yPos += 3;
  
  // Calculate column positions - ensure proper spacing and alignment
  const colSpacing = 5; // Space between columns
  const col1X = margin + 2;
  const colWidth = (pageWidth - (margin * 2) - colSpacing - 4) / 2; // Divide remaining space equally
  const col2X = col1X + colWidth + colSpacing;

  // Left Column: Payment Details
  let leftColY = yPos;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Pay To :', col1X, leftColY);
  leftColY += 5;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('SAS M & E PTE LTD', col1X, leftColY);
  leftColY += 5;
  doc.text('Bank :', col1X, leftColY);
  leftColY += 5;
  doc.text('United Overseas Bank', col1X, leftColY);
  leftColY += 5;
  doc.text('Account No :', col1X, leftColY);
  leftColY += 5;
  doc.text('375-303-059-8', col1X, leftColY);
  leftColY += 5;
  doc.text('Paynow :', col1X, leftColY);
  leftColY += 5;
  doc.text('201019107Z', col1X, leftColY);

  // Right Column: Customer Signature
  const signatureY = yPos;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Customer Signature:', col2X, signatureY);
  
  // Draw signature box
  const sigBoxHeight = 25;
  const sigBoxY = signatureY + 6;
  doc.rect(col2X, sigBoxY, colWidth - 2, sigBoxHeight);
  
  // If signature exists, embed the pre-fetched image
  if (signatureBase64) {
    try {
      // Embed signature image in the box (adjust size to fit)
      const imgWidth = colWidth - 4;
      const imgHeight = sigBoxHeight - 2;
      doc.addImage(signatureBase64, 'PNG', col2X + 1, sigBoxY + 1, imgWidth, imgHeight);
    } catch (sigError) {
      console.warn('Error embedding signature, using fallback:', sigError);
      // Fallback text if error occurs
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.text('(Signature on file)', col2X + 2, sigBoxY + sigBoxHeight / 2);
    }
  } else if (jobData.signature?.signature_image_url) {
    // Signature URL exists but failed to load
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text('(Signature on file)', col2X + 2, sigBoxY + sigBoxHeight / 2);
  } else {
    // No signature available
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text('(Not signed)', col2X + 2, sigBoxY + sigBoxHeight / 2);
  }

  // Use the higher Y position for the box end
  const paymentSignatureEndY = Math.max(leftColY, sigBoxY + sigBoxHeight);
  drawSectionBox(paymentSignatureStartY, paymentSignatureEndY);
  yPos = paymentSignatureEndY + 3;

  // Additional Information - with border
  const additionalInfoStartY = yPos;
  yPos += 3;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Please quote job no in your reference.`, margin + 2, yPos);
  yPos += 5;
  
  // Team members - always show this line
  const technicians = jobData.technician_jobs || [];
  let teamText = 'Team: ';
  if (technicians.length > 0) {
    const teamNames = technicians.map(tj => {
      const tech = tj.technician || {};
      const user = tech.user || {};
      const firstName = tech.first_name || user.first_name || '';
      const lastName = tech.last_name || user.last_name || '';
      const fullName = tech.full_name || user.full_name;
      return fullName || `${firstName} ${lastName}`.trim();
    }).filter(Boolean);
    
    if (teamNames.length > 0) {
      teamText += teamNames.join(', ');
    } else {
      teamText += 'N/A';
    }
  } else {
    teamText += 'N/A';
  }
  doc.text(teamText, margin + 2, yPos);
  yPos += 5;
  
  doc.text(`Vehicle No:`, margin + 2, yPos);
  yPos += 5;
  
  const additionalInfoEndY = yPos;
  drawSectionBox(additionalInfoStartY, additionalInfoEndY);
  yPos = additionalInfoEndY + 3;

  // Footer - Fixed at bottom of page
  const footerY = pageHeight - margin - 25;
  drawLine(footerY);
  yPos = footerY + 5;
  doc.setFontSize(9);
  doc.text(`Please quote Job #${jobNumber} for enquiry (Tel: 6288 1288) Business Hours: 0830 to 1745 hrs (Monday to Friday) 0830 to 1245hrs (Saturday)`, 
    pageWidth / 2, yPos, { align: 'center' });
  yPos += 5;
  doc.text('SAS M & E Pte Ltd', pageWidth / 2, yPos, { align: 'center' });
  yPos += 4;
  doc.text('Co. & GST Regn. No. 201019107Z', pageWidth / 2, yPos, { align: 'center' });
  yPos += 4;
  doc.text('Address: 31 Bukit Batok Crescent, #01-08 The Splendour, Singapore, 658070', pageWidth / 2, yPos, { align: 'center' });
  yPos += 4;
  doc.text('Service Department: 62881288 | service@sasme.com.sg', pageWidth / 2, yPos, { align: 'center' });
  yPos += 4;
  doc.text('Project Department: 67639981 | project@sasme.com.sg', pageWidth / 2, yPos, { align: 'center' });

  // ============================================
  // PAGE 2: Service Photos/Documentation
  // ============================================
  doc.addPage();
  yPos = margin;
  
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('JOBSHEET', pageWidth / 2, yPos + 8, { align: 'center' });
  
  // Logo on page 2
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', pageWidth - margin - 38, yPos, 28, 11);
    } catch (logoError) {
      // Fallback to text
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('sas', pageWidth - margin - 25, yPos + 5);
      doc.setFontSize(8);
      doc.text('eco / people / airconditioning', pageWidth - margin - 25, yPos + 8);
    }
  } else {
    // No logo, use text
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('sas', pageWidth - margin - 25, yPos + 5);
    doc.setFontSize(8);
    doc.text('eco / people / airconditioning', pageWidth - margin - 25, yPos + 8);
  }
  
  yPos += 20;
  
  // Service Photos Section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Service Documentation', pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 10;
  
  // Check if there are images to include
  const jobImages = jobData.job_images || jobData.images || [];
  if (jobImages.length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total photos: ${jobImages.length}`, margin + 2, yPos);
    yPos += 8;
    
    // Fetch and embed actual images (only non-PDF images)
    // Map image_url to url for consistency
    const imageUrls = jobImages
      .map(img => ({
        ...img,
        url: img.url || img.image_url, // Support both field names
        name: img.name || img.filename || `Photo ${img.id?.substring(0, 8)}`
      }))
      .filter(img => img.media_type !== 'pdf' && img.url)
      .slice(0, 6); // Limit to 6 images to avoid too many pages
    
    if (imageUrls.length > 0) {
      // Fetch images in parallel with timeout
      const imagePromises = imageUrls.map(img => 
        imageUrlToBase64(img.url, 5000, { adminClient }).then(base64 => ({ ...img, base64 })).catch(() => null)
      );
      
      const imagesWithData = (await Promise.all(imagePromises)).filter(img => img && img.base64);
      
      // Display images in a grid (2 columns)
      const imgWidth = (contentWidth - 10) / 2; // Two columns with spacing
      const imgHeight = 40; // Fixed height for images
      let currentCol = 0;
      let currentRowY = yPos;
      
      imagesWithData.forEach((image, index) => {
        if (currentCol === 0 && currentRowY + imgHeight > pageHeight - margin - 20) {
          // Need new page
          doc.addPage();
          currentRowY = margin;
          currentCol = 0;
        }
        
        const xPos = currentCol === 0 ? margin + 2 : margin + 2 + imgWidth + 5;
        
        try {
          // Add image
          doc.addImage(image.base64, 'PNG', xPos, currentRowY, imgWidth, imgHeight);
          
          // Add image label below
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          const labelText = `${index + 1}. ${image.name || `Photo ${index + 1}`}`;
          const labelLines = doc.splitTextToSize(labelText, imgWidth);
          doc.text(labelLines[0] || labelText, xPos, currentRowY + imgHeight + 4);
        } catch (imgError) {
          console.warn('Error adding image to PDF:', imgError);
          // Just add text label if image fails
          doc.setFontSize(8);
          doc.text(`${index + 1}. ${image.name || `Photo ${index + 1}`} (image unavailable)`, xPos, currentRowY);
        }
        
        // Move to next position
        if (currentCol === 1) {
          currentCol = 0;
          currentRowY += imgHeight + 15; // Move to next row
        } else {
          currentCol = 1;
        }
      });
      
      yPos = currentRowY + (currentCol === 0 ? 0 : imgHeight + 15);
    } else {
      // No valid image URLs
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.text('No service photos available', margin + 2, yPos);
    }
  } else {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text('No service photos available', margin + 2, yPos);
  }
  
  yPos = pageHeight - 20;
  doc.setFontSize(9);
  doc.text('Page 2 of 3', pageWidth / 2, yPos, { align: 'center' });

  // ============================================
  // PAGE 3: Terms & Conditions
  // ============================================
  doc.addPage();
  yPos = margin;
  
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('JOBSHEET', pageWidth / 2, yPos + 8, { align: 'center' });
  
  // Logo on page 3
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', pageWidth - margin - 38, yPos, 28, 11);
    } catch (logoError) {
      // Fallback to text
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('sas', pageWidth - margin - 25, yPos + 5);
      doc.setFontSize(8);
      doc.text('eco / people / airconditioning', pageWidth - margin - 25, yPos + 8);
    }
  } else {
    // No logo, use text
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('sas', pageWidth - margin - 25, yPos + 5);
    doc.setFontSize(8);
    doc.text('eco / people / airconditioning', pageWidth - margin - 25, yPos + 8);
  }
  
  yPos += 20;
  
  // Terms & Conditions
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Sales Terms & Conditions', pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 10;
  
  const terms = [
    {
      title: '1. Definition',
      content: [
        '1.1. The Company refers to SAS M & E Pte Ltd, including its authorized representatives, successors, and permitted assigns.'
      ]
    },
    {
      title: '2. Payment',
      content: [
        '2.1. The Customer is required to pay all charges due on the day of delivery of service or goods.',
        '2.2. Only cash or cheque payments are accepted, with advance transfers via GIRO or internet transfer also required.',
        '2.3. Commercial Customers with a prior approved credit account must make payment within 30 calendar days from the invoice date, unless a different agreement is made in writing.',
        '2.4. The Customer is not entitled to withhold, set off, or otherwise reduce any payment due to the Company unless agreed upon in writing by the Company.',
        '2.5. If any part of an invoice is disputed, the remaining balance is still payable when due, and the Customer has no right to set off any claim against the Company from monies owed to the Company.',
        '2.6. If the Customer fails to make full payment by the due date, the Company reserves the right to enter any premises where the Goods are stored to reclaim possession of them, without liability for trespass, negligence, or compensation to the Customer.'
      ]
    },
    {
      title: '3. Deposit',
      content: [
        'A 50% deposit of the total bill is required in advance for orders of indent parts.',
        'Deposits are strictly non-refundable for any cancellation.',
        'Delivery is subject to supplier availability, and the Company will not be liable for losses due to delivery delays.'
      ]
    },
    {
      title: '4. Refund and Cancellation',
      content: [
        '4.1. There is strictly no refund for services or service contracts that have already been rendered or signed.',
        '4.2. The Company will not entertain any cancellations once an order is confirmed and submitted by the Customer.'
      ]
    },
    {
      title: '5. Warranty',
      content: [
        '5.1. A limited warranty applies to spare parts, with specific terms and conditions (T&C) applying.',
        '5.2. Customers enjoy free breakdown attendance within 30 days from the last air conditioning service date.',
        '5.2.1. Additional Clause for Quarterly and Half Yearly Maintenance Contract:',
        '   This clause is specially arranged for customers with relatively LOW USAGE.',
        '   For Quarterly contracts, usage should be less than 150-200 hours per month.',
        '   For Half Yearly contracts, usage should be less than 100-120 hours per month.',
        '   The warranty covers being free from installation problems, such as long piping (less than 10m in length for drain pipe) or poor drain gradient breakdown.',
        '   An additional charge of $80 per visit is required after 30 days from the last air conditioning service date.'
      ]
    },
    {
      title: '6. Customer\'s Responsibilities',
      content: [
        '6.1. The Customer should allow the Company to complete the servicing within the contract period; otherwise, the service will be counted as completed unless otherwise agreed in writing by the Company.',
        '6.2. It is the Customer\'s responsibility to contact the Company to schedule maintenance. While the Company will assist by reminding customers through phone calls, SMS, or email when maintenance is due, the Company is not responsible for lapsed maintenance under any circumstances.'
      ]
    },
    {
      title: '7. Disclaimer',
      content: [
        'The service provided will not include materials necessary to repair equipment damage caused by accident, abuse, acts of a third person, or any Force of Nature.',
        'The Company will not be held liable for any loss or damage, whether consequential or otherwise, arising from the operation or failure of the equipment or its controls, nor for material or labor delays.',
        'The Company reserves the right to amend or vary these terms and conditions at any time.'
      ]
    }
  ];

  terms.forEach((term) => {
    checkPageBreak(15);
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(term.title, margin + 2, yPos);
    yPos += 6;
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    term.content.forEach((line) => {
      checkPageBreak(6);
      const lines = doc.splitTextToSize(line, contentWidth - 4);
      lines.forEach((textLine) => {
        doc.text(textLine, margin + 2, yPos);
        yPos += 5;
      });
    });
    
    yPos += 3;
  });

  yPos = pageHeight - 20;
  doc.setFontSize(9);
  doc.text('Page 3 of 3', pageWidth / 2, yPos, { align: 'center' });

  // Generate PDF blob
  const pdfBlob = doc.output('blob');
  return pdfBlob;
}

