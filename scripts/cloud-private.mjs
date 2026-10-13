// Restore an authenticated encrypted transfer; never print private contents.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const root = process.cwd();
const source = path.join(root, '.local-data/cloud-source');
const access = path.join(root, '.local-data/cloud-access');
const dev = path.join(root, '.local-data/cloud-dev');
const defaultBundle = path.join(root, 'deploy/cloud-transfer/luma-private-20261014.enc');
const magic = Buffer.from('LUMABND1');

function secureParents(directory) {
  const relative = path.relative(root, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Outside checkout');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const info = fs.lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe output directory');
    } else fs.mkdirSync(current, {mode: 0o700});
  }
}

function readBundle(filename) {
  const key = Buffer.from(process.env.LUMA_PRIVATE_BUNDLE_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('LUMA_PRIVATE_BUNDLE_KEY must contain the supplied 32-byte key');
  const bytes = fs.readFileSync(filename);
  if (bytes.length < 36 || !bytes.subarray(0,8).equals(magic)) throw new Error('Unknown bundle format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(8,20));
  decipher.setAAD(magic);
  decipher.setAuthTag(bytes.subarray(20,36));
  const compressed = Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
  const payload = JSON.parse(zlib.gunzipSync(compressed, {maxOutputLength: 256*1024*1024}));
  if (payload.version !== 1 || !Array.isArray(payload.files)) throw new Error('Unknown payload version');
  const seen = new Set();
  const files = payload.files.map(item => {
    const parts = item.path.split('/');
    if (parts.some(p=>!p || p==='.' || p==='..' || p.includes('\\') || p.includes(':')) || seen.has(item.path)) throw new Error('Unsafe payload path');
    seen.add(item.path);
    let target;
    if (parts[0]==='data') target=source;
    else if (parts[0]==='access') target=access;
    else throw new Error('Unexpected payload root');
    const data=Buffer.from(item.content,'base64');
    if (crypto.createHash('sha256').update(data).digest('hex')!==item.sha256) throw new Error('Payload checksum mismatch');
    return {target:path.join(target,...parts.slice(1)), data};
  });
  return {payload,files};
}

async function prepareDev() {
  if (!fs.existsSync(path.join(source,'atelie.sqlite'))) throw new Error('Restore the source snapshot first');
  if (fs.existsSync(dev)) throw new Error('Existing cloud-dev must be preserved; choose a separate workspace');
  secureParents(dev);
  fs.copyFileSync(path.join(source,'atelie.sqlite'),path.join(dev,'atelie.sqlite'));
  fs.chmodSync(path.join(dev,'atelie.sqlite'),0o600);
  for (const folder of ['uploads','private-client']) {
    if (fs.existsSync(path.join(source,folder))) fs.cpSync(path.join(source,folder),path.join(dev,folder),{recursive:true,dereference:false});
  }
  const {DatabaseSync} = await import('node:sqlite');
  const db=new DatabaseSync(path.join(dev,'atelie.sqlite'));
  try {
    db.exec('BEGIN');
    for (const table of ['pushes','sessions']) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) db.exec(`DELETE FROM ${table}`);
    }
    db.exec('COMMIT');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Development-copy checks failed');
  } finally {db.close();}
  // No production VAPID/config is copied into the runtime folder.
  console.log(JSON.stringify({prepared:'.local-data/cloud-dev',originalSnapshotUnchanged:true,livePushSubscriptionsRemoved:true,liveSessionsRemoved:true}));
}

try {
  const [command='verify',filename=defaultBundle,...extra]=process.argv.slice(2);
  if (extra.length || !['verify','restore','prepare-dev'].includes(command)) throw new Error('Use verify, restore or prepare-dev');
  if (command==='prepare-dev') await prepareDev();
  else {
    const {payload,files}=readBundle(filename);
    if (command==='restore') {
      if (fs.existsSync(source)||fs.existsSync(access)) throw new Error('Existing private output must be preserved');
      for (const file of files) {
        secureParents(path.dirname(file.target));
        fs.writeFileSync(file.target,file.data,{flag:'wx',mode:0o600});
      }
    }
    console.log(JSON.stringify({operation:command,files:files.length,sourceRelease:payload.release,capturedAt:payload.capturedAt,checksums:'ok'}));
  }
} catch {
  console.error('Private transfer failed. Check the key, bundle, paths and whether an output copy already exists. Private values were not printed.');
  process.exitCode=1;
}
