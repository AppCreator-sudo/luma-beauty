"""Validate project links/tasks from either Windows or a Linux checkout."""
from pathlib import Path
from urllib.parse import unquote
import json, re, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
errors = []
links = 0
registry = json.loads((DOCS / 'tasks/registry.json').read_text(encoding='utf-8'))
tasks = registry['tasks']
by_id = {task['id']: task for task in tasks}
if len(tasks) != len(by_id): errors.append('Duplicate task IDs')
if len({task['order'] for task in tasks}) != len(tasks): errors.append('Duplicate task order')
try:
    result = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True)
    tracked = set(result.stdout.decode('utf-8').split('\0')) - {''}
except (subprocess.SubprocessError, FileNotFoundError):
    tracked = set()

pattern = re.compile(r'!?\[[^\]\n]*\]\(([^\n)]+)\)')
for file in [ROOT / 'AGENTS.md', ROOT / 'README.md', *DOCS.rglob('*.md')]:
    name = file.relative_to(ROOT).as_posix()
    if file.name == 'SSH_ACCESS_PRIVATE.md' or '_PRIVATE.' in file.name: continue
    if tracked and name not in tracked: continue
    content = file.read_text(encoding='utf-8-sig')
    content = re.sub(r'```[^\n]*\n.*?```', '', content, flags=re.S)
    for match in pattern.finditer(content):
        raw = match[1].strip()
        raw = raw.split('>', 1)[0][1:] if raw.startswith('<') else re.split(r'\s+["\']', raw, maxsplit=1)[0]
        if re.match(r'^(?:https?:|mailto:|codex:|app:|data:|plugin:|#)', raw): continue
        if raw.startswith('file:'):
            errors.append(name + ': nonportable file URL'); continue
        relative = unquote(raw.split('#', 1)[0].split('?', 1)[0])
        if not relative: continue
        target = (file.parent / relative).resolve()
        links += 1
        if not target.exists(): errors.append(name + ': missing ' + relative); continue
        try: target_name = target.relative_to(ROOT).as_posix()
        except ValueError:
            errors.append(name + ': link outside checkout ' + relative); continue
        if tracked and target.is_file() and target_name not in tracked:
            errors.append(name + ': linked file excluded from repository ' + target_name)

states = {'ready','blocked','awaiting_input','deferred','published','approved','verified','in_progress','local_done','awaiting_approval'}
for task in tasks:
    card = DOCS / 'tasks' / task['card']
    if not card.exists(): errors.append(task['id'] + ': missing card'); continue
    text = card.read_text(encoding='utf-8')
    if not text.startswith('# ' + task['id'] + ' — ' + task['title']): errors.append(task['id'] + ': card title mismatch')
    if task['status'] not in states or '`' + task['status'] + '`' not in text: errors.append(task['id'] + ': status mismatch')
    for section in ('Граница задачи','Зависимости и разрешение','Что читать и какие навыки взять','Порядок работы','Приёмка','Фактические даты и результат'):
        if '## ' + section not in text: errors.append(task['id'] + ': missing section ' + section)
    for source in task['sources'] + task['skills']:
        if not (ROOT / source).exists(): errors.append(task['id'] + ': missing source ' + source)
        elif tracked and source not in tracked: errors.append(task['id'] + ': source excluded from repository ' + source)
    for dep in task['dependencies']:
        if dep not in by_id: errors.append(task['id'] + ': missing dependency ' + dep)
active, visited = set(), set()
def visit(task_id):
    if task_id in active: errors.append('Dependency cycle ' + task_id); return
    if task_id in visited: return
    active.add(task_id)
    for dep in by_id[task_id]['dependencies']:
        if dep in by_id: visit(dep)
    active.remove(task_id); visited.add(task_id)
for task_id in by_id: visit(task_id)
next_id = registry['next_task_id']
if next_id not in by_id: errors.append('Unknown next task')
elif by_id[next_id]['phase'] == 'completed': errors.append('Next task already completed')
print(json.dumps({'tasks':len(tasks),'local_links':links,'next_task':next_id,'errors':errors}, ensure_ascii=False, indent=2))
sys.exit(bool(errors))
