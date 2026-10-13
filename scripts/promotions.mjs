import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {promotions} from '../lib/promotions.mjs';

const [command,input]=process.argv.slice(2);
if(!['list','create','cancel'].includes(command)){
  console.log('Usage: node scripts/promotions.mjs list | create <private-json-file> | cancel <placement-id>');process.exitCode=1;
}else{
  const data=process.env.DATA_DIR;if(!data)throw new Error('Set DATA_DIR explicitly to the intended application data directory');
  const file=path.join(path.resolve(data),'atelie.sqlite');if(!fs.existsSync(file))throw new Error('Application database does not exist');
  const db=new DatabaseSync(file);
  try{
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if(!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('salon-public-v1'))throw new Error('Update the application schema first');
    const control=promotions({db,categories:JSON.parse(fs.readFileSync(new URL('../lib/categories.json',import.meta.url),'utf8')),backupDir:path.join(path.resolve(data),'maintenance-backups')});
    const operator=process.env.PROMOTION_OPERATOR;
    if(command==='list')console.log(JSON.stringify(control.list(),null,2));
    else if(command==='create'){if(!input)throw new Error('Provide a private JSON file');console.log(JSON.stringify(control.create(JSON.parse(fs.readFileSync(input,'utf8')),operator),null,2))}
    else {if(!input)throw new Error('Provide a placement ID');console.log(JSON.stringify({cancelled:control.cancel(input,operator)}))}
  }finally{db.close()}
}
