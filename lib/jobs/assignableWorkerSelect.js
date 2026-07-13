/** Shared helpers for assignable worker react-select dropdowns. */

export function mapAssignableWorkersToOptions(workers = []) {
  return (workers || []).map((worker) => ({
    value: worker.id,
    label: worker.fullName || worker.username,
    workerId: worker.id,
    technicianId: worker.technicianId,
    status: "ACTIVE",
  }));
}

export function mergeWorkerSelectOptions(workers = [], selectedWorkers = []) {
  const byValue = new Map((workers || []).map((w) => [w.value, w]));
  (selectedWorkers || []).forEach((sw) => {
    if (sw?.value != null && !byValue.has(sw.value)) {
      byValue.set(sw.value, sw);
    }
  });
  return Array.from(byValue.values());
}
