#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createNvidiaUsdBrepAdapter } from "../src/index.js";
try {
  const {values,positionals}=parseArgs({allowPositionals:true,options:{
    output:{type:"string"},python:{type:"string"},screenshots:{type:"string"},
    "visual-provider":{type:"string"},"expected-volume":{type:"string"},help:{type:"boolean"}}});
  if(values.help){console.log("usd-brep-review build part.json --output DIR | review model.usda --output DIR [--python PATH] [--expected-volume MM3] [--visual-provider module.mjs --screenshots views.json]");}
  else {
    const [command,input]=positionals;
    if(!["build","review"].includes(command)||!input||!values.output)throw new Error("Use build PART.json or review MODEL.usda with --output DIR; see --help");
    const expected=values["expected-volume"]===undefined?null:{volumeMm3:Number(values["expected-volume"])};
    const adapter=createNvidiaUsdBrepAdapter({python:values.python||process.env.USD_BREP_PYTHON||"python"});
    const result=command==="build"?await adapter.build({part:JSON.parse(await readFile(input,"utf8")),outputDir:values.output,expected})
      :await adapter.inspect({input,outputDir:values.output,expected});
    let report=result.report;
    if(values["visual-provider"]){
      if(!values.screenshots)throw new Error("--visual-provider requires --screenshots");
      const provider=await import(pathToFileURL(path.resolve(values["visual-provider"])).href);
      if(typeof provider.default!=="function")throw new Error("Visual provider must export a default function");
      report=await result.session.review({screenshots:JSON.parse(await readFile(values.screenshots,"utf8")),visualProvider:provider.default});
    }
    console.log(JSON.stringify(report,null,2));if(report.review.geometryDecision!=="pass")process.exitCode=1;
  }
}catch(error){console.error(JSON.stringify({error:error.message,code:error.code||"REVIEW_FAILED"}));process.exitCode=2;}
