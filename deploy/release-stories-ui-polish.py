"""One code-only Luma release: stories UI polish and avatar ring fix (F-14).
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
    b_map={(r[0],r[1]):r for r in baseline_sig['schema']}
    c_map={(r[0],r[1]):r for r in current['schema']}
    for k,v in b_map.items():
        assert k in c_map, f"Schema item missing: {k}"
        assert c_map[k]==v, f"Schema item changed: {k}"
    # 4. Any new schema items must be explicitly allowed
    for k in c_map:
        if k not in b_map:
            kind,name=k
            if kind=='table':assert name in allowed_tables, f"Unexpected schema table: {name}"
            elif kind=='index':assert name in allowed_indexes, f"Unexpected schema index: {name}"
            else:raise AssertionError(f"Unexpected schema item: {k}")
    return True

def media():
    files={str(file.relative_to(SHARED)):sha(file) for file in (SHARED/'uploads').rglob('*') if file.is_file()}
    if (SHARED/'vapid.json').is_file():files['vapid.json']=sha(SHARED/'vapid.json')
    return files

def snapshot(destination):
    with sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True) as source,sqlite3.connect(destination) as target:source.backup(target)
    destination.chmod(0o600);return sha(destination)

def get(port,route,cookie=None):
    headers={'Cookie':cookie} if cookie else {}
    request=urllib.request.Request('http://127.0.0.1:'+str(port)+route,headers=headers)
    with urllib.request.urlopen(request,timeout=5) as response:return response.read()

def healthy(port):
    for _ in range(50):
        try:
            if json.loads(get(port,'/api/health')).get('ok') is True:return
        except Exception:pass
        time.sleep(.2)
    raise RuntimeError('Health did not become ready')

def baseline():
    assert (BASE/'current').resolve()==OLD,'Production baseline changed'
    assert run('systemctl','is-active','atelie')=='active','Service is not active'
    healthy(3100)

def manifest():
    assert sha(ARCHIVE)==ARCHIVE_SHA,'Archive digest mismatch'
    with tarfile.open(ARCHIVE) as archive:
        record=json.load(archive.extractfile('release-manifest.json'))
        assert record['tag']==TAG and record['baseline']==BASELINE
        assert set(archive.getnames())==set(record['files'])|{'release-manifest.json'}
        for item in archive.getmembers():
            assert item.isfile() and not pathlib.PurePosixPath(item.name).is_absolute() and '..' not in pathlib.PurePosixPath(item.name).parts,'Unsafe archive member'
    return record

def check_files(record):
    for name,digest in record['files'].items():
        target=RELEASE/name
        assert target.resolve().is_relative_to(RELEASE),'Release file escapes release directory'
        assert sha(target)==digest,'Release digest mismatch: '+name

def select_master(db):
    return db.execute("SELECT u.id FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.account_type='master' ORDER BY (SELECT COUNT(*) FROM works w WHERE w.user_id=u.id)+(SELECT COUNT(*) FROM services s WHERE s.user_id=u.id) DESC,u.id LIMIT 1").fetchone()

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
        assert run('systemctl','is-active','atelie')=='active' and (BASE/'current').resolve()==OLD
    finally:
        try:os.killpg(proc.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=5)
        output.close()
    with socket.socket() as probe:assert probe.connect_ex(('127.0.0.1',3292))!=0,'Smoke child still listening'
    assert SMOKE.resolve()==BASE/'staging'/(TAG+'-smoke') and SMOKE.is_relative_to(BASE/'staging')
    shutil.rmtree(SMOKE)
    result={'tag':TAG,'baseline':BASELINE,'at':time.time(),'archive_sha256':ARCHIVE_SHA,'backup':str(BACKUP),'snapshot_sha256':initial_sha,'files':len(record['files']),'tables':len(original['tables']),'rows':sum(value['rows'] for value in original['tables'].values()),'schema_and_business_preserved':True,'production_data_not_replaced':True,'read_checks':checks,'smoke_stopped':True,'smoke_copy_removed':True,'entry':ENTRY}
    write_private(BACKUP/'preflight.json',result);print(json.dumps(result))
elif PHASE=='publish':
    baseline();record=manifest();check_files(record);preflight=json.loads((BACKUP/'preflight.json').read_text());assert preflight['archive_sha256']==ARCHIVE_SHA
    inode=(DB.stat().st_ino,(SHARED/'uploads').stat().st_ino);switched=False;stopped=False
    try:
        run('systemctl','stop','atelie');stopped=True
        previous_media=media()
        final_sha=snapshot(BACKUP/'pre-switch.sqlite');before=signatures(DB)
        with tarfile.open(BACKUP/'files.tar.gz','w:gz') as archive:
            archive.add(SHARED/'uploads',arcname='uploads')
            if (SHARED/'vapid.json').exists():archive.add(SHARED/'vapid.json',arcname='vapid.json')
        (BACKUP/'files.tar.gz').chmod(0o600)
        write_private(BACKUP/'pre-switch-signatures.json',before);write_private(BACKUP/'pre-switch-media.json',previous_media)
        assert (BASE/'current').resolve()==OLD;switch(RELEASE);switched=True
        assert signatures(DB)==before and media()==previous_media,'Data changed during code switch'
        assert inode==(DB.stat().st_ino,(SHARED/'uploads').stat().st_ino),'Shared data replaced'
        run('systemctl','start','atelie');stopped=False;healthy(3100)
        checks=read_checks(3100);assert verify_safe_evolution(signatures(DB),before),'Schema or data changed unexpectedly on startup'
        assert run('systemctl','is-active','atelie')=='active';check_files(record)
        result={'tag':TAG,'previous':BASELINE,'at':time.time(),'current':str((BASE/'current').resolve()),'entry':ENTRY,'service':'active','health':True,'schema_evolution_verified':True,'preserved_tables':len(before['tables']),'preserved_rows_at_switch':sum(item['rows'] for item in before['tables'].values()),'business_sessions_media_preserved_at_switch':True,'shared_inodes_preserved':True,'backup':str(BACKUP),'pre_switch_sha256':final_sha,'files':len(record['files']),'read_checks':checks,'rollback':'Code-only switch to '+BASELINE+'; retain current shared database/uploads'}
        write_private(BACKUP/'release-result.json',result);print(json.dumps(result))
    except BaseException:
        if switched:
            run('systemctl','stop','atelie');switch(OLD)
        if stopped or switched:run('systemctl','start','atelie');healthy(3100)
        write_private(BACKUP/'failed-release.json',{'tag':TAG,'rolled_back_to':str((BASE/'current').resolve()),'database_restored':False})
        raise
elif PHASE=='audit':
    assert (BASE/'current').resolve()==RELEASE;healthy(3100);record=manifest();check_files(record);db=connect(DB);db.close()
    result={'tag':TAG,'current':str(RELEASE),'active':run('systemctl','is-active','atelie'),'health':True,'files_verified':len(record['files']),'integrity':'ok','foreign_keys':[],'qa_session_removed':not QA.exists(),'read_checks':read_checks(3100)}
    write_private(BACKUP/'server-audit.json',result);print(json.dumps(result))
elif PHASE=='qa-open':
    assert (BASE/'current').resolve()==RELEASE and not QA.exists()
    db=sqlite3.connect(DB);person=select_master(db);assert person,'No existing independent master for private read-only browser check'
    token,digest=session(db,person[0]);db.close();write_private(QA,{'token':token,'digest':digest})
    print(json.dumps({'token':token,'origin':'https://atelie-13-143-66-1.sslip.io','expires_in_seconds':900}))
elif PHASE=='qa-close':
    if QA.exists():
        record=json.loads(QA.read_text());db=sqlite3.connect(DB);db.execute('DELETE FROM sessions WHERE token=?',(record['digest'],));db.commit();assert db.execute('SELECT COUNT(*) FROM sessions WHERE token=?',(record['digest'],)).fetchone()[0]==0;db.close();QA.unlink()
    print(json.dumps({'qa_session_removed':True}))
