import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function walk(dir){for(const ent of readdirSync(dir,{withFileTypes:true})){const file=join(dir,ent.name);if(ent.isDirectory())walk(file);else if(/\.(mjs|cjs|js)$/.test(file)){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}}}
for(const dir of ['server','desktop','scripts','tests'])walk(dir);
console.log('Sintaxa JavaScript este validă.');
