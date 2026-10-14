# Validation scope

[Overview](../README.md) · [API reference](api.md) · [CI results](https://github.com/kkppshuai-svg/usd-brep-review/actions/workflows/check.yml)

## Supported inputs

Construction supports boxes, cylinders, spheres, holes, rectangular cuts, unions, and rigid transforms. Direct inspection accepts a self-contained USDA containing one BRep and declaring millimeter units (`metersPerUnit = 0.001`) and Z-up orientation.

Unsupported operations, external references, binary USDC, other units, and multi-BRep stages are rejected. There is no silent CadQuery fallback or unit conversion. Inspect assembly bodies individually until multi-BRep stage support is implemented.

## Checks and limitations

| Check | Evidence | Limit |
| --- | --- | --- |
| Topology | NVIDIA/SMLib manifold-solid check | Does not claim the same coverage as OCCT BRepCheck |
| Volume | Finite positive signed volume | Numerical integral; not a manufacturing tolerance |
| Body count | Native material census | `requireSingleSolid` is enforced when requested in a build plan |
| Serialization | Export/import and compare volume, count, bounds, and center | Does not prove full surface Hausdorff equivalence |
| Dimensions | Explicit volume measurements and optional reference volume | Other required native measurements block as unverified |
| Integrity | File SHA-256, plan checksum, and policy identity | Trusted local caller; not a signed audit certificate |
| Visual | Provider result bound to the current review version | Accuracy and screenshot authenticity depend on the external provider |

Native bounds include conservative expansion and cannot replace exact trimmed-dimension acceptance. Centers come from `Brep.center()` and are not certified material mass centers. The standalone pipeline does not include assembly-interference checks, structural simulation, manufacturing qualification, or a general constraint solver.

## Numerical policy

| Parameter | Value |
| --- | --- |
| Linear absolute comparison tolerance | 1e-6 mm |
| Linear relative comparison tolerance | 1e-9 |
| Volume absolute comparison tolerance | 1e-8 mm³ |
| Volume relative comparison tolerance | 1e-7 |
| Native volume integration relative accuracy | 1e-8 |

Relative linear allowance follows object size, rather than distance from the origin. Rules are versioned by `unified-brep-review-v2`. These values describe software comparisons, not achievable machining accuracy.

## Reference case

The example is a 40 × 30 × 6 mm plate with an 8 mm centered through-hole. Its independent reference is:

```text
V = 40 × 30 × 6 − π × 4² × 6
  = 6898.40710525538 mm³
```

A local native import measured `6898.40710546356 mm³`, an absolute difference of approximately `2.08e-7 mm³`. This is one case, not a universal accuracy or performance claim.

The [report excerpt](../examples/review-report.json) retains actual geometry facts, comparison results, policy, and decisions. Runtime-specific cache and session identifiers are omitted; the file is labeled as an excerpt. The [illustration](assets/native-review.svg) projects the corresponding native STL and is a static document asset, not the review application's UI.

Reproduce with the configured native environment:

```bash
node scripts/cli.mjs build examples/plate.json --output output/plate
node scripts/cli.mjs review output/plate/native-solid.usda --output output/review --expected-volume 6898.40710525538
```

Prerequisites are in [Getting started](getting-started.md). Differences within the declared policy can occur across runtime versions and platforms.

## Automated verification

`npm test` covers joint decisions, stale provider results, geometry changes during review, missing evidence, required measurements, and reference volumes. With `USD_BREP_PYTHON` configured, `npm run check` also runs Python numerical tests and a real native smoke test.

The smoke test constructs the plate, directly imports its precise USDA, checks a second export/import, and tests rejection of wrong units, a wrong reference volume, and an unsupported feature. Assertions are in [native-smoke.mjs](../scripts/native-smoke.mjs).

GitHub Actions defines Node core checks and native Linux/Windows jobs. Inspect the linked workflow for current results. Visual providers used in automated tests are fixtures; a real AI visual service requires application-level validation.
