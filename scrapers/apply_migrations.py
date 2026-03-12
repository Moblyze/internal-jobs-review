"""Apply database migrations to scraper state database.

This script applies SQL migrations to add incremental scraping support.

Usage:
    python apply_migrations.py
"""

import os
import sqlite3
import sys
from pathlib import Path


def apply_migration(db_path: str, migration_path: str):
    """
    Apply a SQL migration file to the database.

    Args:
        db_path: Path to SQLite database
        migration_path: Path to SQL migration file
    """
    migration_name = Path(migration_path).name

    print(f"Applying migration: {migration_name}")

    # Read migration SQL
    with open(migration_path, 'r') as f:
        migration_sql = f.read()

    # Connect to database
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Execute migration (supports multiple statements)
        cursor.executescript(migration_sql)
        conn.commit()
        print(f"✓ Migration applied successfully: {migration_name}")

    except sqlite3.Error as e:
        print(f"✗ Migration failed: {migration_name}")
        print(f"  Error: {e}")
        conn.rollback()
        raise

    finally:
        conn.close()


def main():
    """Apply all pending migrations."""
    # Database path
    db_path = 'data/scraper_state.db'

    # Check if database exists
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        print("Please run a scrape first to initialize the database.")
        sys.exit(1)

    # Migrations directory
    migrations_dir = Path('migrations')

    # Find all SQL migration files
    migration_files = sorted(migrations_dir.glob('*.sql'))

    if not migration_files:
        print("No migration files found in migrations/")
        sys.exit(0)

    print(f"Found {len(migration_files)} migration(s)")
    print("-" * 60)

    # Apply each migration
    for migration_file in migration_files:
        apply_migration(db_path, str(migration_file))

    print("-" * 60)
    print(f"All migrations applied successfully!")
    print(f"\nDatabase: {db_path}")


if __name__ == '__main__':
    main()
