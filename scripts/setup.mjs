import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { Store } from '../server/domain.mjs';
let muted=false;
const output=new Writable({write(chunk,_encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});
const rl=createInterface({input:process.stdin,output,terminal:process.stdin.isTTY});
try{
  const school=await rl.question('Numele școlii: ');const username=await rl.question('Utilizator administrator: ');
  process.stdout.write('Parolă (minimum 12 caractere; ascunsă): ');muted=true;const password=await rl.question('');muted=false;process.stdout.write('\n');
  const store=new Store(process.env.LABORA_DATA||'data/store.json');store.bootstrap(school,username,password);console.log('Școala și administratorul au fost create. Rulați npm run server.');
}finally{muted=false;rl.close();}
