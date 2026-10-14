import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachUnifiedDecision, finitePositive, REVIEW_POLICY } from "./review-policy.js";
import { UnifiedReviewChannel } from "./unified-review-channel.js";
import { runCombinedReview } from "./combined-review.js";

export function geometryEvidenceReport({ engine, geometry, part = null, expected = null }) {
  const issues=[...(geometry?.issues||[])];const facts=geometry?.facts;
  const error=(code,message)=>issues.push({code,message,severity:"error",stage:"geometry"});
  if(geometry?.valid!==true)error("GEOMETRY_UNVERIFIED","Kernel geometry verification is missing or failed");
  if(!finitePositive(facts?.volume))error("SIGNED_VOLUME_INVALID","A finite positive signed volume is required");
  if(!Number.isSafeInteger(facts?.solidCount)||facts.solidCount<1)error("SOLID_COUNT_INVALID","Closed solid count is missing");
  if(part?.requireSingleSolid && facts?.solidCount!==1)error("SINGLE_SOLID_REQUIRED","Part requires one connected solid");
  for(const name of ["bbox","boundsMin","boundsMax","center"]){
    const values=facts?.[name];
    if(!Array.isArray(values)||values.length!==3||values.some(v=>typeof v!=="number"||!Number.isFinite(v))
      ||name==="bbox"&&values.some(v=>v<=0))error("GEOMETRY_FACTS_INCOMPLETE",`Finite ${name} evidence is required`);
  }
  if(geometry?.roundTrip?.valid!==true)error("ROUNDTRIP_UNVERIFIED","USD/STEP re-import evidence is missing or failed");
  issues.push(...(geometry?.roundTrip?.issues||[]));
  const measurements=[];
  for(const [index,spec] of (part?.measurements||[]).entries()){
    const id=spec.id||`measurement-${index+1}`,target=spec.target??spec.value,tolerance=spec.tolerance??0.01;
    const supported=spec.kind==="volume"&&(!spec.unit||["mm3","mm³"].includes(spec.unit));
    const verified=supported&&Number.isFinite(target)&&Number.isFinite(tolerance)&&tolerance>=0&&finitePositive(facts?.volume);
    const status=verified?(Math.abs(facts.volume-target)<=tolerance?"pass":"fail"):"unverified";
    measurements.push({id,kind:spec.kind,status,target,tolerance,measured:supported?facts?.volume:null});
    if(status!=="pass")issues.push({code:verified?"DIMENSION_MISMATCH":"MEASUREMENT_UNVERIFIED",severity:spec.required===false?"warning":"error",measurementId:id,message:"Required measurement is outside tolerance or has no supported exact evidence"});
  }
  if(expected?.volumeMm3!==undefined){
    const target=expected.volumeMm3,tolerance=REVIEW_POLICY.volumeAbsoluteMm3+REVIEW_POLICY.volumeRelative*Math.abs(target);
    if(!finitePositive(target)||!finitePositive(facts?.volume)||Math.abs(facts.volume-target)>tolerance)error("EXPECTED_VOLUME_MISMATCH","Native volume differs from the supplied independent reference");
  }
  const errors=issues.filter(item=>item.severity==="error").length;
  return attachUnifiedDecision({format:"usd-brep-review-report-v1",valid:errors===0,blockingErrorCount:errors,
    summary:{errors,warnings:issues.filter(item=>item.severity==="warning").length},issues,measurements,facts,
    roundTrip:geometry?.roundTrip||null,expected,reviewStages:[{stage:"native_geometry",status:geometry?.valid===true?"pass":"fail"},
      {stage:engine==="nvidia-usd-brep"?"usd_roundtrip":"step_roundtrip",status:geometry?.roundTrip?.valid===true?"pass":"fail"}]},{engine});
}

export async function createReviewSession({ outputDir, engine="nvidia-usd-brep", plan={}, part=null, geometry,
  artifactPaths=[], expected=null, channel=new UnifiedReviewChannel() }) {
  await mkdir(outputDir,{recursive:true});
  const job={id:randomUUID(),outputDir:path.resolve(outputDir),engine,plan,
    validationReport:geometryEvidenceReport({engine,geometry,part,expected}),parts:artifactPaths.map(file=>({localUsdBrepPath:path.resolve(file)}))};
  await channel.bind(job);
  return { job, channel, async review({profile="delivery",refresh=false,screenshots=[],visualProvider=null}={}){
    const report=await runCombinedReview({job,channel,profile,refresh,screenshots,visualRequested:Boolean(visualProvider),
      runVisual:async({screenshots,revisionId})=>{
        const result=await visualProvider({screenshots,revisionId,plan:structuredClone(job.plan),geometry:await channel.review(job)});
        if(!result||result.revisionId!==revisionId)throw new Error("Visual provider returned missing or stale revision evidence");
        job.visualReview=structuredClone(result);
      }});
    await writeFile(path.join(job.outputDir,"unified-review.json"),JSON.stringify(report,null,2));return report;
  }};
}
