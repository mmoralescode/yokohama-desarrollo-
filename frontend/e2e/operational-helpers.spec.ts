import {expect, test} from "@playwright/test";
import {localDate, localDateTime, mexicoDateTimeToISO} from "../lib/dates";
import {compareUrgency} from "../lib/fleet-order";
import type {VehicleSummary} from "../lib/types";

test("Mexico City date is independent of the host clock zone", () => {
  expect(localDate(new Date("2026-09-22T02:30:00Z"))).toBe("2026-09-21");
  expect(localDateTime(new Date("2026-09-22T02:30:00Z"))).toBe("2026-09-21T20:30");
});

test("datetime input resolves current and historical Mexico City offsets", () => {
  expect(mexicoDateTimeToISO("2026-07-20T08:15")).toBe("2026-07-20T14:15:00.000Z");
  expect(mexicoDateTimeToISO("2021-07-20T08:15")).toBe("2021-07-20T13:15:00.000Z");
  expect(mexicoDateTimeToISO("2021-01-20T08:15")).toBe("2021-01-20T14:15:00.000Z");
});

test("invalid dates, missing times, and DST gaps are not silently shifted", () => {
  expect(() => mexicoDateTimeToISO("2026-02-30T12:30")).toThrow("no existe");
  expect(() => mexicoDateTimeToISO("2026-09-21")).toThrow("fecha y hora");
  expect(() => mexicoDateTimeToISO("2021-04-04T02:30")).toThrow("no existe");
  expect(() => mexicoDateTimeToISO("2021-10-31T01:30")).toThrow("ambigua");
});

test("fleet urgency precedes visit dates and does not mutate the input", () => {
  const vehicle = (id: number, traffic_light: VehicleSummary["traffic_light"], next_visit_date: string | null, open_alerts = 0) => ({id, plate: `TEST-${id}`, traffic_light, next_visit_date, open_alerts}) as VehicleSummary;
  const vehicles = [vehicle(1, "green", "2026-09-21"), vehicle(2, "red", "2026-09-30"), vehicle(3, "amber", null), vehicle(4, "red", "2026-09-22"), vehicle(5, "gray", null)];
  expect([...vehicles].sort(compareUrgency).map(item => item.id)).toEqual([4, 2, 3, 5, 1]);
  expect(vehicles.map(item => item.id)).toEqual([1, 2, 3, 4, 5]);
});
