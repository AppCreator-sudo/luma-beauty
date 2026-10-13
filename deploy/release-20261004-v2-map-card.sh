#!/bin/bash
set -euo pipefail
base=/opt/atelie
tag=20261004-v2-map-card
previous="$base/releases/20261003-v2-map-viewport"
release="$base/releases/$tag"
backup="$base/backups/$tag"
exec 9> "$base/.release.lock"; flock -n 9
[ "$(readlink -f "$base/current")" = "$previous" ]
[ ! -e "$release" ]; [ ! -e "$backup" ]
printf '8e8d6f0a3ccaaec00ae33130a5e86966c28b30dcaab70c06ee0d4b7bf6a4fec1  %s\n' "$base/atelie-$tag.tar.gz" | sha256sum -c -
umask 077
mkdir -p "$release" "$backup"; chmod 755 "$release"; chmod 700 "$backup"
tar -xzf "$base/atelie-$tag.tar.gz" -C "$release"
ln -s "$(readlink -f "$previous/node_modules")" "$release/node_modules"
# Keep resources used by tabs that were opened before this release.
cp -an "$previous/public/v2/assets/." "$release/public/v2/assets/"
chmod -R a+rX "$release/public" "$release/lib" "$release/scripts"
for file in "$release/server.mjs" "$release"/lib/*.mjs "$release/public/sw.js"; do node --check "$file"; done
# There is no schema change in this release. Rollback preserves all live writes.
rollback() {
  status=$?; trap - ERR
  systemctl stop atelie || true
  ln -sfn "$previous" "$base/current.rollback"; mv -Tf "$base/current.rollback" "$base/current"
  systemctl start atelie
  echo 'Release failed; previous code restored; shared database preserved'
  exit "$status"
}
trap rollback ERR
systemctl stop atelie
python3 - "$backup" <<'PY'
import sqlite3,pathlib,sys,os,shutil
backup=pathlib.Path(sys.argv[1]);src=sqlite3.connect('/opt/atelie/shared/atelie.sqlite');dst=sqlite3.connect(backup/'atelie.sqlite');src.backup(dst);src.close();dst.close();os.chmod(backup/'atelie.sqlite',0o600)
shutil.copy2('/etc/atelie.env',backup/'atelie.env');os.chmod(backup/'atelie.env',0o600)
PY
ln -sfn "$release" "$base/current.next"; mv -Tf "$base/current.next" "$base/current"
systemctl start atelie
curl -fsS --retry 8 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:3100/api/health > /dev/null
python3 - "$backup" <<'PY'
import sqlite3,pathlib,sys,urllib.request,urllib.parse,json,re
before=sqlite3.connect(pathlib.Path(sys.argv[1])/'atelie.sqlite');after=sqlite3.connect('file:/opt/atelie/shared/atelie.sqlite?mode=ro',uri=True)
assert after.execute('PRAGMA quick_check').fetchone()[0]=='ok';assert not list(after.execute('PRAGMA foreign_key_check'))
for table in ['users','profiles','profile_categories','services','works','work_images','appointments','availability_slots','workspaces','performers','master_schedules','guest_bookings','booking_venues','staff_invitations','identities','follows','reviews','saved_works','promotions','promotion_events','schema_migrations']:
  assert before.execute('SELECT * FROM '+table+' ORDER BY rowid').fetchall()==after.execute('SELECT * FROM '+table+' ORDER BY rowid').fetchall(),table
origin='http://127.0.0.1:3100'
def request(url):
  with urllib.request.urlopen(origin+url,timeout=10) as r:
    assert r.status==200,url
    return r.read().decode()
for url in ['/api/health','/api/search/masters','/api/map/masters','/v2/studio','/v2/salon']:
  request(url)
all_map=json.loads(request('/api/map/viewport?bbox=-180,-90,180,90&zoom=0'))
soon=json.loads(request('/api/map/viewport?bbox=-180,-90,180,90&zoom=0&soon=true'))
assert len(all_map['points'])+len(all_map['clusters'])<=300
assert all_map['total']==len(all_map['points'])+sum(c['count'] for c in all_map['clusters'])
assert soon['total']<=all_map['total']
assert not any(p.get('promotion') for p in all_map['items'])
for p in soon['items']:
  slot=p['availability'];assert soon['checked_at']<slot['start']<=soon['checked_at']+3600000
  assert slot['end']-slot['start']==slot['service']['duration']*60000
if all_map['items']:
  p=all_map['items'][0]
  detail=json.loads(request('/api/map/details?'+urllib.parse.urlencode({'kind':p.get('kind','master'),'id':p['user_id']})))
  assert detail['profile']['user_id']==p['user_id'];assert 'private_note' not in detail
  assert not detail['profile'].get('promotion')
html=request('/v2/')
for asset in re.findall(r'(?:src|href)="(/v2/assets/[^"]+)"',html):request(asset)
assert 'atelie-v2-shell-20261004-map-card' in request('/sw.js')
print('MAP CARD RELEASE CHECK: business data and schema preserved; DB/FK/APIs/assets/PWA OK; promotions OFF')
print('PUBLIC MAP COUNTS',json.dumps({'all':all_map['total'],'soon':soon['total']}))
PY
curl -fsS --max-time 15 https://atelie-13-143-66-1.sslip.io/v2/map -o /dev/null
systemctl is-active --quiet atelie
trap - ERR
printf 'PUBLISHED ';readlink -f "$base/current"
printf 'BACKUP %s\n' "$backup"
