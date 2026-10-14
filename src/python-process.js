import { spawn } from "node:child_process";

export function runPython(python, script, request, { timeoutMs = 120000, maximumBytes = 2000000 } = {}) {
  if (!python || /[\0\r\n]/.test(python)) throw new Error("Configure USD_BREP_PYTHON with a valid Python executable");
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], { shell:false, windowsHide:true,
      env:{...process.env,PYTHONUTF8:"1"}, stdio:["pipe","pipe","pipe"] });
    let stdout="",stderr="",bytes=0,finished=false;
    const finish = (error, result) => { if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(result); };
    const timer=setTimeout(()=>{child.kill();finish(new Error("Native USD BRep process timed out"));},timeoutMs);
    const collect=(kind,data)=>{bytes+=data.length;if(bytes>maximumBytes){child.kill();finish(new Error("Native process output exceeds limit"));return;}
      if(kind==="stdout")stdout+=data;else stderr+=data;};
    child.stdout.on("data",data=>collect("stdout",data));child.stderr.on("data",data=>collect("stderr",data));
    child.once("error",error=>finish(error));child.stdin.on("error",()=>{});
    child.once("close",code=>{
      let result;try{result=JSON.parse(stdout.trim());}catch{finish(new Error(`Native process returned invalid JSON (exit ${code})`));return;}
      if(code!==0){finish(Object.assign(new Error(result.error||`Native process failed (exit ${code})`),{code:result.code}));return;}
      finish(null,{...result,runtimeWarnings:Boolean(stderr.trim())});
    });
    child.stdin.end(JSON.stringify(request));
  });
}
