import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files=readdirSync(new URL("../tests/",import.meta.url)).filter(name=>name.endsWith(".test.mjs")).map(name=>`tests/${name}`);
const result=spawnSync(process.execPath,["--test",...files],{stdio:"inherit"});
if(result.error)throw result.error;process.exit(result.status??1);
