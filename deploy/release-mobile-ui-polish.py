"""One code-only Luma release: mobile drawer blur lag fix, client cabinet toggle fix, map footer and compact footer layout.
Runs on the existing server, creates no accounts. Preserves existing data, uploads and configuration.
"""
import base64,fcntl,hashlib,json,os,pathlib,pwd,re,secrets,shutil,signal,socket,sqlite3,subprocess,sys,tarfile,time,urllib.request

BASE=pathlib.Path('/opt/atelie')
PHASE,TAG,BASELINE,ARCHIVE_SHA,ENTRY=sys.argv[1:]
assert PHASE in ('preflight','publish','audit','qa-open','qa-close')
assert all(re.fullmatch(r'\d{8}-v2-[a-z0-9-]+',value) for value in (TAG,BASELINE))
assert re.fullmatch(r'[a-f0-9]{64}',ARCHIVE_SHA)
assert re.fullmatch(r'index-[A-Za-z0-9_-]+\.js',ENTRY)
OLD=BASE/'releases'/BASELINE;RELEASE=BASE/'releases'/TAG;BACKUP=BASE/'backups'/TAG
ARCHIVE=BASE/('atelie-'+TAG+'.tar.gz');SHARED=BASE/'shared';DB=SHARED/'atelie.sqlite'
SMOKE=BASE/'staging'/(TAG+'-smoke');QA=BACKUP/'qa-session.json'
ALLOWED_NEW_TABLES=set()
ALLOWED_NEW_INDEXES=set()
os.umask(0o077)
lock=open(BASE/'.release.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)

def run(*args):
    return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()

def sha(file):
    digest=hashlib.sha256()
    with open(file,'rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()

def write_private(file,value):
    file.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');file.chmod(0o600)

def connect(file):
    connection=sqlite3.connect(file.as_uri()+'?mode=ro',uri=True)
    assert connection.execute('PRAGMA integrity_check').fetchall()==[('ok',)],'Database integrity failed'
    assert not connection.execute('PRAGMA foreign_key_check').fetchall(),'Foreign key check failed'
    return connection

def signatures(file,excluded=()):
    db=connect(file);tables={}
    for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        if name in excluded:continue
        rows=db.execute('SELECT * FROM "'+name.replace('"','""')+'"').fetchall()
        values=sorted(json.dumps(row,ensure_ascii=False,default=lambda value:base64.b64encode(value).decode()) for row in rows)
        tables[name]={'rows':len(rows),'sha256':hashlib.sha256('\n'.join(values).encode()).hexdigest()}
    schema=db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall();db.close()
    return {'schema':schema,'tables':tables}

def verify_safe_evolution(current,baseline_sig,allowed_tables=ALLOWED_NEW_TABLES,allowed_indexes=ALLOWED_NEW_INDEXES):
    # 1. All baseline tables must be preserved exactly
    for name,info in baseline_sig['tables'].items():
        assert name in current['tables'], f"Baseline table missing: {name}"
        assert current['tables'][name]==info, f"Baseline table modified: {name}"
    # 2. Any new tables must be explicitly allowed and start empty
    for name,info in current['tables'].items():
        if name not in baseline_sig['tables']:
            assert name in allowed_tables, f"Unexpected new table: {name}"
            assert info['rows']==0, f"New table {name} not empty: {info['rows']}"
    # 3. All baseline schema items must be preserved exactly
    b_map={(r[0],r[1]):list(r) for r in baseline_sig['schema']}
    c_map={(r[0],r[1]):list(r) for r in current['schema']}
    for key,row in b_map.items():
        assert key in c_map, f"Baseline schema item dropped: {key}"
        assert c_map[key]==row, f"Baseline schema item modified: {key}"
    # 4. Any new schema items must be allowed tables or allowed indexes
    for key,row in c_map.items():
        if key not in b_map:
            kind,name=key
            if kind=='table':assert name in allowed_tables, f"Unexpected new table in schema: {name}"
            elif kind=='index':assert name in allowed_indexes, f"Unexpected new index: {name}"
            else:raise AssertionError(f"Unexpected new schema item: {key}")
    return True

def snapshot(destination):
    destination.unlink(missing_ok=True)
    connection=sqlite3.connect(DB);connection.execute('VACUUM INTO ?',(str(destination),));connection.close()
    destination.chmod(0o600);return sha(destination)

def media():
    uploads=SHARED/'uploads';items={}
    for path in uploads.rglob('*'):
        if path.is_file():items[path.relative_to(uploads).as_posix()]={'bytes':path.stat().st_size,'sha256':sha(path)}
    return items

def baseline():
    assert OLD.is_dir(),'Baseline release directory missing: '+BASELINE
    assert (OLD/'server.mjs').is_file() and (OLD/'public/sw.js').is_file()
    assert (BASE/'current').resolve()==OLD.resolve(),'Baseline release is not currently active'

def manifest():
    assert ARCHIVE.is_file(),'Release archive missing: '+ARCHIVE.name
    assert sha(ARCHIVE)==ARCHIVE_SHA,'Release archive SHA256 mismatch'
    with tarfile.open(ARCHIVE) as archive:
        item=archive.extractfile('release-manifest.json');assert item,'release-manifest.json missing'
        record=json.loads(item.read().decode('utf-8'))
    assert record['tag']==TAG and record['baseline']==BASELINE and record['entry']==ENTRY
    return record

def check_files(record):
    for relative,expected in record['files'].items():
        file=RELEASE/relative;assert file.is_file(),'Deployed file missing: '+relative
        assert sha(file)==expected,'Deployed file SHA256 mismatch: '+relative

def get(port,path,cookie=None):
    headers={'User-Agent':'Luma-Release-Verifier/1.0'}
    if cookie:headers['Cookie']=cookie
    request=urllib.request.Request(f'http://127.0.0.1:{port}{path}',headers=headers)
    with urllib.request.urlopen(request,timeout=10) as response:return response.read()

def healthy(port):
    deadline=time.time()+20
    while time.time()<deadline:
        try:
            body=json.loads(get(port,'/api/health'))
            if body.get('ok') is True:return True
        except Exception:pass
        time.sleep(0.3)
    raise TimeoutError('Process failed to become healthy on port '+str(port))

def select_master(db):
    row=db.execute("SELECT u.id,u.login,p.slug FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.account_type='master' AND p.published=1 ORDER BY u.created LIMIT 1").fetchone()
    if row:return row
    return db.execute("SELECT u.id,u.login,p.slug FROM users u JOIN profiles p ON p.user_id=u.id WHERE p.published=1 ORDER BY u.created LIMIT 1").fetchone()

def session(db,user):
    token=secrets.token_urlsafe(32);digest=hashlib.sha256(token.encode()).hexdigest();now=int(time.time()*1000)
    db.execute('INSERT INTO sessions(token,user_id,expires,authenticated_at) VALUES(?,?,?,?)',(digest,user,now+15*60000,now));db.commit()
    return token,digest

def read_checks(port,token=None):
    cookie='atelie_session='+token if token else None;checks=[]
    for route,kind in [('/api/health',dict),('/api/me',dict),('/api/profiles',list),('/api/inspiration',dict),('/api/map/viewport?bbox=37.5,55.6,37.8,55.9&zoom=12',dict),('/api/stories/active',list),('/v2/',None),('/sw.js',None)]:
        body=get(port,route,cookie);assert body;checks.append(route)
        if kind:
            value=json.loads(body);assert isinstance(value,kind),'Unexpected API response: '+route
            if route=='/api/health':assert value.get('ok') is True
            if route=='/api/me':assert 'user' in value and 'profile' in value
            if route=='/api/inspiration':assert isinstance(value.get('items'),list)
            if route.startswith('/api/map/viewport'):assert isinstance(value.get('points'),list) and isinstance(value.get('items'),list)
            if route=='/api/stories/active':assert isinstance(value,list)
        if route=='/v2/':assert ENTRY.encode() in body
        if route=='/sw.js':assert ('luma-v2-shell-'+TAG).encode() in body
    assert get(port,'/v2/assets/'+ENTRY);checks.append('entry-asset')
    if token:
        studio=json.loads(get(port,'/api/studio',cookie));assert studio.get('profile');checks.extend(['/api/studio'])
    return checks

def switch(target):
    temporary=BASE/('.current-'+TAG)
    assert not temporary.exists() and not temporary.is_symlink(),'Temporary switch link already exists'
    temporary.symlink_to(target);os.replace(temporary,BASE/'current')

if PHASE=='preflight':
    baseline();record=manifest()
    with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',3292))!=0,'Smoke port already in use'
    assert sha(OLD/'package.json')==record['dependency_files']['package.json']
    assert sha(OLD/'package-lock.json')==record['dependency_files']['package-lock.json']
    assert not RELEASE.exists() and not BACKUP.exists() and not SMOKE.exists(),'Release/preflight already exists; inspect rather than overwrite'
    BACKUP.mkdir(mode=0o700,parents=True);initial_sha=snapshot(BACKUP/'atelie.sqlite')
    shutil.copyfile('/etc/atelie.env',BACKUP/'atelie.env');(BACKUP/'atelie.env').chmod(0o600)
    original=signatures(BACKUP/'atelie.sqlite',('sessions','pushes'));original_media=media()
    write_private(BACKUP/'baseline-signatures.json',original)
    write_private(BACKUP/'baseline-media.json',original_media)
    RELEASE.mkdir(mode=0o755,parents=True);run('cp','-a',str(OLD)+'/.',str(RELEASE)+'/')
    with tarfile.open(ARCHIVE) as archive:
        for name in record['files']:
            target=RELEASE/name;assert target.resolve().is_relative_to(RELEASE),'Overlay target escapes release'
            target.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
            with archive.extractfile(name) as source,open(target,'wb') as output:shutil.copyfileobj(source,output)
            target.chmod(0o644)
    check_files(record);run('/usr/local/bin/node','--check',str(RELEASE/'server.mjs'));run('/usr/local/bin/node','--check',str(RELEASE/'public/sw.js'))
    SMOKE.mkdir(mode=0o700,parents=True);shutil.copyfile(BACKUP/'atelie.sqlite',SMOKE/'atelie.sqlite')
    shutil.copytree(SHARED/'uploads',SMOKE/'uploads')
    if (SHARED/'vapid.json').exists():shutil.copyfile(SHARED/'vapid.json',SMOKE/'vapid.json')
    db=sqlite3.connect(SMOKE/'atelie.sqlite');db.execute('DELETE FROM sessions');db.execute('DELETE FROM pushes');db.commit();person=select_master(db)
    token,digest=session(db,person[0]) if person else (None,None);db.close()
    account=pwd.getpwnam('atelie')
    for folder,dirs,files in os.walk(SMOKE):
        os.chown(folder,account.pw_uid,account.pw_gid);os.chmod(folder,0o700)
        for name in files:os.chown(pathlib.Path(folder)/name,account.pw_uid,account.pw_gid);os.chmod(pathlib.Path(folder)/name,0o600)
    env={'PATH':'/usr/local/bin:/usr/bin:/bin','NODE_ENV':'test','DATA_DIR':str(SMOKE),'PORT':'3292','APP_ORIGIN':'http://127.0.0.1:3292','DADATA_API_KEY':'','DADATA_SECRET_KEY':'','PROMOTIONS_ENABLED':'0'}
    output=open(SMOKE/'server.log','w');os.chown(SMOKE/'server.log',account.pw_uid,account.pw_gid)
    proc=subprocess.Popen(['/usr/sbin/runuser','-u','atelie','--','/usr/local/bin/node',str(RELEASE/'server.mjs')],cwd=RELEASE,env=env,stdout=output,stderr=output,start_new_session=True)
    try:
        healthy(3292);checks=read_checks(3292,token)
        assert verify_safe_evolution(signatures(SMOKE/'atelie.sqlite',('sessions','pushes')),original),'Snapshot changed unexpectedly on startup/read checks'
    finally:
        os.killpg(proc.pid,signal.SIGTERM);proc.wait(timeout=10)
    shutil.rmtree(SMOKE)
    summary={'phase':'preflight','tag':TAG,'baseline':BASELINE,'checks':checks,'backup_snapshot_sha256':initial_sha,'baseline_tables':len(original['tables']),'baseline_media':len(original_media),'ready_for_publish':True}
    write_private(BACKUP/'preflight-summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False))

elif PHASE=='publish':
    baseline();record=manifest();assert RELEASE.is_dir() and BACKUP.is_dir(),'Preflight must run before publish'
    check_files(record)
    stopped=False;switched=False
    try:
        run('systemctl','stop','atelie');stopped=True
        pre_switch_sha=snapshot(BACKUP/'pre-switch.sqlite')
        pre_switch=signatures(BACKUP/'pre-switch.sqlite',('sessions','pushes'))
        preflight_original=json.loads((BACKUP/'baseline-signatures.json').read_text(encoding='utf-8'))
        assert verify_safe_evolution(pre_switch,preflight_original),'Shared database state diverged safely checked baseline'
        run('tar','-czf',str(BACKUP/'files.tar.gz'),'-C',str(SHARED),'.')
        switch(RELEASE);switched=True
        run('systemctl','start','atelie');stopped=False;healthy(3100)
    except Exception as failure:
        if switched:
            try:switch(OLD)
            except Exception:pass
        if stopped or switched:
            try:run('systemctl','start','atelie');healthy(3100)
            except Exception:pass
        raise RuntimeError('Publish failed; rolled back to '+BASELINE) from failure
    checks=read_checks(3100);active_signatures=signatures(DB,('sessions','pushes'))
    assert verify_safe_evolution(active_signatures,pre_switch),'Active database modified unexpectedly during release startup'
    summary={'phase':'publish','tag':TAG,'baseline':BASELINE,'active_release':str(RELEASE),'checks':checks,'pre_switch_sha256':pre_switch_sha,'active_tables':len(active_signatures['tables']),'status':'active'}
    write_private(BACKUP/'publish-summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False))

elif PHASE=='audit':
    assert (BASE/'current').resolve()==RELEASE.resolve(),'Release is not active'
    record=manifest();check_files(record)
    assert run('systemctl','is-active','atelie')=='active','Service is not active'
    checks=read_checks(3100);db_checks=connect(DB);db_checks.close()
    summary={'phase':'audit','tag':TAG,'service':'active','health':'ok','files_verified':len(record['files']),'checks':checks,'shared_db_intact':True}
    write_private(BACKUP/'audit-summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False))

elif PHASE=='qa-open':
    assert (BASE/'current').resolve()==RELEASE.resolve(),'Release is not active'
    assert not QA.exists(),'QA session already open'
    db=sqlite3.connect(DB);person=select_master(db);token,digest=session(db,person[0]) if person else (None,None);db.close()
    assert token,'No published master available for QA session'
    write_private(QA,{'token_sha256':digest,'created_at':int(time.time()),'expires_in_seconds':900,'master_slug':person[2],'master_login':person[1]})
    print(json.dumps({'token':token,'master_slug':person[2],'expires_in_seconds':900},ensure_ascii=False))

elif PHASE=='qa-close':
    if QA.exists():
        info=json.loads(QA.read_text(encoding='utf-8'));db=sqlite3.connect(DB)
        db.execute('DELETE FROM sessions WHERE token=?',(info['token_sha256'],));db.commit();db.close();QA.unlink()
        print(json.dumps({'qa_closed':True},ensure_ascii=False))
    else:print(json.dumps({'qa_closed':False,'reason':'no_session'},ensure_ascii=False))
