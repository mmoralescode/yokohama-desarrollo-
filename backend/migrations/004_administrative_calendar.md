# Schema v4: administrative calendar and retrospective captures

Startup upgrades recognized v1/v2/v3 SQLite databases transactionally. Before
mutating an existing database it makes and verifies an online backup including
committed WAL data. No seeding is performed at startup.

- Existing service IDs, dates, odometers, notes, catalog snapshots, cost,
  classification, fault links and prediction evidence are preserved.
- `service_history.odometer_km` becomes nullable: an unknown historical reading
  stays unknown. Legacy `captured_at` and `appointment_id` remain null; capture
  timestamps are recorded for new entries without replacing `performed_on`.
- `calendar_appointments` stores administrative dates and component-cycle
  anchors independently of generated `visit_plans` and forecast snapshots.
  `appointment_changes` retains date changes. Partial work closes only those
  service lines actually captured; older backfilled history does not close a
  newer component cycle. Calendar completed entries use the actual service day.
- A batch capture is atomic. Duplicate component/day entries are rejected.
  Missing mileage prevents a kilometer-based forecast for that component;
  earlier historical mileage is never reused as a fictional latest reading.
  Descriptive manual work does not add Mazda rules to another vehicle.
- Only exact seeded `DEMO-001` through `DEMO-020` plates on synthetic rows with
  their matching seeded VIN are renamed `YKH-101-A` through `YKH-120-A`.
  Existing plate collisions are skipped and all other plates remain unchanged.

GET `/calendar` includes generated proposals, stored appointments and completed
service history. POST `/vehicles/{id}/appointments` creates a date;
PATCH `/vehicles/{id}/appointments/{uuid}` changes it; POST
`/vehicles/{id}/services/batch` captures selected completed work with its real
date, optional mileage and notes. Technical due dates are never rewritten by
an administrative reschedule.
