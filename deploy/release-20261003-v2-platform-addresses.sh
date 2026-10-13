#!/bin/bash
set -euo pipefail
base=/opt/atelie
tag=20261003-v2-platform-addresses
release="$base/releases/$tag"
previous="$base/releases/20261002-v2-map"
backup="$base/backups/$tag"
keyfile="$base/.address-env-$tag"
exec 9> "$base/.release.lock"
flock -n 9
[ "$(readlink -f "$base/current")" = "$previous" ]
[ -d "$release/node_modules" ]; [ -f "$release/server.mjs" ]; [ -f "$keyfile" ]
[ -f "$base/staging/$tag/restored.sqlite" ]; [ ! -e "$backup" ]
mkdir -p "$backup"; chmod 700 "$backup"
changed=0
rollback() {
  status=$?
  trap - ERR
  echo 'Release failed; restoring previous code, database and configuration'
  systemctl stop atelie || true
  if [ "$changed" = 1 ]; then
    python3 - "$backup" <<'PY'
import pathlib,sqlite3,sys,os,shutil
backup=pathlib.Path(sys.argv[1]);shared=pathlib.Path('/opt/atelie/shared')
for suffix in ['', '-wal','-shm']:(shared/('atelie.sqlite'+suffix)).unlink(missing_ok=True)
src=sqlite3.connect(backup/'atelie.sqlite');dst=sqlite3.connect(shared/'atelie.sqlite');src.backup(dst);dst.close();src.close()
shutil.chown(shared/'atelie.sqlite',user='atelie',group='atelie');os.chmod(shared/'atelie.sqlite',0o640)
shutil.copy2(backup/'atelie.env','/etc/atelie.env');os.chmod('/etc/atelie.env',0o600)
PY
  fi
  ln -sfn "$previous" "$base/current"
  systemctl start atelie
  curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3100/api/health
  exit "$status"
}
trap rollback ERR
systemctl stop atelie
python3 - "$backup" <<'PY'
import sqlite3,pathlib,shutil,sys,os,tarfile
backup=pathlib.Path(sys.argv[1]);shared=pathlib.Path('/opt/atelie/shared')
source=sqlite3.connect(shared/'atelie.sqlite');dest=sqlite3.connect(backup/'atelie.sqlite');source.backup(dest);dest.close();source.close()
os.chmod(backup/'atelie.sqlite',0o600)
shutil.copy2('/etc/atelie.env',backup/'atelie.env');os.chmod(backup/'atelie.env',0o600)
with tarfile.open(backup/'shared-files.tar.gz','w:gz') as archive:
  for p in shared.iterdir():
    if p.name not in ['atelie.sqlite','atelie.sqlite-wal','atelie.sqlite-shm','migration-backups','maintenance-backups']:archive.add(p,arcname=p.name)
os.chmod(backup/'shared-files.tar.gz',0o600)
print('BACKUP: consistent database, shared files, private configuration')
PY
changed=1
python3 - "$keyfile" <<'PY'
import pathlib,sys,os,re
env=pathlib.Path('/etc/atelie.env');key=pathlib.Path(sys.argv[1])
incoming=dict(l.split('=',1) for l in key.read_text().splitlines() if '=' in l)
assert re.fullmatch('[a-f0-9]{40}',incoming['DADATA_API_KEY'])
assert incoming['ADDRESS_DAILY_LIMIT']=='9000'
lines=[l for l in env.read_text().splitlines() if not l.startswith(('DADATA_API_KEY=','ADDRESS_DAILY_LIMIT='))]
lines+=['DADATA_API_KEY='+incoming['DADATA_API_KEY'],'ADDRESS_DAILY_LIMIT=9000']
temporary=env.with_name('atelie.env.next')
fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as f:f.write('\n'.join(lines)+'\n')
os.replace(temporary,env);key.unlink()
print('CONFIG: address API key installed server-side, mode 600')
PY
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl start atelie
curl -fsS --retry 8 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3100/api/health > /dev/null
python3 - "$backup" <<'PY'
import sqlite3,pathlib,sys,json,urllib.request,re
backup=pathlib.Path(sys.argv[1]);before=sqlite3.connect(backup/'atelie.sqlite');after=sqlite3.connect('file:/opt/atelie/shared/atelie.sqlite?mode=ro',uri=True)
assert after.execute('PRAGMA quick_check').fetchone()[0]=='ok'
assert not list(after.execute('PRAGMA foreign_key_check'))
tables=[r[0] for r in before.execute("SELECT name FROM sqlite_master WHERE type='table'")]
for table in tables:
  columns=[r[1] for r in before.execute('PRAGMA table_info('+table+')')]
  query='SELECT '+','.join('"'+c+'"' for c in columns)+' FROM "'+table+'" ORDER BY rowid'
  assert before.execute(query).fetchall()==after.execute(query).fetchall(), 'Original data changed: '+table
assert {r[0] for r in after.execute('SELECT name FROM schema_migrations')}=={'performers-v1','salon-public-v1','promotions-v1'}
origin='http://127.0.0.1:3100'
for url in ['/api/health','/api/profiles','/api/search/masters','/api/map/masters','/api/inspiration','/api/categories','/v2/','/v2/masters','/v2/map','/v2/studio','/v2/salon','/assets/dadata-logo.svg','/sw.js']:
  with urllib.request.urlopen(origin+url,timeout=8) as r: assert r.status==200,url
with urllib.request.urlopen(origin+'/v2/',timeout=8) as r:html=r.read().decode()
for asset in re.findall(r'(?:src|href)="(/v2/assets/[^"]+)"',html):
  with urllib.request.urlopen(origin+asset,timeout=8) as r: assert r.status==200,asset
with urllib.request.urlopen(origin+'/api/me',timeout=8) as r:
  body=r.read().decode();assert json.loads(body)['user'] is None
  assert 'DADATA_API_KEY' not in body
print('LIVE DATA:',json.dumps({t:after.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['users','profiles','services','works','appointments']}))
print('LIVE CHECKS: all original rows preserved, 3 migrations, foreign keys, main APIs, v2 routes and entry assets OK')
PY
systemctl is-active --quiet atelie
curl -fsS --max-time 15 https://atelie-13-143-66-1.sslip.io/v2/ -o /dev/null
trap - ERR
printf 'PUBLISHED '; readlink -f "$base/current"
printf 'BACKUP %s\n' "$backup"
