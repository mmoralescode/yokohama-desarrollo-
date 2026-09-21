"""Consistent SQLite backups and non-destructive restore verification.

python -m app.backup backup --source data/yokohama.db --target /secure/copy.bak
python -m app.backup restore --source /secure/copy.bak --target /new/recovered.db
Targets must NOT already exist; this command never replaces a database.
"""
import argparse
from pathlib import Path
import sqlite3


def verified_copy(source: Path, target: Path) -> dict:
    source, target = source.resolve(strict=True), target.resolve()
    if source == target:
        raise ValueError("Origen y destino deben ser distintos.")
    # Exclusive creation protects against accidental replacement and races.
    with target.open("xb"):
        pass
    try:
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as original, sqlite3.connect(target) as copy:
            original.backup(copy)
            if copy.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or copy.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("No se pudo verificar la integridad del respaldo.")
            tables = copy.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        return {"verified": True, "tables": len(tables), "target": str(target)}
    except Exception:
        # Preserve failed target for diagnosis, never replace an existing file.
        raise RuntimeError(f"Copia incompleta; no usar el destino {target}. El origen no se modificó.") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["backup", "restore"])
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    print(verified_copy(args.source, args.target))


if __name__ == "__main__":
    main()
