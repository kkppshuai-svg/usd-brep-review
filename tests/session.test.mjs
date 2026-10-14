import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReviewSession,geometryEvidenceReport } from "../src/index.js";
const geometry=()=>({valid:true,facts:{volume:1000,solidCount:1,bbox:[10,10,10],boundsMin:[0,0,0],boundsMax:[10,10,10],center:[5,5,5]},roundTrip:{valid:true,issues:[]}});

test("session accepts current provider evidence and invalidates changed artifacts",async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"review-session-"));t.after(()=>rm(root,{force:true,recursive:true}));
 const file=path.join(root,"solid.usda");await writeFile(file,"original");
 const session=await createReviewSession({outputDir:root,geometry:geometry(),artifactPaths:[file]});
 assert.equal((await session.review()).status,"pending");
 const report=await session.review({screenshots:[{view:"3d"}],visualProvider:async({revisionId,geometry})=>{
  assert.equal(geometry.review.geometryDecision,"pass");return{revisionId,status:"pass",findings:[],summary:"test provider"};}});
 assert.equal(report.status,"pass");assert.equal(report.visualEvidence.summary,"test provider");
 await writeFile(file,"tampered");assert.equal((await session.review()).status,"fail");
});

test("stale provider evidence cannot deliver the current native model",async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"stale-review-"));t.after(()=>rm(root,{force:true,recursive:true}));
 const file=path.join(root,"solid.usda");await writeFile(file,"original");
 const session=await createReviewSession({outputDir:root,geometry:geometry(),artifactPaths:[file]});
 const report=await session.review({screenshots:[{}],visualProvider:async()=>({revisionId:"old",status:"pass"})});
 assert.equal(report.status,"pending");assert.equal(report.visualAttempt.status,"unavailable");
});

test("nonfinite facts, missing roundtrip and unsupported required dimensions fail closed",()=>{
 for(const bad of [null,{...geometry(),valid:false},{...geometry(),facts:{...geometry().facts,volume:Infinity}},
  {...geometry(),roundTrip:{valid:false}},{...geometry(),facts:{...geometry().facts,center:[]}}])
  assert.equal(geometryEvidenceReport({engine:"nvidia-usd-brep",geometry:bad}).review.geometryDecision,"fail");
 const report=geometryEvidenceReport({engine:"nvidia-usd-brep",geometry:geometry(),part:{measurements:[{id:"thickness",kind:"bbox",target:10}]}});
 assert.ok(report.issues.some(item=>item.code==="MEASUREMENT_UNVERIFIED"));
});

test("independent volume reference and mandatory volume measurements are checked",()=>{
 const good=geometryEvidenceReport({engine:"nvidia-usd-brep",geometry:geometry(),part:{measurements:[{kind:"volume",target:1000,tolerance:0.001}]},expected:{volumeMm3:1000}});
 assert.equal(good.review.geometryDecision,"pass");
 assert.equal(geometryEvidenceReport({engine:"nvidia-usd-brep",geometry:geometry(),expected:{volumeMm3:1}}).review.geometryDecision,"fail");
});
