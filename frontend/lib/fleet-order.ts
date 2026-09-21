import type {VehicleSummary} from "./types";

/** Unknown condition stays ahead of green; dates break ties within urgency. */
export function compareUrgency(a: VehicleSummary, b: VehicleSummary): number {
  const rank = {red: 0, amber: 1, gray: 2, green: 3};
  return rank[a.traffic_light] - rank[b.traffic_light]
    || (a.next_visit_date || "9999").localeCompare(b.next_visit_date || "9999")
    || b.open_alerts - a.open_alerts
    || a.plate.localeCompare(b.plate);
}
