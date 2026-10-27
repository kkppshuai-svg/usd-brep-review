import { UnifiedReviewChannel } from "./unified-review-channel.js";
import { checksum, evaluateRequirements, comparePreservedParts, validateRequirements } from "./evidence-contract.js";
import { reviewRevisionId } from "./review-policy.js";

const decision = statuses => statuses.includes("fail") ? "fail" : statuses.includes("pending") ? "pending" : "pass";
export const pluginManifest = Object.freeze({
  id:"usd-brep-review", version:"0.2.0", name:"USD BRep Review",
  capabilities:["revision-bound-review","requirement-verification","sampled-motion-review","bounded-repair","preservation-regression"],
  primaryEngine:"nvidia-usd-brep", executesGeneratedCode:false
});

export function createReviewPlugin({channel = new UnifiedReviewChannel(), onProgress = async () => {}} = {}) {
  async function review(input) {
    if (!reviewRevisionId(input?.job || {})) throw new Error("A stable review revision is required by the plugin");
    const {job, requirements = [], measurements = []} = structuredClone(input);
    job.currentRevision=reviewRevisionId(job);
    validateRequirements(requirements);
    const revisionId=job.currentRevision;
    await onProgress({stage:"geometry",revisionId,status:"running"});
    const base=await channel.review(job,{profile:"delivery",refresh:true});
    const matrix=await evaluateRequirements({job,report:base,requirements,measurements,onProgress});
    if (input.baseline) matrix.push(...comparePreservedParts(input.baseline,job,input.authorizedPartIds || []));
    // Check again after measurement callbacks: no mutated artifacts may escape.
    const final=await channel.review(job,{profile:"delivery",refresh:true});
    const evidenceChanged=base.review.cache.evidenceHash!==final.review.cache.evidenceHash;
    if(evidenceChanged) matrix.push({id:"evidence-stability",required:true,kind:"integrity",status:"fail",reason:"Artifacts changed during verification"});
    const contractDecision=decision(matrix.filter(m=>m.required).map(m=>m.status));
    const deliveryDecision=decision([final.review.deliveryDecision,contractDecision]);
    const requirementsHash=checksum(requirements);
    const report={...final,status:deliveryDecision,plugin:pluginManifest,requirementsHash,verificationMatrix:matrix,
      review:{...final.review,contractDecision,deliveryDecision},
      repairableFindings:matrix.filter(m=>m.status==="fail" && m.kind==="dimension").map(m=>m.id),
      unverified:matrix.filter(m=>m.status==="pending").map(m=>({id:m.id,reason:m.reason})),
      limitations:["Trusted host checker outputs; hashes do not authenticate the checker", "Sampled motion is not a continuous collision or dynamic-load proof", "Summary invariants do not establish full surface equivalence"]};
    report.reviewToken=checksum({assemblyId:job.id,revisionId,requirementsHash,evidenceHash:final.review.cache.evidenceHash,matrixHash:checksum(matrix)});
    await onProgress({stage:"complete",revisionId,status:report.status});
    return report;
  }

  async function repair({input,propose,build,commit,authorizedPartIds,maxAttempts=2,signal}) {
    if (!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3) throw new Error("Repair budget must be between one and three attempts");
    if (!Array.isArray(authorizedPartIds)||!authorizedPartIds.length) throw new Error("Explicit authorizedPartIds are required before changing geometry");
    if (![propose,build,commit].every(fn=>typeof fn==="function")) throw new Error("Host propose, draft build and commit callbacks are required");
    const original=structuredClone(input), contract=checksum(original.requirements || []), history=[];
    original.job.currentRevision=reviewRevisionId(original.job);
    const baseline=await review(original);
    if(baseline.status==="pass")return {status:"unchanged",report:baseline,history};
    let feedback=baseline;
    for(let attempt=1;attempt<=maxAttempts;attempt++) {
      signal?.throwIfAborted();
      const proposal=await propose({report:structuredClone(feedback),attempt,baseRevision:original.job.currentRevision,requirements:structuredClone(original.requirements || [])});
      const patch=proposal?.patch;
      if(!patch || patch.baseRevision!==original.job.currentRevision || !Array.isArray(patch.operations)||!patch.operations.length
        || patch.operations.some(op=>!["set_param","set_part_pose","add_feature"].includes(op.op)||!authorizedPartIds.includes(op.partId)
          || op.op==="set_param" && !/^params\.[A-Za-z0-9_.]+$/.test(op.path || ""))) throw new Error("Repair patch is stale, destructive or outside the explicitly authorized part scope");
      const current=await review(original);
      if(current.reviewToken!==baseline.reviewToken)throw new Error("Original evidence changed before draft construction; review again");
      await onProgress({stage:"repair-build",attempt,status:"running"});
      const candidate=await build({patch:structuredClone(patch),attempt,signal,baseRevision:original.job.currentRevision});
      signal?.throwIfAborted();
      if(!candidate?.job || candidate.job.id!==original.job.id || candidate.job.currentRevision===original.job.currentRevision)throw new Error("Host build must return a separate draft revision of the same assembly");
      if(candidate.requirements!==undefined && checksum(candidate.requirements)!==contract)throw new Error("Repair cannot change or weaken the acceptance requirements");
      feedback=await review({...candidate,requirements:original.requirements || [],baseline:original.job,authorizedPartIds});
      const originalAfterBuild=await review(original);
      if(originalAfterBuild.reviewToken!==baseline.reviewToken)throw new Error("Host draft build changed original artifacts; refusing commit");
      history.push({attempt,revisionId:candidate.job.currentRevision,status:feedback.status,reviewToken:feedback.reviewToken});
      if(feedback.status!=="pass")continue;
      // Recheck the candidate immediately before host commit, including the full contract.
      const confirmed=await review({...candidate,requirements:original.requirements || [],baseline:original.job,authorizedPartIds});
      if(confirmed.reviewToken!==feedback.reviewToken || confirmed.status!=="pass")throw new Error("Candidate evidence changed before commit");
      signal?.throwIfAborted();
      await commit({candidate,report:confirmed,expectedBaseRevision:original.job.currentRevision,signal});
      return {status:"committed",report:confirmed,history};
    }
    return {status:"not-committed",report:feedback,history};
  }

  return {manifest:pluginManifest,review,repair,
    register(host) {
      if(typeof host?.registerReviewPlugin!=="function")throw new Error("Host must implement registerReviewPlugin(plugin)");
      return host.registerReviewPlugin({manifest:pluginManifest,review,repair});
    }
  };
}
