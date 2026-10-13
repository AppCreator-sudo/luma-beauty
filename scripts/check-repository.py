"""Review the actual Git index without printing file contents or credentials."""
from pathlib import Path, PurePosixPath
import json, re, subprocess, sys, hashlib
ROOT = Path(__file__).resolve().parents[1]
def git(*args):
    return subprocess.run(['git',*args],cwd=ROOT,capture_output=True,check=True).stdout
files=[x for x in git('ls-files','-z').decode('utf-8').split('\0') if x]
errors=[]; total=0; inventory=[]
# Explicit 2026-10-14 user authorization for the complete PRIVATE handoff.
transfer=json.loads((ROOT/'deploy/cloud-transfer/manifest.json').read_text(encoding='utf8'))
approved={('deploy/cloud-transfer/'+name):digest for name,digest in transfer.get('plainFiles',{}).items()}
secret=re.compile(rb'(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)')
for name in files:
    parts=PurePosixPath(name).parts
    authorized=name in approved
    if not authorized and any(x in {'node_modules','.cache','data','.local-data','private-client','uploads'} for x in parts): errors.append(name+': local/private directory')
    if not authorized and ('PRIVATE' in PurePosixPath(name).name or name.endswith(('.sqlite','.db','.pem','.key','.tar.gz'))
        or (PurePosixPath(name).name.startswith('.env') and PurePosixPath(name).name!='.env.example')):errors.append(name+': forbidden private file')
    data=git('show',':'+name);total+=len(data)
    if not authorized and data.startswith(b'SQLite format 3\0'):errors.append(name+': SQLite database in index')
    if len(data)>100*1024*1024:errors.append(name+': exceeds GitHub single-file limit')
    if not authorized and secret.search(data):errors.append(name+': credential-like content; inspect privately, do not push')
    if authorized and hashlib.sha256(data).hexdigest()!=approved[name]:errors.append(name+': authorized transfer checksum mismatch')
    inventory.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
required=['AGENTS.md','.env.example','.nvmrc','README.md','package-lock.json','frontend/package-lock.json',
          'server.mjs','scripts/cloud-setup.sh','docs/CODEX_CLOUD.md',
          '.agents/skills/atelier-v2-product-design/SKILL.md','.agents/skills/atelier-v2-ui-implementation/SKILL.md']
for name in required:
    if name not in files:errors.append('Missing essential source: '+name)
output={'files':len(files),'bytes':total,'errors':errors,'note':'Pattern/path check only; not a proof against every possible secret.'}
(ROOT/'.cache').mkdir(exist_ok=True)
(ROOT/'.cache/github-index-inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(output,ensure_ascii=False,indent=2))
sys.exit(bool(errors))
