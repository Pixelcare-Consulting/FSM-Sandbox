import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import {
  formatSingaporeDateRange,
  formatSingaporeDateWithTime,
} from '../lib/utils/singaporeDateTime';
import { htmlToPlainText } from '../lib/utils/htmlToPlainText';
import {
  formatLocationRecordAsSingleLine,
  resolveJobDisplayAddress,
} from '../lib/jobs/resolveJobDisplayAddress';

// Styles matching the accurate design
const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 40,
    paddingVertical: 30,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },
  // Title
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  // Header info
  headerLeft: {
    fontSize: 9,
    lineHeight: 1.5,
  },
  headerLeftBold: {
    fontWeight: 'bold',
  },
  logoImage: {
    width: 95,
    height: 52,
    objectFit: 'contain',
    margin: 0,
    padding: 0,
  },
  qrCodeImage: {
    width: 70,
    height: 70,
    objectFit: 'contain',
    margin: 0,
    padding: 0,
  },
  // Payment-section QR (placed beside bank details so its purpose is clear)
  paymentQrSection: {
    width: 95,
    padding: 5,
    borderRight: '1px solid #000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentQrLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    marginBottom: 3,
    textAlign: 'center',
  },
  paymentQrImage: {
    width: 80,
    height: 80,
    objectFit: 'contain',
  },
  paymentQrHint: {
    fontSize: 7,
    color: '#4B5563',
    marginTop: 3,
    textAlign: 'center',
  },
  
  // Job Location Box (first box with full border)  
  firstBox: {
    border: '1px solid #000',
    padding: 8,
  },
  firstBoxContent: {
    fontSize: 9,
    lineHeight: 1.25,
  },
  
  // Connected boxes (no top border)
  connectedBox: {
    border: '1px solid #000',
    borderTop: 0,
  },
  sectionHeader: {
    fontSize: 9,
    padding: 8,
    borderBottom: '1px solid #000',
  },
  sectionContent: {
    fontSize: 9,
    padding: 8,
    lineHeight: 1.2,
  },
  
  // Visit Nature
  visitNatureHeader: {
    fontSize: 9,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 3,
  },
  visitNatureContent: {
    fontSize: 9,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  
  // Task section with fixed height
  taskContent: {
    fontSize: 9,
    paddingHorizontal: 8,
    paddingBottom: 8,
    lineHeight: 1.2,
    minHeight: 50,
  },
  
  // Payment and Signature (two columns)
  paymentSignatureRow: {
    border: '1px solid #000',
    borderTop: 0,
    flexDirection: 'row',
  },
  paymentLeft: {
    flex: 1,
    padding: 5,
    borderRight: '1px solid #000',
  },
  paymentRow: {
    flexDirection: 'row',
    marginBottom: 1,
    fontSize: 9,
  },
  paymentLabel: {
    width: 60,
  },
  paymentColon: {
    width: 15,
    marginHorizontal: 5,
  },
  paymentValue: {
    flex: 1,
  },
  paymentNote: {
    fontWeight: 'bold',
    marginTop: 8,
    fontSize: 9,
  },
  signatureSection: {
    width: 150,
    padding: 5,
  },
  signatureLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  signatureBox: {
    height: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signatureImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  
  // Team section
  teamBox: {
    border: '1px solid #000',
    borderTop: 0,
    padding: 5,
    fontSize: 9,
    lineHeight: 1.3,
  },
  
  // Footer
  footerContainer: {
    marginTop: 'auto',
    paddingTop: 10,
  },
  footerTop: {
    textAlign: 'center',
    fontSize: 7,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTop: '1px solid #D1D5DB',
    color: '#000000',
  },
  footerCompany: {
    fontSize: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    lineHeight: 1.4,
  },
  footerCompanyBold: {
    fontWeight: 'bold',
  },
  
  // Page 2 - Service Documentation
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  imageContainer: {
    width: '48%',
    border: '1px solid #000',
    padding: 5,
    marginBottom: 10,
  },
  serviceImage: {
    width: '100%',
    height: 150,
    objectFit: 'contain',
  },
  // Photo footer (matches Job View page caption: description + timestamp)
  imageCaption: {
    marginTop: 5,
    paddingTop: 4,
    borderTop: '1px solid #E5E7EB',
  },
  imageCaptionDescription: {
    fontSize: 8,
    color: '#374151',
    marginBottom: 2,
  },
  imageCaptionTimestamp: {
    fontSize: 7,
    color: '#6B7280',
  },
  
  // Terms page - using connected boxes
  termsBox: {
    border: '1px solid #000',
    padding: 10,
    marginBottom: 0,
  },
  termsConnectedBox: {
    border: '1px solid #000',
    borderTop: 0,
    padding: 10,
  },
  termsTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  termsSectionTitle: {
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 3,
    fontSize: 9,
  },
  termsContent: {
    marginLeft: 15,
    marginBottom: 5,
    fontSize: 9,
    lineHeight: 1.4,
  },
  termsSubContent: {
    marginLeft: 30,
    marginBottom: 5,
    fontSize: 9,
    lineHeight: 1.4,
  },
  tcpdfText: {
    fontSize: 7,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 20,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 9,
  },
});

// Split text into lines for PDF (React-PDF single <Text> can collapse newlines)
const textToLines = (text) => {
  if (!text) return [''];
  const lines = String(text).split(/\r?\n/);
  return lines.length ? lines : [''];
};

// Default Pay Now values (fallback when not configured in settings)
const DEFAULT_PAY_NOW = {
  pay_to: 'SAS M \u0026 E PTE LTD',
  bank_name: 'United Overseas Bank',
  account_no: '375-303-059-8',
  paynow: '201019107Z'
};

const JobSheetPDF = ({ jobData }) => {
  const jobNumber = jobData.job_number || jobData.jobNo || 'N/A';
  const apptDate = formatSingaporeDateRange(jobData.scheduled_start, jobData.scheduled_end, { hour12: true });
  
  // Match the web view logic for arranged by (line 5735 in [jobId].js)
  let arrangedBy = jobData.createdByFullName || 
                   jobData.createdBy?.fullName || 
                   jobData.createdBy?.full_name || 
                   '';
  
  // Filter out UUID-like strings
  if (arrangedBy && (arrangedBy.includes('-') && arrangedBy.length > 30)) {
    arrangedBy = '';
  }

  const location = jobData.location || {};
  const customerLocation = jobData.customerLocation || null;
  const customerLocations = jobData.customerLocations || [];
  const scheduleAddress = jobData.scheduleAddress || '';
  const customerName = jobData.customer?.customer_name || jobData.customerName || 'N/A';

  // Same order as JobDetailsPage Location subtitle — single address line under Job Location
  const addressLine =
    resolveJobDisplayAddress(jobData, {
      customerLocations,
      scheduleAddress,
    }) ||
    formatLocationRecordAsSingleLine(customerLocation) ||
    formatLocationRecordAsSingleLine(location) ||
    '';
  const addressLines = addressLine ? [addressLine] : [];

  const contactDetails = jobData.contactDetails || jobData.contact || {};
  const attentionName =
    contactDetails.contactFullname && contactDetails.contactFullname !== 'N/A'
      ? contactDetails.contactFullname
      : '';
  const telParts = [contactDetails.phoneNumber, contactDetails.mobilePhone].filter(
    (v) => v && v !== 'N/A'
  );
  const contactEmail =
    contactDetails.email && contactDetails.email !== 'N/A' ? contactDetails.email : '';
  // Job instruction: use job description so PDF matches "Job Description" in UI
  const jobInstruction = htmlToPlainText(
    jobData.description || jobData.job_instruction || jobData.jobInstruction || jobData.instructions || 'N/A'
  );
  const jobInstructionLines = textToLines(jobInstruction);

  const technicianJobs = jobData.technician_jobs || [];

  // Task Performed: pick from TASK (job_tasks) and technician input, NOT customer contact
  const taskPerformedLines = [];
  // 1. Job tasks (task list – technician's tasks)
  const jobTasks = jobData.job_tasks || [];
  jobTasks.forEach((t, i) => {
    const name = t.task_name || t.taskName || '';
    const desc = t.task_description || t.taskDescription || '';
    if (name) taskPerformedLines.push(`${i + 1}. ${name}${desc ? `: ${desc}` : ''}`);
  });
  // 2. Technician remarks and service notes
  technicianJobs.forEach((tj) => {
    if (tj.technician_remarks) taskPerformedLines.push(`* ${tj.technician_remarks}`);
    if (tj.service_notes) taskPerformedLines.push(`* ${tj.service_notes}`);
  });
  // 3. Followups notes
  const followups = jobData.followups ? (Array.isArray(jobData.followups) ? jobData.followups : Object.values(jobData.followups)) : [];
  followups.forEach((fu) => {
    if (fu.notes) taskPerformedLines.push(`* ${fu.notes}`);
  });
  // 4. Task completion notes
  const taskCompletions = jobData.task_completions || [];
  taskCompletions.forEach((tc) => {
    if (tc.completion_notes) taskPerformedLines.push(`* ${tc.completion_notes}`);
  });
  // Fallback if nothing from TASK
  if (taskPerformedLines.length === 0 && (jobData.task_notes || jobData.notes || jobData.follow_up_notes)) {
    const fallback = (jobData.task_notes || jobData.notes || jobData.follow_up_notes || '').split(/\n|\r/).filter(n => n.trim());
    fallback.forEach(n => taskPerformedLines.push(n.trim().startsWith('*') ? n.trim() : `* ${n.trim()}`));
  }

  // Team members
  let teamText = 'Team: ';
  if (technicianJobs.length > 0) {
    const teamNames = technicianJobs
      .map((tj) => {
        const tech = tj.technician || {};
        const user = tech.user || {};
        return tech.full_name || user.full_name || `${tech.first_name || user.first_name || ''} ${tech.last_name || user.last_name || ''}`.trim();
      })
      .filter(Boolean);

    teamText += teamNames.length > 0 ? teamNames.join(', ') : 'N/A';
  } else {
    teamText += 'N/A';
  }

  // Signature
  const signatureImage = jobData.signature?.signature_image_url || null;
  
  // Logo source: try database first, fallback to static file
  const logoSource = jobData.companyLogoUrl || '/SAS-LOGO.png';
  // QR code image (base64 data URL)
  const qrCodeImage = jobData.paymentQrCodeImage || null;
  // Pay Now details from settings (fallback to defaults)
  const payNow = { ...DEFAULT_PAY_NOW, ...(jobData.payNowDetails || {}) };

  return (
    <Document>
      {/* Page 1: Main Jobsheet */}
      <Page size="A4" style={styles.page}>
        {/* Header row: Reference info (left) | JOBSHEET title (center) | Logo (right) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingHorizontal: 2 }}>
          <View style={[styles.headerLeft, { flex: 1 }]}>
            <Text><Text style={styles.headerLeftBold}>Reference:</Text> {jobNumber}</Text>
            <Text><Text style={styles.headerLeftBold}>Appt Date:</Text> {apptDate}</Text>
            <Text><Text style={styles.headerLeftBold}>Arranged by:</Text> {arrangedBy}</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.title}>JOBSHEET</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            {logoSource && (
              <Image src={logoSource} style={styles.logoImage} alt="" />
            )}
          </View>
        </View>

        {/* Job Location - First box with full border */}
        <View style={styles.firstBox}>
          <View style={styles.firstBoxContent}>
            <Text><Text style={{ fontWeight: 'bold' }}>Job Location:</Text> {customerName}</Text>
            {addressLines.map((line, idx) => (
              <Text key={idx}>{line}</Text>
            ))}
            <Text style={{ marginTop: 5 }}>
              <Text style={{ fontWeight: 'bold' }}>Attention:</Text> {attentionName || ' '}
            </Text>
            {telParts.length > 0 ? (
              <Text>
                <Text style={{ fontWeight: 'bold' }}>Tel:</Text> {telParts.join(' / ')}
              </Text>
            ) : null}
            {contactEmail ? (
              <Text>
                <Text style={{ fontWeight: 'bold' }}>Email:</Text> {contactEmail}
              </Text>
            ) : telParts.length === 0 ? (
              <Text>Tel: / Email:</Text>
            ) : null}
          </View>
        </View>

        {/* Job Instruction and Task Performed - Combined section with no internal borders */}
        <View style={styles.connectedBox}>
          <View style={styles.sectionContent}>
            <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>Job Description:</Text>
            {jobInstructionLines.map((line, idx) => (
              <Text key={idx} style={{ fontSize: 9, marginBottom: idx < jobInstructionLines.length - 1 ? 2 : 0 }}>{line || ' '}</Text>
            ))}
          </View>
        </View>
        <View style={styles.connectedBox}>
          <View style={{ paddingHorizontal: 8, paddingTop: 8 }}>
            <Text style={{ fontWeight: 'bold', marginBottom: 3 }}>Task Performed/ Follow up/ Notes/ Payment:</Text>
          </View>
          <View style={styles.taskContent}>
            {taskPerformedLines.length > 0 ? (
              taskPerformedLines.map((line, idx) => (
                <Text key={idx} style={{ marginBottom: 2 }}>{line}</Text>
              ))
            ) : (
              <Text>N/A</Text>
            )}
          </View>
        </View>

        {/* Payment + PayNow QR + Signature - Three columns */}
        <View style={styles.paymentSignatureRow}>
          <View style={styles.paymentLeft}>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Pay To</Text>
              <Text style={styles.paymentColon}>:</Text>
              <Text style={styles.paymentValue}>{payNow.pay_to || 'N/A'}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Bank</Text>
              <Text style={styles.paymentColon}>:</Text>
              <Text style={styles.paymentValue}>{payNow.bank_name || 'N/A'}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Account No</Text>
              <Text style={styles.paymentColon}>:</Text>
              <Text style={styles.paymentValue}>{payNow.account_no || 'N/A'}</Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Paynow</Text>
              <Text style={styles.paymentColon}>:</Text>
              <Text style={styles.paymentValue}>{payNow.paynow || 'N/A'}</Text>
            </View>
            <Text style={styles.paymentNote}>Please quote job no in your reference.</Text>
          </View>
          {qrCodeImage && (
            <View style={styles.paymentQrSection}>
              <Text style={styles.paymentQrLabel}>Scan to Pay</Text>
              <Image src={qrCodeImage} style={styles.paymentQrImage} alt="PayNow QR code" />
              <Text style={styles.paymentQrHint}>PayNow QR</Text>
            </View>
          )}
          <View style={styles.signatureSection}>
            <Text style={styles.signatureLabel}>Customer Signature:</Text>
            <View style={styles.signatureBox}>
              {signatureImage ? (
                <Image src={signatureImage} style={styles.signatureImage} alt="Customer signature" />
              ) : null}
            </View>
          </View>
        </View>

        {/* Team */}
        <View style={styles.teamBox}>
          <Text>{teamText}</Text>
          <Text>Vehicle No:</Text>
        </View>

        {/* Footer */}
        <View style={styles.footerContainer}>
          <Text style={styles.footerTop}>
            Please quote Job #{jobNumber} for enquiry (Tel: 6288 1288) Business Hours: 08:30 to 17:45 hrs (Monday to Friday) 08:30 to 12:45hrs (Saturday)
          </Text>
          <View style={styles.footerCompany}>
            <Text style={styles.footerCompanyBold}>SAS M & E Pte Ltd</Text>
            <Text>Co. & GST Regn. No. 201019107Z</Text>
            <Text>31 Bukit Batok Crescent, #01-08 The Splendour S(658070)</Text>
            <Text>Service Department 62881288 | service@sasme.com.sg</Text>
            <Text>Project Department 67639981 | project@sasme.com.sg</Text>
          </View>
        </View>
      </Page>

      {/* Page 2: Service Documentation */}
      <Page size="A4" style={styles.page}>
        {/* Header with Title Centered and Logo on Right - Same Line */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 15, position: 'relative', paddingHorizontal: 10 }}>
          <Text style={styles.title}>JOBSHEET</Text>
          {logoSource && (
            <View style={{ position: 'absolute', right: 0, marginRight: 10 }}>
              <Image src={logoSource} style={styles.logoImage} alt="" />
            </View>
          )}
        </View>

        {/* Service Documentation Images */}
        {(() => {
          const images = (jobData.job_images || []).filter(img =>
            img.media_type !== 'pdf' && (img.image_src || img.image_url)
          );

          return images.length > 0 ? (
            <View style={[styles.imageGrid, { marginTop: 10 }]}>
              {images.map((img, idx) => {
                const imageSrc = img.image_src || img.image_url;
                const caption = (img.description || img.filename || '').toString().trim();
                const timestampStr = formatSingaporeDateWithTime(img.created_at);
                return (
                  <View key={img.id || idx} style={styles.imageContainer} wrap={false}>
                    <Image src={imageSrc} style={styles.serviceImage} alt="" />
                    {(caption || timestampStr) && (
                      <View style={styles.imageCaption}>
                        {caption ? (
                          <Text style={styles.imageCaptionDescription}>{caption}</Text>
                        ) : null}
                        {timestampStr ? (
                          <Text style={styles.imageCaptionTimestamp}>{timestampStr}</Text>
                        ) : null}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={[styles.firstBox, { marginTop: 10 }]}>
              <Text>No service documentation images available</Text>
            </View>
          );
        })()}

        {/* Footer */}
        <View style={{ marginTop: 'auto', paddingTop: 10 }}>
          <Text style={{ textAlign: 'center', fontSize: 7, color: '#000000' }}>
            Please quote Job #{jobNumber} for enquiry (Tel: 6288 1288) Business Hours: 08:30 to 17:45 hrs (Monday to Friday) 08:30 to 12:45hrs (Saturday)
          </Text>
        </View>
      </Page>

      {/* Page 3: Terms & Conditions */}
      <Page size="A4" style={styles.page}>
        {/* Header with Title Centered and Logo on Right - Same Line */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 15, position: 'relative', paddingHorizontal: 10 }}>
          <Text style={styles.title}>JOBSHEET</Text>
          {logoSource && (
            <View style={{ position: 'absolute', right: 0, marginRight: 10 }}>
              <Image src={logoSource} style={styles.logoImage} alt="" />
            </View>
          )}
        </View>

        {/* Terms & Conditions in Single Box */}
        <View style={[styles.termsBox, { marginTop: 10 }]}>
          <Text style={styles.termsTitle}>Sales Terms & Conditions</Text>
          
          <Text style={[styles.termsSectionTitle, { marginTop: 0 }]}>1. Definition</Text>
          <Text style={styles.termsContent}>
            1.1. In the Terms and Conditions, the following words and expressions shall have the following meanings: &quot;The Company&quot; means SAS M & E Pte Ltd includes the authorised representatives, successors and permitted assigns.
          </Text>

          <Text style={styles.termsSectionTitle}>2. Payment</Text>
          <Text style={styles.termsContent}>
            2.1. The Customer shall pay the Company all the Charges due on the day of delivery of service/goods.
          </Text>
          <Text style={styles.termsContent}>
            2.2. Only cash or cheque payment is accepted. Required advance transfer for payment via GIRO or internet transfer.
          </Text>
          <Text style={styles.termsContent}>
            2.3. Commercial Customer who has prior approved credit account with the Company, payment must be paid off within 30 calendar days from the date of invoice unless otherwise agreed in writing.
          </Text>
          <Text style={styles.termsContent}>
            2.4. The Customer shall not entitle to withhold from, set off against or otherwise reduce any payment due to the Company unless agreed in writing by the Company.
          </Text>
          <Text style={styles.termsContent}>
            2.5. If any part of an invoice is in dispute, the balance will remain payable and must be paid when due. The Customer has no right to set off any claim against the Company from monies owing to the Company.
          </Text>
          <Text style={styles.termsContent}>
            2.6. If Customer fail to make full payment on the due date, then without prejudice to other right or remedy available to the Company, the Company shall be entitled to enter any premise in which the Goods are stored, to enable the Company to reclaim possession of the Goods without liability for the tort of trespass, negligence or payment of any compensation to the Customer.
          </Text>

          <Text style={styles.termsSectionTitle}>3. Deposit</Text>
          <Text style={styles.termsContent}>
            Deposit of 50% of total bill is required in advance for indent part order. Strictly no refund for any cancellation. Delivery is subjected to the supplier availability and the Company will not liable for losses on delivery delay.
          </Text>

          <Text style={styles.termsSectionTitle}>4. Refund and Cancellation</Text>
          <Text style={styles.termsContent}>
            4.1. Strictly no refund for service or service contract that have been rendered or signed.
          </Text>
          <Text style={styles.termsContent}>
            4.2. We will not entertain any cancellations once the order is confirmed and submitted by the Customer.
          </Text>

          <Text style={styles.termsSectionTitle}>5. Warranty</Text>
          <Text style={styles.termsContent}>
            5.1. Limited warranty for spare part. T&C apply.
          </Text>
          <Text style={styles.termsContent}>
            5.2. Enjoys free breakdown attendance within 30 days from the last aircon service date.
          </Text>
          <Text style={styles.termsSubContent}>
            5.2.1. Additional Clause for Quarterly and Half Yearly Maintenance Contract: Specially arranged for customer with relatively LOW USAGE. Quarterly with less than 150 - 200 hours per month and Half Yearly with less than 100 - 120 hours per month. Free from installation problems, such as long piping (less than 10m in length for drain pipe) or poor drain gradient breakdown. Additional $80 per visit required after 30 days from last aircon service date.
          </Text>

          <Text style={styles.termsSectionTitle}>6. Customer&apos;s Responsibilities</Text>
          <Text style={styles.termsContent}>
            6.1. The Customer should allow the Company to complete the servicing within the contract period. Otherwise, it would be counted as completed, unless agreed in writing by the Company.
          </Text>
          <Text style={styles.termsContent}>
            6.2. Customer&apos;s responsibility to contact the Company to schedule for Maintenance. The Company will assist Customer by reminding them through phone call, SMS or email when Maintenance is due however the Company is not responsible under any circumstances for lapsed maintenance.
          </Text>

          <Text style={styles.termsSectionTitle}>7. Disclaimer</Text>
          <Text style={styles.termsContent}>
            Service as provided for will not include material necessary to repair damage to the equipment caused by accident or abuse or arising from Acts of Third Person or any Force of Nature. The Company will not be held liable for loss or damage, consequential or otherwise arising from the operation or failure of the equipment, or its controls; nor for material or labour delays. The Company may amend or vary these terms and conditions at any time.
          </Text>
        </View>

      </Page>
    </Document>
  );
};

export default JobSheetPDF;
