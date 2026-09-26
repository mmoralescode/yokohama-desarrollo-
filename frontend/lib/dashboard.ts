import type {Alert, Severity, VehicleSummary, Visit} from "./types";

const DAY = 86_400_000;
const severityOrder: Record<Severity, number> = {critico: 0, importante: 1, menor: 2};
const monthFormatter = new Intl.DateTimeFormat("es-MX", {month: "short", year: "numeric", timeZone: "UTC"});

function validDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function monthStartAt(today: string, offset: number): string {
  const instant = new Date(`${today}T00:00:00Z`);
  instant.setUTCDate(1);
  instant.setUTCMonth(instant.getUTCMonth() + offset);
  return instant.toISOString().slice(0, 10);
}

/** Date-only arithmetic: the browser's time zone never moves a service to another day. */
export function dashboardRange(today: string): {start: string; end: string; monthStart: string; weekEnd: string} {
  if (!validDay(today)) throw new RangeError("Indica una fecha válida para el resumen.");
  const weekEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * DAY).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.parse(`${monthStartAt(today, 1)}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  return {start: monthStartAt(today, -5), end: monthEnd > weekEnd ? monthEnd : weekEnd, monthStart: monthStartAt(today, 0), weekEnd};
}

export interface DashboardPriority {
  vehicle: VehicleSummary;
  alerts: Alert[];
  topAlert: Alert | null;
  severity: Severity;
  deadline: string | null;
}

export interface DashboardSummary {
  range: ReturnType<typeof dashboardRange>;
  totalVehicles: number;
  criticalUnits: number;
  activeAlerts: Alert[];
  upcoming: Visit[];
  pastAppointments: Visit[];
  upcomingScheduled: number;
  upcomingProposed: number;
  completedMonth: number;
  priority: DashboardPriority[];
  missingDrivers: VehicleSummary[];
  missingCatalog: VehicleSummary[];
  insufficientData: VehicleSummary[];
  monthlyActivity: {month: string; label: string; count: number}[];
}

function deadlineOrder(a: string | null, b: string | null): number {
  return (a || "9999-12-31").localeCompare(b || "9999-12-31");
}

function criticalFault(alert: Alert | null): boolean {
  return alert?.kind === "fault" && alert.severity === "critico";
}

function compareAlerts(a: Alert, b: Alert): number {
  return severityOrder[a.severity] - severityOrder[b.severity]
    || Number(criticalFault(b)) - Number(criticalFault(a))
    || deadlineOrder(validDay(a.deadline) ? a.deadline : null, validDay(b.deadline) ? b.deadline : null)
    || a.key.localeCompare(b.key);
}

/** Read-only administrative totals; no prediction or mechanical safety claim is derived here. */
export function buildDashboard(vehicles: VehicleSummary[], entries: Visit[], alerts: Alert[], today: string): DashboardSummary {
  const range = dashboardRange(today);
  const fleet = [...new Map(vehicles.map(vehicle => [vehicle.id, vehicle])).values()];
  const vehicleIds = new Set(fleet.map(vehicle => vehicle.id));
  const activeAlerts = alerts.filter(alert => alert.status === "open" && vehicleIds.has(alert.vehicle_id));
  const criticalIds = new Set([
    ...fleet.filter(vehicle => vehicle.traffic_light === "red").map(vehicle => vehicle.id),
    ...activeAlerts.filter(alert => alert.severity === "critico").map(alert => alert.vehicle_id),
  ]);

  // Immediate/overdue technical recommendations belong in priorities, not in a
  // list of ordinary future appointments. A registered date never clears them.
  const upcoming = entries.filter(entry => entry.vehicle_id != null && vehicleIds.has(entry.vehicle_id)
    && !["completed", "cancelled", "canceled", "immediate", "overdue"].includes(entry.status)
    && (entry.status === "proposed" || entry.status === "scheduled" || !!entry.appointment_id)
    && validDay(entry.planned_date) && entry.planned_date >= today && entry.planned_date <= range.weekEnd)
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date)
      || (a.vehicle_id || 0) - (b.vehicle_id || 0) || a.id.localeCompare(b.id));
  const upcomingScheduled = upcoming.filter(entry => entry.status === "scheduled" || !!entry.appointment_id).length;
  // Administrative dates needing reconciliation, not proof that work was missed:
  // the company may capture a completed service several days after the fact.
  const pastAppointments = entries.filter(entry => entry.vehicle_id != null && vehicleIds.has(entry.vehicle_id)
    && !["completed", "cancelled", "canceled", "immediate", "overdue"].includes(entry.status)
    && (entry.status === "scheduled" || !!entry.appointment_id)
    && validDay(entry.planned_date) && entry.planned_date >= range.start && entry.planned_date < today)
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date)
      || (a.vehicle_id || 0) - (b.vehicle_id || 0) || a.id.localeCompare(b.id));

  const monthlyActivity = Array.from({length: 6}, (_, index) => {
    const start = monthStartAt(today, index - 5);
    return {month: start.slice(0, 7), label: monthFormatter.format(new Date(`${start}T00:00:00Z`)), count: 0};
  });
  const months = new Map(monthlyActivity.map(month => [month.month, month]));
  const counted = new Set<string>();
  for (const entry of entries) {
    if (entry.status !== "completed" || entry.vehicle_id == null || !vehicleIds.has(entry.vehicle_id)) continue;
    // captured_at is deliberately ignored: a late invoice belongs to the work's real month.
    const performed = entry.performed_on ?? entry.planned_date;
    if (!validDay(performed) || performed > today || performed < range.start) continue;
    const month = months.get(performed.slice(0, 7));
    if (!month) continue;
    for (const service of entry.service_ids) {
      if (!service.trim()) continue;
      const key = JSON.stringify([entry.vehicle_id, performed, service]);
      if (counted.has(key)) continue;
      counted.add(key);
      month.count++;
    }
  }

  const technicalAlerts = new Map<number, Alert[]>();
  for (const alert of activeAlerts) {
    if (alert.kind !== "maintenance" && alert.kind !== "fault") continue;
    const list = technicalAlerts.get(alert.vehicle_id) || [];
    list.push(alert);
    technicalAlerts.set(alert.vehicle_id, list);
  }
  const priority = fleet.flatMap<DashboardPriority>(vehicle => {
    const rows = (technicalAlerts.get(vehicle.id) || []).sort(compareAlerts);
    if (!rows.length && vehicle.traffic_light !== "red" && vehicle.traffic_light !== "amber") return [];
    const topAlert = rows[0] || null;
    const statusSeverity = vehicle.traffic_light === "red" ? "critico" : vehicle.traffic_light === "amber" ? "importante" : "menor";
    const severity = topAlert && severityOrder[topAlert.severity] < severityOrder[statusSeverity] ? topAlert.severity : statusSeverity;
    // A registered appointment is not a technical deadline, even when the unit
    // is critical. Only display a limit explicitly supplied by its top alert.
    const topDeadline = topAlert?.deadline;
    const deadline = validDay(topDeadline) ? topDeadline : null;
    return [{vehicle, alerts: rows, topAlert, severity, deadline}];
  }).sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    // Reported critical faults must remain visible above old maintenance limits.
    || Number(criticalFault(b.topAlert)) - Number(criticalFault(a.topAlert))
    || deadlineOrder(a.deadline, b.deadline) || a.vehicle.plate.localeCompare(b.vehicle.plate));

  return {
    range, totalVehicles: fleet.length, criticalUnits: criticalIds.size, activeAlerts, upcoming, pastAppointments, upcomingScheduled,
    upcomingProposed: upcoming.length - upcomingScheduled, completedMonth: monthlyActivity[5].count, priority,
    missingDrivers: fleet.filter(vehicle => !vehicle.drivers?.some(name => name.trim())),
    missingCatalog: fleet.filter(vehicle => !vehicle.maintenance_catalog?.trim()),
    insufficientData: fleet.filter(vehicle => vehicle.traffic_light === "gray"), monthlyActivity,
  };
}
