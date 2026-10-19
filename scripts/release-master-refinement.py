"""Package and publish the explicitly authorized code-only Luma master fixes."""
import hashlib,json,pathlib,re,shlex,sys,tarfile,io

ROOT=pathlib.Path(__file__).resolve().parents[1]
TAG='20261015-v2-master-refinement';BASELINE='20261015-v2-salon-simplicity'
OUT=ROOT/'docs/ui-checks/2026-10-15-master-release';OUT.mkdir(parents=True,exist_ok=True)
WORK=ROOT/'.cache/master-refinement-release';WORK.mkdir(parents=True,exist_ok=True)
ARCHIVE=WORK/('atelie-'+TAG+'.tar.gz');MANIFEST=OUT/'package-manifest.json'

def digest(file):return hashlib.sha256(file.read_bytes()).hexdigest()
def package():
    assert ('luma-v2-shell-'+TAG) in (ROOT/'public/sw.js').read_text(encoding='utf-8')
    entry=re.search(r'/v2/assets/(index-[A-Za-z0-9_-]+\.js)',(ROOT/'public/v2/index.html').read_text()).group(1)
    files=[ROOT/'server.mjs',ROOT/'public/sw.js']
    files+=[p for p in (ROOT/'lib').rglob('*') if p.is_file()]
    files+=[p for p in (ROOT/'public/v2').rglob('*') if p.is_file()]
    assert all(not p.is_symlink() and p.resolve().is_relative_to(ROOT) for p in files)
    assert not any(p.suffix in ('.env','.sqlite','.pem','.key') or 'secret' in p.name.lower() for p in files)
    record={'tag':TAG,'baseline':BASELINE,'entry':entry,'files':{p.relative_to(ROOT).as_posix():digest(p) for p in sorted(files)},'dependency_files':{p:digest(ROOT/p) for p in ['package.json','package-lock.json']}}
    release_text=(TAG+'\n').encode();record['files']['frontend-release.txt']=hashlib.sha256(release_text).hexdigest()
    with tarfile.open(ARCHIVE,'w:gz') as archive:
        for file in files:archive.add(file,arcname=file.relative_to(ROOT).as_posix(),recursive=False)
        for name,data in [('frontend-release.txt',release_text),('release-manifest.json',(json.dumps(record,ensure_ascii=False,indent=2)+'\n').encode())]:
            item=tarfile.TarInfo(name);item.size=len(data);item.mode=0o644;archive.addfile(item,io.BytesIO(data))
    record['archive_sha256']=digest(ARCHIVE);record['archive_bytes']=ARCHIVE.stat().st_size
    MANIFEST.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'packaged':True,'tag':TAG,'files':len(record['files']),'archive_sha256':record['archive_sha256'],'entry':entry}))
def remote(phase):
    sys.path.insert(0,str(ROOT/'.local-data/cloud-tools'));import paramiko
    folder=ROOT/'deploy/cloud-transfer/server-secrets';config=json.loads((folder/'config.json').read_text())
    private=(folder/'SSH_ACCESS_PRIVATE.md').read_text(encoding='utf-8-sig');match=re.search(r'^Пароль:\s*(.+)$',private,re.M)
    if not match:raise SystemExit('Existing credentials unavailable; values were not printed')
    record=json.loads(MANIFEST.read_text(encoding='utf-8'));assert digest(ARCHIVE)==record['archive_sha256']
    client=paramiko.SSHClient();client.load_host_keys(str(folder/'known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        client.connect(config['host'],port=config['port'],username=config['user'],password=match.group(1).strip(),look_for_keys=False,allow_agent=False,timeout=15)
        if phase=='preflight':
            sftp=client.open_sftp();target='/opt/atelie/'+ARCHIVE.name
            try:sftp.stat(target)
            except FileNotFoundError:pass
            else:raise RuntimeError('Remote archive already exists; inspect instead of overwriting')
            sftp.put(str(ARCHIVE),target);sftp.chmod(target,0o600);sftp.close()
        args=[phase,TAG,BASELINE,record['archive_sha256'],record['entry']]
        command='python3 - '+' '.join(shlex.quote(x) for x in args)
        stdin,stdout,stderr=client.exec_command(command,timeout=300)
        stdin.write((ROOT/'deploy/release-master-refinement.py').read_text(encoding='utf-8'));stdin.channel.shutdown_write()
        output=stdout.read().decode();error=stderr.read().decode();status=stdout.channel.recv_exit_status()
        if status:raise RuntimeError('Release phase failed; '+error[-3000:])
        value=json.loads(output)
        if phase=='qa-open':
            (WORK/'qa-session.json').write_text(json.dumps(value),encoding='utf-8');print(json.dumps({'qa_ready':True,'expires_in_seconds':value['expires_in_seconds']}))
        else:
            (OUT/(phase+'-result.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(value,ensure_ascii=False))
            if phase=='qa-close':(WORK/'qa-session.json').unlink(missing_ok=True)
    finally:client.close()

if __name__=='__main__':
    phase=sys.argv[1] if len(sys.argv)==2 else ''
    if phase=='package':package()
    elif phase in ('preflight','publish','audit','qa-open','qa-close'):remote(phase)
    else:raise SystemExit('Use package, preflight, publish, audit, qa-open, or qa-close')
