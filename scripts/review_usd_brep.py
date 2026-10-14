"""Inspect self-contained millimeter, Z-up USDA through NVIDIA's native BRep API."""
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from importlib.metadata import version
import usd_brep as b
from brep_review_core import compare_geometry
from usd_brep_export import stage_units


def facts(bodies):
    if not bodies or any(not b.is_manifold_solid(body) for body in bodies):
        raise ValueError("USD stage contains no valid closed manifold BRep solids")
    masses = [b.compute_volume(body, relative_accuracy=1e-8) for body in bodies]
    if any(not math.isfinite(mass) or mass <= 0 for mass in masses):
        raise ValueError("Every imported BRep must have positive finite signed volume")
    boxes = [body.bounding_box() for body in bodies]
    centers = [list(body.center()) for body in bodies]
    minimum = [min(box[0][axis] for box in boxes) for axis in range(3)]
    maximum = [max(box[1][axis] for box in boxes) for axis in range(3)]
    mass = sum(masses)
    return {"solidCount": sum(body.material_census()["solid_count"] for body in bodies),
            "volume": mass, "bbox": [maximum[i]-minimum[i] for i in range(3)],
            "boundsMin": minimum, "boundsMax": maximum,
            "center": [sum(center[i]*weight for center,weight in zip(centers,masses))/mass for i in range(3)]}


def inspect(input_path, output_dir):
    source = Path(input_path)
    if source.suffix.lower() != ".usda" or source.stat().st_size > 100_000_000:
        raise ValueError("Only self-contained USDA files up to 100 MB are supported")
    text = source.read_text(encoding="utf-8")
    metadata = re.match(r"\s*#usda\s+1\.0\s*\((.*?)\)", text, re.S)
    if not metadata:
        raise ValueError("USD stage metadata declaring millimeter units and Z-up is required")
    units = re.search(r"\bmetersPerUnit\s*=\s*([0-9.eE+-]+)", metadata.group(1))
    if not units or not math.isclose(float(units.group(1)),0.001,rel_tol=0,abs_tol=1e-15):
        raise ValueError("Input must explicitly use metersPerUnit = 0.001; units are not silently converted")
    if not re.search(r'\bupAxis\s*=\s*"Z"',metadata.group(1)):
        raise ValueError("Input must declare Z-up coordinates")
    if re.search(r"@[^@]+@",text):
        raise ValueError("External USD references are not supported by the staged inspection adapter")
    output = Path(output_dir); output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="usd-brep-review-",dir=os.path.realpath(tempfile.gettempdir())) as directory:
        staged = Path(directory)/"input.usda";shutil.copyfile(source,staged)
        bodies = b.usd.import_breps(str(staged))
        if len(bodies) != 1:
            raise ValueError("Initial adapter accepts one BRep per USDA; inspect assembly bodies individually")
        original = facts(bodies)
        restored_path = Path(directory)/"roundtrip.usda"
        b.usd.export_brep(bodies[0],str(restored_path))
        restored_path.write_text(stage_units(restored_path.read_text(encoding="utf-8")),encoding="utf-8")
        restored = facts(b.usd.import_breps(str(restored_path)))
        roundtrip = compare_geometry(original,restored)
        shutil.copyfile(restored_path,output/"review-roundtrip.usda")
    return {"valid":roundtrip["valid"],"engine":"nvidia-usd-brep","version":version("usd-brep"),
            "representation":"brep","cadqueryUsed":False,"facts":original,"roundTrip":roundtrip,
            "issues":[],"units":{"metersPerUnit":0.001,"upAxis":"Z"},
            "coverage":"per-body manifold topology, signed volume, conservative bounds, center and USD round-trip; no inter-body interference proof"}


if __name__ == "__main__":
    try:
        request=json.load(sys.stdin);print(json.dumps(inspect(request["input"],request["outputDir"])))
    except Exception as error:
        print(json.dumps({"error":str(error),"code":"USD_BREP_REVIEW_FAILED"}));sys.exit(2)
