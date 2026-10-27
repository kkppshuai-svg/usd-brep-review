import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createReviewPlugin } from "./plugin.js";

const readJson=async file=>JSON.parse(await readFile(file,"utf8"));
function canonicalJson(value) {
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  if(value && typeof value==="object")return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const stateChecksum=value=>createHash("sha256").update(canonicalJson(value)).digest("hex");

// AICAD state is trusted local host data, not an authenticated external report.
export async function loadAicadRevision(assemblyDir) {
  const root=path.resolve(assemblyDir),head=await readJson(path.join(root,"native-head.json"));
  const revisionId=head.revisionId;
  if(!/^rev-\d+$/.test(revisionId || ""))throw new Error("Invalid native revision ID");
  const dir=path.join(root,"revisions",revisionId);
  const [payload,revision]=await Promise.all([readJson(path.join(dir,"revision-state.json")),readJson(path.join(dir,"revision.json"))]);
  if(payload.stateChecksum!==stateChecksum({state:payload.state,artifactManifest:payload.artifactManifest || []})
    || revision.id!==revisionId || stateChecksum(payload.state?.plan)!==revision.planChecksum) throw new Error("AICAD revision state checksum is invalid");
  const job=payload.state.nativeJob;
  if(!job || job.id!==revision.assemblyId || job.currentRevision!==revisionId || stateChecksum(job.plan)!==revision.planChecksum)
    throw new Error("Native job and revision plan do not match");
  if(path.resolve(job.outputDir)!==root)throw new Error("Native job is bound to a different assembly directory");
  return {job,revisionId};
}

export function importNativeMeasurements(data, revisionId) {
  if(data?.engine!=="nvidia-usd-brep" || data.cadqueryUsed!==false || !data.artifactSha256 || !Array.isArray(data.measurements))
    throw new Error("Expected native independent measurement evidence with artifact hashes");
  return data.measurements.map(item=>({id:item.id,revisionId,origin:"kernel",method:item.source || null,
    measured:item.measuredMm,unit:"mm",artifactSha256:data.artifactSha256}));
}

export async function reviewAicadRevision({assemblyDir, requirements = [], measurementReport = null, plugin = createReviewPlugin()}) {
  const loaded=await loadAicadRevision(assemblyDir);
  const measurements=measurementReport ? importNativeMeasurements(measurementReport,loaded.revisionId) : [];
  const report=await plugin.review({job:loaded.job,requirements,measurements});
  const current=await readJson(path.join(path.resolve(assemblyDir),"native-head.json"));
  if(current.revisionId!==loaded.revisionId)throw new Error("AICAD revision changed during review; rerun for the current version");
  return report;
}
