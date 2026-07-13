import { refreshTechnicianHoursForJobId } from "../supabase/technicianHours.js";
import { normalizeJobTaskNameForInsert } from "./jobTaskFields.js";

const formatDateForSQL = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().split("T")[0];
};

const formatTimeForSQL = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toTimeString().split(" ")[0].substring(0, 8);
};

const deriveBaseJobNumber = (jobNumber) => {
  if (!jobNumber || typeof jobNumber !== "string") return null;
  const parts = jobNumber.split("-");
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return jobNumber;
};

const extractSequenceFromJobNumber = (jobNumber) => {
  if (!jobNumber || typeof jobNumber !== "string") return 0;
  const parts = jobNumber.split("-");
  if (parts.length >= 3) {
    const seq = parseInt(parts[2], 10);
    return Number.isNaN(seq) ? 0 : seq;
  }
  return 0;
};

const padSequenceNumber = (sequence) => sequence.toString().padStart(3, "0");

const generateNewBaseJobNumber = async (supabase) => {
  const year = new Date().getFullYear();
  const { data, error } = await supabase
    .from("jobs")
    .select("job_number")
    .like("job_number", `${year}-%`)
    .is("deleted_at", null);

  if (error) {
    throw error;
  }

  let maxNumber = 0;
  (data || []).forEach((job) => {
    const parts = (job.job_number || "").split("-");
    if (parts.length >= 2 && parts[0] === String(year)) {
      const num = parseInt(parts[1], 10);
      if (!Number.isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  });

  const nextNumber = (maxNumber + 1).toString().padStart(6, "0");
  return `${year}-${nextNumber}`;
};

async function createRepeatSiblingJobs({
  supabase,
  originalJob,
  occurrenceDateRanges,
  userId,
  jobData = {},
}) {
  if (!occurrenceDateRanges?.length) {
    return [];
  }

  let baseJobNo = deriveBaseJobNumber(
    originalJob.job_number || originalJob.job_no || originalJob.jobNo
  );
  if (!baseJobNo) {
    baseJobNo = await generateNewBaseJobNumber(supabase);
  }

  const { data: siblingJobs } = await supabase
    .from("jobs")
    .select("job_number")
    .like("job_number", `${baseJobNo}-%`)
    .is("deleted_at", null);

  let sequenceCounter = extractSequenceFromJobNumber(
    originalJob.job_number || originalJob.job_no || originalJob.jobNo
  );
  if (siblingJobs?.length) {
    siblingJobs.forEach((job) => {
      const seq = extractSequenceFromJobNumber(job.job_number);
      if (seq > sequenceCounter) {
        sequenceCounter = seq;
      }
    });
  }

  const createdJobs = [];

  for (let index = 0; index < occurrenceDateRanges.length; index += 1) {
    sequenceCounter += 1;
    const sequenceLabel = padSequenceNumber(sequenceCounter);
    const jobNumber = `${baseJobNo}-${sequenceLabel}`;
    const [startDateObj, endDateObj] = occurrenceDateRanges[index];

    const jobPayload = {
      customer_id: originalJob.customer_id,
      location_id: originalJob.location_id,
      service_call_id: originalJob.service_call_id,
      job_number: jobNumber,
      title:
        originalJob.title ||
        originalJob.job_name ||
        jobData.Subject ||
        `Repeat Job ${sequenceLabel}`,
      description: originalJob.description || jobData.Description || "",
      priority: originalJob.priority || "MEDIUM",
      status: originalJob.status || "SCHEDULED",
      scheduled_start: startDateObj.toISOString(),
      scheduled_end: endDateObj.toISOString(),
      created_by: userId,
    };

    const { data: newJob, error: createJobError } = await supabase
      .from("jobs")
      .insert(jobPayload)
      .select()
      .single();

    if (createJobError) {
      throw createJobError;
    }

    const schedulePayload = {
      job_id: newJob.id,
      jsdate: formatDateForSQL(startDateObj),
      jedate: formatDateForSQL(endDateObj),
      jstime: formatTimeForSQL(startDateObj),
      jetime: formatTimeForSQL(endDateObj),
      dur_type: jobData.scheduleTemplate?.dur_type || null,
      dur: jobData.scheduleTemplate?.dur || null,
      address:
        jobData.scheduleTemplate?.address ||
        originalJob.location?.location_name ||
        "",
    };
    await supabase.from("job_schedule").insert(schedulePayload);

    if (originalJob.job_tasks?.length) {
      const taskPayload = originalJob.job_tasks.map((task, taskIndex) => ({
        job_id: newJob.id,
        task_name: normalizeJobTaskNameForInsert(task.task_name),
        task_description: task.task_description,
        task_order: task.task_order ?? taskIndex + 1,
        is_required: task.is_required ?? false,
      }));
      await supabase.from("job_tasks").insert(taskPayload);
    }

    if (originalJob.job_equipments?.length) {
      const equipmentPayload = originalJob.job_equipments
        .map((equipment) => {
          const equipmentId = equipment.equipment_id || equipment.equipment?.id;
          if (!equipmentId) {
            return null;
          }
          return {
            job_id: newJob.id,
            equipment_id: equipmentId,
            quantity_used: equipment.quantity_used || 1,
            notes: equipment.notes || "",
          };
        })
        .filter(Boolean);

      if (equipmentPayload.length) {
        await supabase.from("job_equipments").insert(equipmentPayload);
      }
    }

    if (originalJob.technician_jobs?.length) {
      const assignments = originalJob.technician_jobs
        .filter((assignment) => !assignment.deleted_at && assignment.technician_id)
        .map((assignment) => ({
          job_id: newJob.id,
          technician_id: assignment.technician_id,
          assignment_status: "ASSIGNED",
        }));

      if (assignments.length) {
        await supabase.from("technician_jobs").insert(assignments);
        try {
          const rh = await refreshTechnicianHoursForJobId(supabase, newJob.id);
          if (rh?.error) console.error("refreshTechnicianHoursForJobId:", rh.error);
        } catch (e) {
          console.error("refreshTechnicianHoursForJobId:", e);
        }
      }
    }

    createdJobs.push(newJob);
  }

  return createdJobs;
}

export {
  createRepeatSiblingJobs,
  deriveBaseJobNumber,
  extractSequenceFromJobNumber,
  padSequenceNumber,
};
