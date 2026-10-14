import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPython } from "./python-process.js";
import { createReviewSession } from "./session.js";
const scripts=fileURLToPath(new URL("../scripts/",import.meta.url));

export function createNvidiaUsdBrepAdapter({python=process.env.USD_BREP_PYTHON||"python",timeoutMs=120000}={}){
  const invoke=(name,request)=>runPython(python,path.join(scripts,name),request,{timeoutMs});
  return {
    async build({part,outputDir,expected=null}){
      outputDir=path.resolve(outputDir);await mkdir(outputDir,{recursive:true});
      const native=await invoke("usd_brep_build.py",{part,outputDir});
      const session=await createReviewSession({outputDir,plan:{parts:[part]},part,expected,
        geometry:{valid:native.manifoldSolid===true,facts:native.facts,roundTrip:native.usdRoundTrip},
        artifactPaths:["native-solid.usda","native-preview.stl","native-mesh.usda"].map(name=>path.join(outputDir,name))});
      return {native,session,report:await session.review(),usdBrepPath:path.join(outputDir,"native-solid.usda")};
    },
    async inspect({input,outputDir,expected=null}){
      outputDir=path.resolve(outputDir);await mkdir(outputDir,{recursive:true});
      const local=path.join(outputDir,"review-input.usda");
      if(path.resolve(input)!==local)await copyFile(input,local);
      const native=await invoke("review_usd_brep.py",{input:local,outputDir});
      const session=await createReviewSession({outputDir,expected,plan:{source:"imported-usd-brep",expected},
        geometry:native,artifactPaths:[local,path.join(outputDir,"review-roundtrip.usda")]});
      return {native,session,report:await session.review()};
    }
  };
}
