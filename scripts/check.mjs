import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const run=(command,args)=>{const r=spawnSync(command,args,{stdio:"inherit"});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);};
for(const folder of ["src","scripts"]){for(const name of readdirSync(folder).filter(n=>/\.(?:js|mjs)$/.test(n)))run(process.execPath,["--check",`${folder}/${name}`]);}
run(process.execPath,["scripts/test.mjs"]);
if(process.env.USD_BREP_PYTHON){run(process.env.USD_BREP_PYTHON,["-m","unittest","discover","-s","scripts","-p","test_*.py"]);run(process.execPath,["scripts/native-smoke.mjs"]);}
