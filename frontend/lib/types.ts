export type Severity = "critico" | "importante" | "menor";
export type TrafficLight = "red" | "amber" | "green" | "gray";
export type Confidence = "alta" | "media" | "baja";
export interface Vehicle {
  id: number; vin: string; plate: string; model_year: number; variant_id: string;
  version: string; body_style: string; engine: string; transmission: string; drive: string;
  current_km: number; in_service_date: string; usage_regime: string; is_synthetic: boolean; severity_multiplier?: number;
}
export interface VehicleSummary extends Vehicle {traffic_light: TrafficLight; next_visit_date: string | null; open_alerts: number; usage_km_per_day: number | null}
export interface Reading {id: number; vehicle_id: number; date: string; recorded_at?: string; source?: "manual" | "gps" | "obd"; odometer_km: number}
export type MaintenanceType = "preventive" | "corrective" | "unknown";
export interface ServiceHistory {id: number; service_id: string; performed_on: string; odometer_km: number; notes: string; cost?: number | null; maintenance_type?: MaintenanceType; fault_id?: number | null; predicted_due_date?: string | null; prediction_error_days?: number | null}
export interface Fault {id: number; description: string; dtc: string | null; reported_on: string; severity: Severity; status: string; safe_to_defer: boolean; deadline: string | null; resolution_notes: string | null; assessment_message?: string; safety_evaluation?: string; service_id?: string | null; was_predicted?: boolean | null}
export interface Downtime {id: number; vehicle_id: number; started_at: string; ended_at: string | null; notes: string}
export interface VehicleDetail {vehicle: Vehicle; readings: Reading[]; history: ServiceHistory[]; faults: Fault[]; downtime?: Downtime[]}
export interface FleetMetrics {total_services: number; classified_services: number; preventive_services: number; services_before_failure_percent: number | null; prediction_samples: number; mean_absolute_error_days: number | null; mean_signed_error_days: number | null; unpredicted_failures: number; classified_failures: number; total_failures: number; downtime_days: number; open_downtimes: number; as_of: string; timezone: string}
export interface ServicePlan {
  service_id: string; name: string; action: string; status: string; due_date: string | null;
  latest_entry_date: string | null; due_odometer: number | null; km_remaining: number | null;
  severity: Severity; confidence: Confidence; window_start: string | null; window_end: string | null;
  prediction: {optimistic: string | null; probable: string | null; pessimistic: string | null};
  explanation: string; requires_validation: boolean; source_urls: string[]; duration_hours: number | null;
}
export interface Visit {id: string; planned_date: string; service_ids: string[]; fault_ids?: number[]; total_duration_hours: number | null; status: string; explanation: string; provisional: boolean; vehicle_id?: number; plate?: string; version?: string}
export interface Alert {id?: number; key: string; vehicle_id: number; plate?: string; service_id: string | null; fault_id: number | null; severity: Severity; message: string; deadline: string | null; days_remaining: number | null; threshold_days: number | null; status: string; kind: string}
export interface Plan {
  vehicle_id: number; generated_on: string; catalog_version: string; mode: string;
  usage: {km_per_day: number; low_km_per_day: number; high_km_per_day: number; confidence: Confidence; valid_intervals: number; rejected_readings: number; explanation: string};
  services: ServicePlan[]; visits: Visit[]; alerts: Alert[]; traffic_light: TrafficLight; warnings: string[];
}
export interface Variant {id: string; anio_modelo: number; carroceria: string; version: string; motor: string; transmisiones: string[]; traccion: string}
export interface Notification {id: number; channel?: string; status?: string; created_at?: string; message?: string; payload?: Record<string, unknown>; [key: string]: unknown}
