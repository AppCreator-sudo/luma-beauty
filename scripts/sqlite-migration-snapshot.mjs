// Operator-only preparation. Never imports the application, changes its schema, or connects to a provider.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMAT = 'atelie-sqlite-migration-snapshot-v1';
const DERIVED_MAP_TABLES = new Set(['map_locations', 'map_spatial', 'map_spatial_node', 'map_spatial_rowid', 'map_spatial_parent']);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
const fail = code => { const error = new Error(code); error.snapshotCode = code; throw error; };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const encode = value => value === null ? null : typeof value === 'bigint' ? ['integer', String(value)]
  : typeof value === 'number' ? ['real', value] : typeof value === 'string' ? ['text', value]
    : value instanceof Uint8Array ? ['blob', Buffer.from(value).toString('base64')] : fail('UNSUPPORTED_SQLITE_VALUE');

function safeDirectory(directory) {
  const output = path.resolve(directory);
  // Private files must never enter a served directory or a dependency/release payload.
  for (const forbidden of ['public', 'frontend', 'node_modules', 'deploy']) {
    if (inside(path.join(ROOT, forbidden), output)) fail('OUTPUT_NOT_PRIVATE');
  }
  let ancestor = path.dirname(output);
  while (true) {
    if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) fail('OUTPUT_SYMLINK');
    const parent = path.dirname(ancestor);
    if (ancestor === parent) break;
    ancestor = parent;
  }
  if (fs.existsSync(output)) fail('OUTPUT_ALREADY_EXISTS');
  if (!fs.statSync(path.dirname(output)).isDirectory()) fail('OUTPUT_PARENT_MISSING');
  fs.mkdirSync(output, { mode: 0o700 });
  try {
    if (process.platform === 'win32') {
      const result = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
      const sid = result.match(/S-1-5-(?:\d+-)*\d+/)?.[0];
      if (!sid) fail('PRIVATE_ACL_FAILED');
      // The new directory has no explicit ACEs. Remove inherited access before writing data.
      execFileSync('icacls.exe', [output, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'pipe', windowsHide: true });
    } else {
      fs.chmodSync(output, 0o700);
      if ((fs.statSync(output).mode & 0o777) !== 0o700) fail('PRIVATE_PERMISSIONS_FAILED');
    }
  } catch {
    // This directory is still empty; preserve it for inspection, without private contents.
    fail('PRIVATE_ACL_FAILED');
  }
  return output;
}

function writePrivate(directory, filename, value) {
  const contents = JSON.stringify(value, null, 2) + '\n';
  fs.writeFileSync(path.join(directory, filename), contents, { flag: 'wx', mode: 0o600 });
  return sha256(contents);
}

function readiness(db, tables) {
  const names = new Set(tables.map(table => table.name));
  const columns = new Map(tables.map(table => [table.name, new Set(table.columns.map(column => column.name))]));
  const has = (table, ...fields) => names.has(table) && fields.every(field => columns.get(table).has(field));
  const count = sql => db.prepare(sql).get().n;
  const report = {
    integrity: db.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check),
    foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all(),
    nullPrimaryKeys: [], invalidFlags: [], invalidCoordinates: [], checksSkipped: [],
  };
  for (const table of tables) {
    const keys = table.columns.filter(column => column.pk);
    if (keys.length) {
      const n = count(`SELECT COUNT(*) n FROM ${quote(table.name)} WHERE ${keys.map(column => quote(column.name) + ' IS NULL').join(' OR ')}`);
      if (n) report.nullPrimaryKeys.push({ table: table.name, count: n });
    }
  }
  for (const [table, fields] of Object.entries({ profiles: ['published', 'teaches', 'is_demo'], performers: ['active', 'bookable'], works: ['pinned'], appointments: ['reminded'], promotions: ['catalog', 'map'] })) {
    for (const field of fields) if (has(table, field)) {
      const n = count(`SELECT COUNT(*) n FROM ${quote(table)} WHERE ${quote(field)} IS NULL OR ${quote(field)} NOT IN (0,1)`);
      if (n) report.invalidFlags.push({ table, column: field, count: n });
    }
  }
  for (const table of ['profiles', 'workspaces']) if (has(table, 'latitude', 'longitude')) {
    const n = count(`SELECT COUNT(*) n FROM ${quote(table)} WHERE (latitude IS NULL)<>(longitude IS NULL) OR latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180`);
    if (n) report.invalidCoordinates.push({ table, count: n });
  }
  if (has('appointments', 'id', 'master_id', 'start', 'end', 'status')) {
    report.invalidAppointmentTimes = count('SELECT COUNT(*) n FROM appointments WHERE start IS NULL OR end IS NULL OR end<=start OR typeof(start)<>\'integer\' OR typeof(end)<>\'integer\'');
    report.invalidAppointmentStatuses = count("SELECT COUNT(*) n FROM appointments WHERE status IS NULL OR status NOT IN ('pending','confirmed','cancelled','done')");
    const shared = has('performers', 'id', 'user_id');
    report.activeOverlapPairs = count(`SELECT COUNT(*) n FROM appointments a JOIN appointments b ON a.id<b.id AND a.start<b.end AND a.end>b.start
      ${shared ? 'JOIN performers pa ON pa.id=a.master_id JOIN performers pb ON pb.id=b.master_id' : ''}
      WHERE a.status IN ('pending','confirmed') AND b.status IN ('pending','confirmed')
      AND (a.master_id=b.master_id${shared ? ' OR (pa.user_id IS NOT NULL AND pa.user_id=pb.user_id)' : ''})`);
    if (!shared) report.checksSkipped.push('shared-person-calendar-overlaps');
  } else report.checksSkipped.push('appointment-time-status-and-overlaps');
  if (has('master_schedules', 'weekdays')) {
    report.invalidWeekdays = 0;
    for (const row of db.prepare('SELECT weekdays FROM master_schedules').iterate()) {
      try {
        const days = JSON.parse(row.weekdays);
        if (!Array.isArray(days) || days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length) report.invalidWeekdays++;
      } catch { report.invalidWeekdays++; }
    }
  } else report.checksSkipped.push('schedule-weekdays');
  const failed = report.integrity.length !== 1 || report.integrity[0] !== 'ok' || report.foreignKeyViolations.length > 0
    || report.nullPrimaryKeys.length > 0 || report.invalidFlags.length > 0 || report.invalidCoordinates.length > 0
    || (report.invalidAppointmentTimes || 0) > 0 || (report.invalidAppointmentStatuses || 0) > 0
    || (report.activeOverlapPairs || 0) > 0 || (report.invalidWeekdays || 0) > 0;
  report.dataChecksPassed = !failed && report.checksSkipped.length === 0;
  report.postgresMigrationImplemented = false;
  return report;
}

export function exportSnapshot(databaseFile, outputDirectory) {
  const source = path.resolve(databaseFile);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) fail('SOURCE_MISSING');
  const output = safeDirectory(outputDirectory);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN');
    // The first read fixes the snapshot; all subsequent schema, data, and checks use that transaction.
    const objects = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
    const virtualMap = objects.find(object => object.type === 'table' && object.name === 'map_spatial');
    if (virtualMap && !/\bUSING\s+rtree\s*\(\s*id\s*,\s*min_longitude\s*,\s*max_longitude\s*,\s*min_latitude\s*,\s*max_latitude\s*\)/i.test(virtualMap.sql || '')) fail('UNKNOWN_MAP_DERIVED_SCHEMA');
    const tableKinds = new Map(db.prepare('PRAGMA table_list').all().map(table => [table.name, table.type]));
    const tables = [];
    const tableObjects = objects.filter(object => object.type === 'table');
    for (const [index, object] of tableObjects.entries()) {
      const derived = DERIVED_MAP_TABLES.has(object.name);
      if (derived && object.name !== 'map_locations' && (!virtualMap || (object.name !== 'map_spatial' && tableKinds.get(object.name) !== 'shadow'))) fail('UNKNOWN_MAP_DERIVED_SCHEMA');
      if (!derived && /\bCREATE\s+VIRTUAL\s+TABLE\b/i.test(object.sql || '')) fail('VIRTUAL_TABLE_REQUIRES_REVIEW');
      const columns = db.prepare(`PRAGMA table_xinfo(${quote(object.name)})`).all();
      if (object.name === 'map_locations' && columns.map(column => column.name).join(',') !== 'id,kind,target_id,latitude,longitude') fail('UNKNOWN_MAP_DERIVED_SCHEMA');
      if (columns.some(column => column.hidden)) fail('GENERATED_COLUMN_REQUIRES_REVIEW');
      const columnNames = new Set(columns.map(column => column.name.toLowerCase()));
      const rowidColumn = /\bWITHOUT\s+ROWID\b/i.test(object.sql || '') ? null
        : ['rowid', '_rowid_', 'oid'].find(name => !columnNames.has(name)) || null;
      const aliases = ['__atelie_snapshot_rowid__', '__atelie_snapshot_rowid_2__'];
      const alias = aliases.find(name => !columnNames.has(name));
      if (rowidColumn && !alias) fail('ROWID_ALIAS_CONFLICT');
      const primaryKey = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
      const indexes = db.prepare(`PRAGMA index_list(${quote(object.name)})`).all().map(item => ({ ...item, columns: db.prepare(`PRAGMA index_xinfo(${quote(item.name)})`).all() }));
      const metadata = { name: object.name, internal: object.name.startsWith('sqlite_'), columns, primaryKey, foreignKeys: db.prepare(`PRAGMA foreign_key_list(${quote(object.name)})`).all(), indexes };
      if (derived) {
        tables.push({ ...metadata, exportMode: 'inventory-only-derived', rows: db.prepare(`SELECT COUNT(*) n FROM ${quote(object.name)}`).get().n, rebuildFrom: ['profiles', 'performers', 'workspaces'], preservesRowid: false });
        continue;
      }
      const order = rowidColumn ? quote(rowidColumn) : (primaryKey.length ? primaryKey : columns.map(column => column.name)).map(quote).join(',');
      const statement = db.prepare(`SELECT ${rowidColumn ? quote(rowidColumn) + ' AS ' + quote(alias) + ',' : ''}${columns.map(column => quote(column.name)).join(',')} FROM ${quote(object.name)}${order ? ' ORDER BY ' + order : ''}`);
      statement.setReadBigInts(true);
      const filename = `table-${String(index + 1).padStart(4, '0')}.ndjson`;
      const fd = fs.openSync(path.join(output, filename), 'wx', 0o600);
      const digest = createHash('sha256'); let rows = 0;
      try {
        for (const row of statement.iterate()) {
          const record = { cells: columns.map(column => encode(row[column.name])), ...(rowidColumn ? { sqliteRowid: String(row[alias]) } : {}) };
          const line = JSON.stringify(record) + '\n';
          fs.writeSync(fd, line); digest.update(line); rows++;
          if (!Number.isSafeInteger(rows)) fail('ROW_COUNT_OVERFLOW');
        }
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      tables.push({ ...metadata, exportMode: 'data', filename, rows, sha256: digest.digest('hex'), preservesRowid: Boolean(rowidColumn) });
    }
    const report = readiness(db, tables);
    const schemaSha256 = writePrivate(output, 'schema.json', { objects: objects.map(object => ({ ...object, exportMode: DERIVED_MAP_TABLES.has(object.tbl_name) || /\bmap_(?:locations|spatial)\b/i.test(object.sql || '') ? 'inventory-only-derived' : 'schema' })) });
    const reportSha256 = writePrivate(output, 'readiness.json', report);
    const manifest = {
      format: FORMAT, createdUtc: new Date().toISOString(), sqliteVersion: db.prepare('SELECT sqlite_version() v').get().v,
      valueEncoding: 'null or [integer, decimal string], [real, number], [text, string], [blob, base64]',
      permissions: process.platform === 'win32' ? 'Windows ACL: current user and SYSTEM only' : 'directory 0700; files 0600',
      consistentReadTransaction: true, schemaSha256, reportSha256, tables,
    };
    db.exec('COMMIT');
    writePrivate(output, 'manifest.json', manifest); // Completion marker is written last.
    return { tables: tables.length, rows: tables.filter(table => table.exportMode === 'data').reduce((sum, table) => sum + table.rows, 0), derivedTables: tables.filter(table => table.exportMode === 'inventory-only-derived').length, derivedRows: tables.filter(table => table.exportMode === 'inventory-only-derived').reduce((sum, table) => sum + table.rows, 0), dataChecksPassed: report.dataChecksPassed };
  } finally { try { db.exec('ROLLBACK'); } catch {} db.close(); }
}

export async function verifySnapshot(directory) {
  const output = path.resolve(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  if (manifest.format !== FORMAT || !Array.isArray(manifest.tables)) fail('INVALID_MANIFEST');
  for (const [file, checksum] of [['schema.json', manifest.schemaSha256], ['readiness.json', manifest.reportSha256]]) {
    if (sha256(fs.readFileSync(path.join(output, file))) !== checksum) fail('METADATA_CHECKSUM_MISMATCH');
  }
  const files = new Set(), names = new Set(); let total = 0, derivedTables = 0, derivedRows = 0;
  for (const table of manifest.tables) {
    if (names.has(table.name) || !Array.isArray(table.columns) || !Number.isSafeInteger(table.rows) || table.rows < 0) fail('INVALID_TABLE_MANIFEST');
    if (table.exportMode === 'inventory-only-derived') {
      if (!DERIVED_MAP_TABLES.has(table.name) || table.filename || table.sha256) fail('INVALID_DERIVED_TABLE');
      names.add(table.name); derivedTables++; derivedRows += table.rows; continue;
    }
    if (table.exportMode !== 'data' || !/^table-\d{4,}\.ndjson$/.test(table.filename) || files.has(table.filename)) fail('INVALID_TABLE_MANIFEST');
    files.add(table.filename); names.add(table.name);
    const digest = createHash('sha256'); let rows = 0;
    const stream = fs.createReadStream(path.join(output, table.filename));
    stream.on('data', chunk => digest.update(chunk));
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      const record = JSON.parse(line);
      if (!Array.isArray(record.cells) || record.cells.length !== table.columns.length) fail('INVALID_ROW_WIDTH');
      if (table.preservesRowid && !/^-?\d+$/.test(record.sqliteRowid || '')) fail('INVALID_ROWID');
      for (const cell of record.cells) {
        if (cell === null) continue;
        if (!Array.isArray(cell) || cell.length !== 2) fail('INVALID_CELL');
        const [kind, value] = cell;
        if (!(kind === 'integer' && typeof value === 'string' && /^-?\d+$/.test(value)
          || kind === 'real' && typeof value === 'number' && Number.isFinite(value)
          || kind === 'text' && typeof value === 'string'
          || kind === 'blob' && typeof value === 'string' && Buffer.from(value, 'base64').toString('base64') === value)) fail('INVALID_CELL');
      }
      rows++;
    }
    if (rows !== table.rows || digest.digest('hex') !== table.sha256) fail('TABLE_CHECKSUM_OR_COUNT_MISMATCH');
    total += rows;
  }
  return { tables: manifest.tables.length, rows: total, derivedTables, derivedRows, verified: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, ...args] = process.argv.slice(2);
    const option = name => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1]; };
    let result;
    if (operation === 'export' && option('--db') && option('--out') && args.length === 4) result = exportSnapshot(option('--db'), option('--out'));
    else if (operation === 'verify' && option('--dir') && args.length === 2) result = await verifySnapshot(option('--dir'));
    else fail('USAGE_EXPORT_DB_OUT_OR_VERIFY_DIR');
    console.log(JSON.stringify(result)); // Counts only. Credentials and personal data stay in private files.
  } catch (error) {
    console.error('Snapshot failed: ' + (error.snapshotCode || 'CHECK_FAILED'));
    process.exitCode = 1;
  }
}
