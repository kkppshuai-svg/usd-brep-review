import assert from "node:assert/strict";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import path from "node:path";
import { createNvidiaUsdBrepAdapter } from "../src/index.js";
const part=JSON.parse(await readFile("examples/plate.json","utf8"));
const adapter=createNvidiaUsdBrepAdapter();const root=path.resolve("output",`native-smoke-${Date.now()}`);
const expected={volumeMm3:7200-Math.PI*96};
const built=await adapter.build({part,outputDir:path.join(root,"build"),expected});
assert.equal(built.native.cadqueryUsed,false);assert.equal(built.report.review.geometryDecision,"pass");
assert.equal(built.report.status,"pending");
const inspected=await adapter.inspect({input:built.usdBrepPath,outputDir:path.join(root,"inspect"),expected});
assert.equal(inspected.report.review.geometryDecision,"pass");assert.equal(inspected.native.roundTrip.valid,true);
assert.match(await readFile(path.join(root,"inspect","review-roundtrip.usda"),"utf8"),/metersPerUnit\s*=\s*0\.001/);
await assert.rejects(adapter.build({part:{featureTree:[{id:"bad",type:"fillet",params:{radius:1}}]},outputDir:path.join(root,"unsupported")}),/does not yet support/);
const wrong=await adapter.inspect({input:built.usdBrepPath,outputDir:path.join(root,"wrong-reference"),expected:{volumeMm3:1}});
assert.equal(wrong.report.review.geometryDecision,"fail");
const original=await readFile(built.usdBrepPath,"utf8");await mkdir(path.join(root,"bad-unit"),{recursive:true});
const badUnit=path.join(root,"bad-unit","solid.usda");await writeFile(badUnit,original.replace(/metersPerUnit\s*=\s*0\.001/,"metersPerUnit = 1"));
await assert.rejects(adapter.inspect({input:badUnit,outputDir:path.join(root,"bad-unit-review")}),/metersPerUnit/);
const report={result:"passed",kernel:"NVIDIA USD BRep / SMLib",cadqueryUsed:false,
 build:"pass",independentImport:"pass",roundTrip:"pass",volumeMm3:inspected.native.facts.volume,
 expectedVolumeMm3:expected.volumeMm3,wrongReference:"blocked",wrongUnits:"blocked",unsupportedFeature:"blocked",
 visualProvider:"not invoked; user acceptance pending"};
await writeFile("output/native-smoke-report.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
