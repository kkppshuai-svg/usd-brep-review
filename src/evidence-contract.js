import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const checksum = value => createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");
export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const finite = value => typeof value === "number" && Number.isFinite(value);
const result = (spec, status, reason, extra = {}) => ({ id:spec.id, kind:spec.kind, required:spec.required !== false, status, reason, ...extra });

export function validateRequirements(requirements) {
  if (!Array.isArray(requirements)) throw new TypeError("requirements must be an array");
  const ids = new Set();
  for (const spec of requirements) {
    if (!spec?.id || typeof spec.id !== "string" || ids.has(spec.id)) throw new Error("Requirement IDs must be unique nonempty strings");
    ids.add(spec.id);
    if (!["dimension", "motion", "visual", "kinematic_ratio"].includes(spec.kind)) throw new Error(`Unsupported requirement kind: ${spec.kind}`);
    if (["dimension","kinematic_ratio"].includes(spec.kind) && (!finite(spec.target) || !finite(spec.tolerance) || spec.tolerance < 0 || !spec.unit)) {
      throw new Error(`Requirement ${spec.id} needs a finite target, explicit nonnegative tolerance and unit`);
    }
    if (spec.kind === "kinematic_ratio" && spec.unit !== "1") throw new Error(`Requirement ${spec.id} needs dimensionless unit 1`);
    if (spec.kind === "motion" && (!finite(spec.startDeg) || !finite(spec.endDeg) || spec.endDeg <= spec.startDeg
      || !finite(spec.minimumClearanceMm) || spec.minimumClearanceMm < 0
      || spec.maxStepDeg !== undefined && (!finite(spec.maxStepDeg) || spec.maxStepDeg <= 0))) {
      throw new Error(`Requirement ${spec.id} needs an explicit angular interval and clearance threshold`);
    }
  }
}

// The host supplies trusted checker outputs. Hashes bind evidence to bytes; they
// do not authenticate the checker or prove that a caller ran a real kernel.
export async function checkMeasurementBinding(evidence, job, spec, cache = new Map()) {
  if (!evidence || evidence.revisionId !== job.currentRevision || evidence.origin !== "kernel"
    || typeof evidence.method !== "string" || !evidence.method.trim()) return "Missing current kernel measurement and provenance";
  const hashes = evidence.artifactSha256;
  if (!hashes || !Object.keys(hashes).length) return "Measurement is not bound to artifact SHA-256";
  const bindings = job.reviewBindings || [];
  const relevant = spec.artifacts || (spec.partId ? bindings.filter(b => path.basename(b.path) === `${spec.partId}.usda`).map(b => path.basename(b.path)) : Object.keys(hashes));
  if (!relevant.length || relevant.some(name => !hashes[name])) return "Measurement does not cover the required part artifacts";
  for (const [name, expected] of Object.entries(hashes)) {
    const candidates = bindings.filter(b => path.basename(b.path) === name);
    if (candidates.length !== 1 || !/^[a-f0-9]{64}$/.test(expected || "")) return "Measurement refers to missing or ambiguous artifacts";
    try {
      const file=candidates[0].path;
      if (!cache.has(file)) cache.set(file,sha256(file));
      if (await cache.get(file) !== expected) return "Measurement artifact changed; measure the current revision again";
    }
    catch { return "Measurement artifact is unavailable"; }
  }
  return null;
}

function checkMotion(spec, motion, bound) {
  if (!bound || !motion) return result(spec,"pending","No current artifact-bound motion evidence");
  const samples = motion.samples;
  if (motion.status === "fail" || motion.collisions?.length || samples?.some(s => s.collision === true)) return result(spec,"fail","Collision reported by the motion checker");
  if (motion.status !== "pass" || !Array.isArray(samples) || samples.length < 2 || motion.sampleCount !== samples.length
    || samples.some(s => !finite(s.inputAngleDeg) || !finite(s.minimumClearanceMm) || typeof s.collision!=="boolean")) return result(spec,"pending","Incomplete or nonfinite motion trace");
  for (let i=1;i<samples.length;i++) {
    const step = samples[i].inputAngleDeg-samples[i-1].inputAngleDeg;
    if (step <= 0 || spec.maxStepDeg !== undefined && step > spec.maxStepDeg+1e-9) return result(spec,"pending","Motion trace is unordered or too sparse for the requested interval");
  }
  const selected=samples.filter(s=>s.inputAngleDeg>=spec.startDeg-1e-9&&s.inputAngleDeg<=spec.endDeg+1e-9);
  if (selected.length<2 || Math.abs(selected[0].inputAngleDeg-spec.startDeg)>1e-9 || Math.abs(selected.at(-1).inputAngleDeg-spec.endDeg)>1e-9)
    return result(spec,"pending","Requested interval endpoints were not sampled; symmetry is not assumed");
  const measured = Math.min(...selected.map(s => s.minimumClearanceMm));
  const overallMinimum=Math.min(...samples.map(s => s.minimumClearanceMm));
  if (!finite(motion.minimumSampledClearanceMm) || Math.abs(overallMinimum-motion.minimumSampledClearanceMm) > 1e-6) return result(spec,"pending","Motion summary disagrees with the trace");
  return result(spec,measured >= spec.minimumClearanceMm ? "pass" : "fail","Sampled clearance only; no continuous collision certificate",{
    measured, unit:"mm", sampleCount:selected.length, sampledIntervalDeg:[selected[0].inputAngleDeg,selected.at(-1).inputAngleDeg],
    intervalClearanceLowerEstimateMm:motion.intervalClearanceLowerEstimateMm ?? null, coverage:motion.coverage || "sampled" });
}

export async function evaluateRequirements({job, report, requirements, measurements = [], onProgress = () => {}}) {
  validateRequirements(requirements);
  const matrix=[];
  const motion=report.motionReview;
  let motionBound=Boolean(job.motionReviewPath && job.reviewBindings?.some(b => b.path === job.motionReviewPath && b.sha256)
    && !report.issues?.some(i => i.stage === "integrity" && i.severity === "error"));
  if (motionBound) {
    try { motionBound=checksum(JSON.parse(await readFile(job.motionReviewPath,"utf8")))===checksum(motion); }
    catch { motionBound=false; }
  }
  const hashCache=new Map();
  const measurementIds = measurements.map(m => m.id);
  if (new Set(measurementIds).size !== measurementIds.length) throw new Error("Duplicate measurement IDs are ambiguous");
  for (const spec of requirements) {
    let item;
    if (spec.kind === "dimension") {
      const evidence=measurements.find(m => m.id === (spec.measurementId || spec.id));
      const missing=await checkMeasurementBinding(evidence,job,spec,hashCache);
      item=missing ? result(spec,"pending",missing) : !finite(evidence.measured) || evidence.unit !== spec.unit
        ? result(spec,"pending","Missing finite measurement or incompatible unit")
        : result(spec,Math.abs(evidence.measured-spec.target) <= spec.tolerance ? "pass" : "fail","Compared independent kernel measurement with the requirement",{
          measured:evidence.measured,target:spec.target,tolerance:spec.tolerance,unit:spec.unit,method:evidence.method });
    } else if (spec.kind === "motion") item=checkMotion(spec,motion,motionBound);
    else if (spec.kind === "kinematic_ratio") item=!motionBound || motion?.status !== "pass" || !finite(motion.ratio)
      ? result(spec,"pending","No current verified kinematic ratio")
      : result(spec,Math.abs(motion.ratio-spec.target)<=spec.tolerance ? "pass":"fail","Kinematic arithmetic; not torque, load or dynamics verification",{measured:motion.ratio,unit:"1"});
    else item=result(spec,report.review.visualDecision,"Version-bound visual review; cannot establish exact dimensions");
    matrix.push(item);
    await onProgress({stage:"requirement",completed:matrix.length,total:requirements.length,result:structuredClone(item)});
  }
  return matrix;
}

export function comparePreservedParts(before, after, authorizedPartIds) {
  const checks=[];
  const ids=new Set(authorizedPartIds);
  const oldParts=before.parts || [], newParts=after.parts || [];
  for (const old of oldParts.filter(p => !ids.has(p.id))) {
    const current=newParts.find(p => p.id === old.id);
    let status="pass",reason="Plan and kernel summary invariants preserved; full surface equivalence is not proven";
    const oldPlan=before.plan?.parts?.find(p => p.id===old.id), newPlan=after.plan?.parts?.find(p => p.id===old.id);
    if (!oldPlan) { status="pending";reason="Original feature plan for the unselected part is missing"; }
    else if (!current || !newPlan || checksum(oldPlan)!==checksum(newPlan)) { status="fail";reason="Unselected part removed or its feature plan/pose changed"; }
    else {
      const a=old.geometryValidation?.facts,b=current.geometryValidation?.facts;
      if (!a || !b) {status="pending";reason="Missing kernel facts for an unselected part";}
      else for (const name of ["volume","solidCount","center","boundsMin","boundsMax"]) {
        const av=Array.isArray(a[name])?a[name]:[a[name]],bv=Array.isArray(b[name])?b[name]:[b[name]];
        if(av.length!==bv.length || av.some((v,i)=>!finite(v)||!finite(bv[i]))) {status="pending";reason="Incomplete preservation evidence";break;}
        if(av.some((v,i)=>Math.abs(v-bv[i])>(name==="solidCount"?0:1e-6+Math.abs(v)*1e-7))) {status="fail";reason=`Unselected part changed: ${name}`;break;}
      }
    }
    checks.push({id:`preserve:${old.id}`,kind:"preservation",required:true,partId:old.id,status,reason});
  }
  for(const part of newParts.filter(p=>!ids.has(p.id)&&!oldParts.some(old=>old.id===p.id))) checks.push({id:`preserve:${part.id}`,kind:"preservation",required:true,status:"fail",reason:"Unselected part was added"});
  return checks;
}
