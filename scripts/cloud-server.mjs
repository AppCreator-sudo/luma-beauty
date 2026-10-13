import path from 'node:path';
import {spawnSync} from 'node:child_process';
const executable=process.platform==='win32'?'python':'python3';
const result=spawnSync(executable,[path.resolve('scripts/cloud-server.py'),...process.argv.slice(2)],{stdio:'inherit'});
if(result.error)console.error('Python SSH runtime unavailable; run cloud-setup.sh first.');
process.exitCode=result.status??1;
