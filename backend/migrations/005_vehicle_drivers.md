# Schema v5: multiple drivers per vehicle

The SQLite v4→v5 upgrade only adds `vehicles.drivers JSON NOT NULL DEFAULT '[]'`.
Every existing unit starts with an empty assignment; migration never invents
driver names or changes plates, Mazda models, service history, administrative
dates, or saved forecasts. No table rebuild or seed operation is performed.

Before changing a recognized database, startup creates and integrity-checks an
online backup, including committed WAL pages. A direct v4 upgrade uses a
`*.pre-v5-*.bak` backup; an older upgrade keeps its original pre-upgrade backup.
Schema validation and the added column/version are transactional. Backup or
validation failure aborts the upgrade, and repeat startup is idempotent.

POST `/api/vehicles` accepts optional `drivers: string[]`, defaulting to `[]`.
PATCH `/api/vehicles/{id}` replaces the assignments when `drivers` is supplied;
omitting it leaves them unchanged, while `[]` explicitly clears them. Fleet
and vehicle-detail responses include the list. A driver name can be associated
with multiple vehicles, and each vehicle can have multiple names.

Lists allow up to 20 names of 1–100 characters each. Whitespace is normalized,
and case-insensitive duplicates are removed in original order. Explicit null,
blank names, non-string entries, and excessive lengths/counts are rejected.
These are administrative names, not authentication accounts or unique person
identifiers.
