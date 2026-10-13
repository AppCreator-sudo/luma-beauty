"""Operator-only read-only comparison. Never prints personal rows or rewrites data."""
import argparse, json, sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('before')
parser.add_argument('after')
parser.add_argument('--migration', action='store_true')
args = parser.parse_args()
def connect(file):
    return sqlite3.connect(Path(file).resolve().as_uri() + '?mode=ro', uri=True)
def quote(name):
    return '"' + name.replace('"', '""') + '"'
with connect(args.before) as before, connect(args.after) as after:
    assert after.execute('PRAGMA quick_check').fetchone()[0] == 'ok', 'Integrity check failed'
    assert not after.execute('PRAGMA foreign_key_check').fetchall(), 'Foreign keys failed'
    # Preserve all original application/derived data; transient provider caches
    # and sessions may expire normally while the service is accepting requests.
    transient = {'sessions', 'oauth_states', 'geocode_cache', 'geocode_throttle', 'address_cache', 'address_budget', 'address_choices'}
    tables = [row[0] for row in before.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    checked = 0
    for table in tables:
        if table in transient or table == 'schema_migrations':
            continue
        columns = [row[1] for row in before.execute('PRAGMA table_info(' + quote(table) + ')')]
        new_columns = [row[1] for row in after.execute('PRAGMA table_info(' + quote(table) + ')')]
        assert all(column in new_columns for column in columns), 'Lost column in ' + table
        allowed = ['logo', 'cover'] if args.migration and table == 'workspaces' else []
        assert new_columns == columns + [name for name in allowed if name not in columns], 'Unexpected columns in ' + table
        select = 'SELECT ' + ','.join(map(quote, columns)) + ' FROM ' + quote(table)
        # Canonical comparison is independent of RTree/internal row ordering.
        key = lambda row: repr(row)
        assert sorted(before.execute(select).fetchall(), key=key) == sorted(after.execute(select).fetchall(), key=key), 'Data changed in ' + table
        checked += 1
    migrations_before = dict(before.execute('SELECT name,created FROM schema_migrations'))
    migrations_after = dict(after.execute('SELECT name,created FROM schema_migrations'))
    for name, timestamp in migrations_before.items():
        assert migrations_after.get(name) == timestamp, 'Previous migration changed'
    expected = set(migrations_before) | ({'salon-visual-v1'} if args.migration else set())
    assert set(migrations_after) == expected, 'Unexpected migration marker'
    if args.migration:
        assert not after.execute("SELECT 1 FROM workspaces WHERE logo<>'' OR cover<>'' LIMIT 1").fetchone(), 'Migration invented media'
    print(json.dumps({'checkedTables':checked,'businessDataPreserved':True,'foreignKeys':True,'integrity':True,'migration':args.migration}))
