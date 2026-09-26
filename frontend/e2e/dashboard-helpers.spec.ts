import {expect, test} from "@playwright/test";
import {buildDashboard, dashboardRange} from "../lib/dashboard";
import {localDate} from "../lib/dates";
import type {Alert, VehicleSummary, Visit} from "../lib/types";

function vehicle(id = 1, changes: Partial<VehicleSummary> = {}): VehicleSummary {
  return {id, vin: `TEST${String(id).padStart(13, "0")}`, plate: `TST-${id}`, make: "Toyota", model: "Corolla", model_year: 2025,
    variant_id: null, version: "Base", body_style: "sedan", engine: "2.0", transmission: "AT", drive: "FWD",
    current_km: 10000, in_service_date: "2025-01-01", usage_regime: "normal", is_synthetic: true,
    maintenance_catalog: "example", drivers: ["Andrea Torres"], traffic_light: "green", next_visit_date: null,
    open_alerts: 0, usage_km_per_day: null, ...changes};
}
function entry(id: string, date: string, changes: Partial<Visit> = {}): Visit {
  return {id, vehicle_id: 1, planned_date: date, status: "completed", service_ids: ["oil"],
    total_duration_hours: null, explanation: "", provisional: false, ...changes};
}
function alert(key: string, changes: Partial<Alert> = {}): Alert {
  return {key, vehicle_id: 1, service_id: "oil", fault_id: null, severity: "importante", message: "Revisar unidad",
    deadline: null, days_remaining: null, threshold_days: null, status: "open", kind: "maintenance", ...changes};
}

test("rango cubre seis meses completos y siete días incluso al cambiar de año", () => {
  expect(dashboardRange("2026-12-29")).toEqual({start: "2026-07-01", end: "2027-01-04", monthStart: "2026-12-01", weekEnd: "2027-01-04"});
  expect(dashboardRange("2026-01-01")).toEqual({start: "2025-08-01", end: "2026-01-31", monthStart: "2026-01-01", weekEnd: "2026-01-07"});
  expect(dashboardRange("2024-02-28").end).toBe("2024-03-05");
  expect(dashboardRange("2024-02-01").end).toBe("2024-02-29");
  expect(() => dashboardRange("2026-02-29")).toThrow(RangeError);
});

test("la fecha operativa de México no se desplaza al mes UTC siguiente", () => {
  const today = localDate(new Date("2026-10-01T03:00:00Z"));
  expect(today).toBe("2026-09-30");
  const result = buildDashboard([vehicle()], [entry("real", "2026-09-30")], [], today);
  expect(result.range.monthStart).toBe("2026-09-01");
  expect(result.completedMonth).toBe(1);
});

test("flotilla vacía conserva seis meses con ceros sin porcentajes inventados", () => {
  const result = buildDashboard([], [], [], "2026-01-12");
  expect(result.totalVehicles).toBe(0);
  expect(result.criticalUnits).toBe(0);
  expect(result.completedMonth).toBe(0);
  expect(result.upcoming).toEqual([]);
  expect(result.pastAppointments).toEqual([]);
  expect(result.priority).toEqual([]);
  expect(result.monthlyActivity.map(month => [month.month, month.count])).toEqual([
    ["2025-08", 0], ["2025-09", 0], ["2025-10", 0], ["2025-11", 0], ["2025-12", 0], ["2026-01", 0],
  ]);
});

test("captura tardía cuenta por fecha real y deduplica trabajos parciales del mismo día", () => {
  const entries = [
    entry("partial-a", "2026-09-20", {performed_on: "2026-08-30", service_ids: ["oil", "brakes"], captured_at: "2026-09-20T20:00:00Z"}),
    entry("partial-b", "2026-08-30", {service_ids: ["brakes", "tires", "tires"]}),
    entry("another-unit", "2026-08-30", {vehicle_id: 2}),
    entry("this-month", "2026-09-01", {service_ids: ["oil", "brakes"]}),
    entry("another-day", "2026-09-03"),
  ];
  const result = buildDashboard([vehicle(), vehicle(2)], entries, [], "2026-09-26");
  expect(result.monthlyActivity.find(month => month.month === "2026-08")?.count).toBe(4);
  expect(result.completedMonth).toBe(3);
  expect(entries[0].service_ids).toEqual(["oil", "brakes"]);
});

test("ignora fechas inválidas, trabajos futuros, huérfanos y registros no realizados", () => {
  const entries = [entry("bad", "2026-02-30"), entry("bad-explicit", "2026-09-01", {performed_on: "no-date"}),
    entry("future", "2026-09-27"), entry("old", "2026-03-31"), entry("orphan", "2026-09-01", {vehicle_id: 999}),
    entry("unknown-unit", "2026-09-01", {vehicle_id: undefined}), entry("pending", "2026-09-01", {status: "scheduled"}),
    entry("no-services", "2026-09-01", {service_ids: [""]}), entry("valid", "2026-04-01")];
  const result = buildDashboard([vehicle()], entries, [], "2026-09-26");
  expect(result.monthlyActivity.map(month => month.count)).toEqual([1, 0, 0, 0, 0, 0]);
});

test("agenda distingue fechas registradas de propuestas sin convertir urgencias en citas", () => {
  const entries = [entry("last-day", "2026-10-02", {status: "scheduled"}), entry("today", "2026-09-26", {status: "proposed"}),
    entry("stored", "2026-09-27", {status: "rescheduled", appointment_id: "a"}),
    entry("tomorrow", "2026-09-27", {status: "proposed"}), entry("old", "2026-09-25", {status: "scheduled"}),
    entry("outside", "2026-10-03", {status: "scheduled"}), entry("cancelled", "2026-09-27", {status: "cancelled", appointment_id: "c"}),
    entry("urgent", "2026-09-26", {status: "immediate"}), entry("overdue", "2026-09-26", {status: "overdue"}),
    entry("unknown", "2026-09-26", {status: "unknown"}), entry("done", "2026-09-26"),
    entry("orphan", "2026-09-26", {status: "proposed", vehicle_id: 999}), entry("bad-date", "2026-09-31", {status: "proposed"})];
  const result = buildDashboard([vehicle()], entries, [], "2026-09-26");
  expect(result.upcoming.map(row => row.id)).toEqual(["today", "stored", "tomorrow", "last-day"]);
  expect(result.upcomingScheduled).toBe(2);
  expect(result.upcomingProposed).toBe(2);
});

test("cuenta unidades críticas una sola vez y sólo considera alertas abiertas de la flotilla", () => {
  const vehicles = [vehicle(1, {traffic_light: "red"}), vehicle(2), vehicle(3)];
  const alerts = [alert("one", {severity: "critico"}), alert("two", {severity: "critico"}),
    alert("another", {vehicle_id: 2, severity: "critico"}), alert("closed", {vehicle_id: 3, severity: "critico", status: "closed"}),
    alert("missing-status", {vehicle_id: 3, severity: "critico", status: ""}), alert("orphan", {vehicle_id: 999, severity: "critico"})];
  const result = buildDashboard(vehicles, [], alerts, "2026-09-26");
  expect(result.criticalUnits).toBe(2);
  expect(result.activeAlerts.map(row => row.key)).toEqual(["one", "two", "another"]);
});

test("prioriza por gravedad y fecha, separando pendientes administrativos del riesgo técnico", () => {
  const vehicles = [vehicle(1, {traffic_light: "amber"}), vehicle(2, {traffic_light: "red", next_visit_date: "2026-09-20"}),
    vehicle(3), vehicle(4, {traffic_light: "gray", maintenance_catalog: null, drivers: []}),
    vehicle(5, {drivers: ["  "]}), vehicle(6)];
  const alerts = [alert("important", {deadline: "2026-09-01"}),
    alert("critical-late", {vehicle_id: 3, severity: "critico", deadline: "2026-09-25"}),
    alert("critical-first", {vehicle_id: 3, severity: "critico", deadline: "2026-09-19"}),
    alert("data", {vehicle_id: 4, kind: "data"}), alert("driver", {vehicle_id: 5, kind: "driver"}),
    alert("minor", {vehicle_id: 6, severity: "menor", deadline: "invalid"})];
  const result = buildDashboard(vehicles, [], alerts, "2026-09-26");
  expect(result.priority.map(row => row.vehicle.id)).toEqual([3, 2, 1, 6]);
  expect(result.priority[0].topAlert?.key).toBe("critical-first");
  expect(result.priority[0].alerts.map(row => row.key)).toEqual(["critical-first", "critical-late"]);
  expect(result.priority[1].topAlert).toBeNull();
  expect(result.priority[1].deadline).toBeNull();
  expect(result.priority[3].deadline).toBeNull();
  expect(result.missingDrivers.map(row => row.id)).toEqual([4, 5]);
  expect(result.missingCatalog.map(row => row.id)).toEqual([4]);
  expect(result.insufficientData.map(row => row.id)).toEqual([4]);
  expect(alerts[0].key).toBe("important");
});

test("una fecha administrativa no sustituye un límite técnico ausente y no muta las entradas", () => {
  const unit = vehicle(1, {traffic_light: "red", next_visit_date: "2026-12-31"});
  const technical = alert("fault", {kind: "fault", severity: "critico", deadline: null});
  const visits = [entry("later", "2026-09-28", {status: "proposed"}), entry("earlier", "2026-09-26", {status: "scheduled"})];
  const original = JSON.stringify({unit, technical, visits});
  const result = buildDashboard([unit], visits, [technical], "2026-09-26");
  expect(result.priority[0].deadline).toBeNull();
  expect(result.criticalUnits).toBe(1);
  expect(result.upcoming.map(row => row.id)).toEqual(["earlier", "later"]);
  expect(JSON.stringify({unit, technical, visits})).toBe(original);
  for (const invalid of ["2026-00-01", "2026-13-01", "2026-04-31", "2026-1-01", "2026-09-26T00:00:00Z"]) {
    expect(() => dashboardRange(invalid)).toThrow(RangeError);
  }
});

test("fechas pasadas por revisar incluye sólo agenda registrada del periodo y la flotilla", () => {
  const entries = [entry("yesterday", "2026-09-25", {status: "scheduled"}),
    entry("first-day", "2026-04-01", {status: "rescheduled", appointment_id: "first"}),
    entry("old", "2026-03-31", {status: "scheduled"}), entry("today", "2026-09-26", {status: "scheduled"}),
    entry("tomorrow", "2026-09-27", {status: "scheduled"}), entry("proposal", "2026-09-24", {status: "proposed"}),
    entry("completed", "2026-09-24", {appointment_id: "done"}),
    entry("cancelled", "2026-09-24", {status: "cancelled", appointment_id: "cancelled"}),
    entry("immediate", "2026-09-24", {status: "immediate", appointment_id: "immediate"}),
    entry("overdue", "2026-09-24", {status: "overdue", appointment_id: "overdue"}),
    entry("invalid", "2026-04-31", {status: "scheduled"}),
    entry("orphan", "2026-09-24", {status: "scheduled", vehicle_id: 999})];
  const before = JSON.stringify(entries);
  const result = buildDashboard([vehicle()], entries, [], "2026-09-26");
  expect(result.pastAppointments.map(row => row.id)).toEqual(["first-day", "yesterday"]);
  expect(result.criticalUnits).toBe(0);
  expect(result.priority).toEqual([]);
  expect(JSON.stringify(entries)).toBe(before);
});

test("fallas críticas reportadas preceden a mantenimiento crítico vencido sin alterar los pronósticos", () => {
  const vehicles = [vehicle(1, {traffic_light: "red"}), vehicle(2, {traffic_light: "red"}), vehicle(3, {traffic_light: "red"})];
  const alerts = [alert("oil-first-unit", {vehicle_id: 1, severity: "critico", deadline: "2026-09-01"}),
    alert("brakes-today", {vehicle_id: 1, kind: "fault", severity: "critico", deadline: "2026-09-26"}),
    alert("oil-older", {vehicle_id: 2, severity: "critico", deadline: "2026-08-01"}),
    alert("fault-tomorrow", {vehicle_id: 3, kind: "fault", severity: "critico", deadline: "2026-09-27"})];
  const original = JSON.stringify({vehicles, alerts});
  const result = buildDashboard(vehicles, [], alerts, "2026-09-26");
  expect(result.priority.map(row => row.vehicle.id)).toEqual([1, 3, 2]);
  expect(result.priority[0].topAlert?.key).toBe("brakes-today");
  expect(result.priority[0].alerts.map(row => row.key)).toEqual(["brakes-today", "oil-first-unit"]);
  expect(result.priority[0].deadline).toBe("2026-09-26");
  expect(result.criticalUnits).toBe(3);
  expect(JSON.stringify({vehicles, alerts})).toBe(original);
});
