import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReviewPlugin, UnifiedReviewChannel, geometryEvidenceReport, comparePreservedParts, reviewAicadRevision } from "../src/index.js";
import { sha256 } from "../src/evidence-contract.js";

const facts=(volume=1000)=>({volume,solidCount:1,bbox:[10,10,10],boundsMin:[0,0,0],boundsMax:[10,10,10],center:[5,5,5]});
const motion=()=>({status:"pass",ratio:5,sampleCount:3,minimumSampledClearanceMm:.2,collisions:[],samples:[
  {inputAngleDeg:0,minimumClearanceMm:.3,collision:false},{inputAngleDeg:5,minimumClearanceMm:.2,collision:false},
  {inputAngleDeg:10,minimumClearanceMm:.3,collision:false}],coverage:"sampled prototype"});
const requirements=[{id:"diameter",kind:"dimension",target:12,tolerance:.01,unit:"mm",partId:"sun"},
  {id:"sweep",kind:"motion",startDeg:0,endDeg:10,maxStepDeg:5,minimumClearanceMm:.1},
  {id:"ratio",kind:"kinematic_ratio",target:5,tolerance:0,unit:"1"}, {id:"visual",kind:"visual"}];

async function fixture(root, revision="rev-1", measurement=12) {
  const dir=path.join(root,revision);await mkdir(dir,{recursive:true});
  const sun=path.join(dir,"sun.usda"),ring=path.join(dir,"ring.usda"),motionFile=path.join(dir,"motion.json");
  await writeFile(sun,`sun-${revision}`);await writeFile(ring,"ring geometry");await writeFile(motionFile,JSON.stringify(motion()));
  const geometry={valid:true,facts:facts(),roundTrip:{valid:true,issues:[]}};
  const validationReport=geometryEvidenceReport({engine:"nvidia-usd-brep",geometry});validationReport.motionReview=motion();
  const plan={parts:[{id:"sun",params:{diameter:measurement}},{id:"ring",params:{width:10}}]};
  const job={id:"assembly",currentRevision:revision,outputDir:dir,engine:"nvidia-usd-brep",plan,validationReport,motionReviewPath:motionFile,
    visualReview:{revisionId:revision,status:"pass",summary:"fixture"},parts:[
      {id:"sun",localUsdBrepPath:sun,geometryValidation:{facts:facts()}},
      {id:"ring",localUsdBrepPath:ring,geometryValidation:{facts:facts(2000)}}]};
  const channel=new UnifiedReviewChannel();await channel.bind(job);
  const measurements=[{id:"diameter",revisionId:revision,origin:"kernel",method:"native section",measured:measurement,unit:"mm",artifactSha256:{"sun.usda":await sha256(sun)}}];
  return {job,measurements,channel,sun,ring,motionFile};
}
async function setup(t) {const root=await mkdtemp(path.join(os.tmpdir(),"review-plugin-"));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test("separate verifiable requirements bind dimensions and motion to current artifacts",async t=>{
  const root=await setup(t),f=await fixture(root),events=[];
  const plugin=createReviewPlugin({channel:f.channel,onProgress:e=>events.push(e)});
  const r=await plugin.review({job:f.job,requirements,measurements:f.measurements});
  assert.equal(r.status,"pass");assert.deepEqual(r.verificationMatrix.map(i=>i.status),["pass","pass","pass","pass"]);
  assert.equal(events.filter(e=>e.stage==="requirement").length,4);
  assert.match(r.verificationMatrix[1].reason,/Sampled clearance/);
  let registered;plugin.register({registerReviewPlugin:p=>{registered=p;}});assert.equal(registered.manifest.id,"usd-brep-review");
});

test("the plugin also accepts the adapter's checksum-bound preview sessions",async t=>{
  const root=await setup(t),f=await fixture(root);
  delete f.job.currentRevision;
  f.job.visualReview.revisionId=`preview:${f.job.id}:${f.job.reviewPlanChecksum}`;
  const report=await createReviewPlugin().review({job:f.job,requirements:[]});
  assert.equal(report.status,"pass");assert.equal(report.reviewRevisionId,f.job.visualReview.revisionId);
});

test("unverified, stale, conflicting or incomplete evidence never produces a pass",async t=>{
  const root=await setup(t),f=await fixture(root),plugin=createReviewPlugin({channel:f.channel});
  const base={job:f.job,requirements,measurements:f.measurements};
  const missing=await plugin.review({...base,measurements:[]});assert.equal(missing.status,"pending");
  const stale=structuredClone(f.measurements);stale[0].revisionId="rev-0";assert.equal((await plugin.review({...base,measurements:stale})).status,"pending");
  const badUnit=structuredClone(f.measurements);badUnit[0].unit="inch";assert.equal((await plugin.review({...base,measurements:badUnit})).status,"pending");
  const tooLarge=structuredClone(f.measurements);tooLarge[0].measured=13;assert.equal((await plugin.review({...base,measurements:tooLarge})).status,"fail");
  const interval=structuredClone(requirements);interval[1].endDeg=360;assert.equal((await plugin.review({...base,requirements:interval})).status,"pending");
  const fake=structuredClone(f.job);fake.validationReport.motionReview.ratio=99;assert.equal((await plugin.review({...base,job:fake})).verificationMatrix[2].status,"pending");
  await writeFile(f.sun,"tampered");assert.equal((await plugin.review(base)).status,"fail");
});

test("unselected parts are compared rather than presumed unchanged",async t=>{
  const root=await setup(t),a=await fixture(root,"rev-a"),b=await fixture(root,"rev-b");
  assert.equal(comparePreservedParts(a.job,b.job,["sun"])[0].status,"pass");
  b.job.plan.parts.find(p=>p.id==="ring").params.width=11;
  assert.equal(comparePreservedParts(a.job,b.job,["sun"])[0].status,"fail");
  b.job.plan.parts.push({id:"extra"});b.job.parts.push({id:"extra"});
  assert.ok(comparePreservedParts(a.job,b.job,["sun"]).some(i=>i.id==="preserve:extra"&&i.status==="fail"));
});

test("bounded repair commits a verified draft once; changed unrelated geometry blocks commit",async t=>{
  const root=await setup(t),a=await fixture(root,"rev-a",11),b=await fixture(root,"rev-b",12),plugin=createReviewPlugin();let commits=0;
  const input={job:a.job,requirements,measurements:a.measurements};
  const propose=async()=>({patch:{baseRevision:"rev-a",operations:[{op:"set_param",partId:"sun",path:"params.diameter",value:12}]}});
  const build=async()=>({job:b.job,measurements:b.measurements});
  const commit=async()=>{commits++;};
  const outcome=await plugin.repair({input,propose,build,commit,authorizedPartIds:["sun"],maxAttempts:1});
  assert.equal(outcome.status,"committed");assert.equal(commits,1);assert.equal(await readFile(a.sun,"utf8"),"sun-rev-a");
  b.job.plan.parts[1].params.width=11;await new UnifiedReviewChannel().bind(b.job);
  const blocked=await plugin.repair({input,propose,build,commit,authorizedPartIds:["sun"],maxAttempts:1});
  assert.equal(blocked.status,"not-committed");assert.equal(blocked.report.status,"fail");assert.equal(commits,1);
  await assert.rejects(plugin.repair({input,propose,build,commit,authorizedPartIds:["ring"]}),/outside the explicitly authorized/);
});

test("AICAD adapter reads only the current, checksum-verified revision and detects a changing head",async t=>{
  const root=await setup(t),assembly=path.join(root,"assembly"),f=await fixture(assembly,"rev-0001");
  const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(",")}]`:v&&typeof v==="object"
    ? `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`:JSON.stringify(v);
  const digest=v=>createHash("sha256").update(canonical(v)).digest("hex");
  f.job.outputDir=assembly;
  const channel=new UnifiedReviewChannel();await channel.bind(f.job);
  const state={plan:f.job.plan,nativeJob:f.job},artifactManifest=[];
  const revisionDir=path.join(assembly,"revisions","rev-0001");await mkdir(revisionDir,{recursive:true});
  await writeFile(path.join(revisionDir,"revision.json"),JSON.stringify({id:"rev-0001",assemblyId:"assembly",planChecksum:digest(state.plan)}));
  await writeFile(path.join(revisionDir,"revision-state.json"),JSON.stringify({state,artifactManifest,stateChecksum:digest({state,artifactManifest})}));
  const head=path.join(assembly,"native-head.json");await writeFile(head,JSON.stringify({revisionId:"rev-0001"}));
  const report=await reviewAicadRevision({assemblyDir:assembly,requirements:[]});assert.equal(report.status,"pass");
  const plugin=createReviewPlugin({onProgress:async e=>{if(e.stage==="complete")await writeFile(head,JSON.stringify({revisionId:"rev-0002"}));}});
  await assert.rejects(reviewAicadRevision({assemblyDir:assembly,requirements:[],plugin}),/changed during review/);
  await writeFile(head,JSON.stringify({revisionId:"rev-0001"}));
  state.plan.parts[0].params.diameter=999;
  await writeFile(path.join(revisionDir,"revision-state.json"),JSON.stringify({state,artifactManifest,stateChecksum:"invalid"}));
  await assert.rejects(reviewAicadRevision({assemblyDir:assembly}),/checksum is invalid/);
});
