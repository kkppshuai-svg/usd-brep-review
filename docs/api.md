# API reference

[Overview](../README.md) · [Getting started](getting-started.md) · [Validation scope](validation.md)

## Native adapter

```js
import { createNvidiaUsdBrepAdapter } from '@kkppshuai-svg/usd-brep-review';
const adapter = createNvidiaUsdBrepAdapter({
  python: process.env.USD_BREP_PYTHON,
  timeoutMs: 120000
});
```

| Method | Input | Result |
| --- | --- | --- |
| `adapter.build()` | `{part, outputDir, expected?}` | `{native, session, report, usdBrepPath}` |
| `adapter.inspect()` | `{input, outputDir, expected?}` | `{native, session, report}` |

`part` is a supported feature tree; see [plate.json](../examples/plate.json). `input` is a precise USDA path. `expected` optionally contains `{volumeMm3: number}`. The caller is responsible for deriving that reference independently. Both methods execute the native Python worker and return a session bound to the resulting files.

`report` initially uses the delivery profile and remains pending without current visual evidence. Invalid geometry produces a failed report; unsupported input or native process errors reject the adapter call.

## Review session

```js
const report = await session.review({
  profile: 'delivery',
  refresh: false,
  screenshots: [],
  visualProvider: null
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `profile` | `delivery` | `geometry` evaluates geometry; `delivery` combines geometry and current visual evidence |
| `refresh` | `false` | Recompose evidence instead of returning a cached report; does not rerun the kernel |
| `screenshots` | `[]` | Current model views supplied to the visual provider |
| `visualProvider` | `null` | Async callback; requires the delivery profile and at least one screenshot |

Every call hashes the bound files and checks the plan and policy. The session writes `unified-review.json` to its output directory.

## Visual provider

```js
const report = await session.review({
  screenshots,
  visualProvider: async ({ screenshots, revisionId, plan, geometry }) => {
    const result = await yourReviewer({ screenshots, plan, geometry });
    return { ...result, revisionId };
  }
});
```

The callback receives screenshots, the current review version, a cloned plan, and an integrity-checked geometry report. Screenshots conventionally use `{view, dataUrl}`. The provider must validate and actually review the images; the core does not authenticate image capture.

The result must contain the supplied `revisionId` and a `status` such as `pass`, `warning`, or `fail`. Optional fields include `summary`, `findings`, and `recommendedNextAction`.

A visual pass requires `status: 'pass'` and an absent or `accept` recommendation. An exception or stale version marks the visual attempt unavailable and prevents reuse of an earlier visual pass. Visual approval cannot override a geometry or artifact-integrity failure.

The CLI loads a module with a default async function following this contract:

```bash
node scripts/cli.mjs review model.usda --output output/review --visual-provider ./my-reviewer.mjs --screenshots ./views.json
```

`views.json` is an array of current screenshot objects. The module implements the actual model or human review service; no production AI reviewer is bundled.

## Report decisions

| Geometry | Current visual evidence | Delivery |
| --- | --- | --- |
| pass | pass | pass |
| pass | missing, unavailable, or stale | pending |
| pass | warning or fail | fail |
| fail | any | fail |

`report.status` follows the selected profile. Individual decisions are in `report.review.geometryDecision`, `visualDecision`, and `deliveryDecision`. Additional fields include `facts`, `roundTrip`, `measurements`, `issues`, `reviewStages`, `reviewRevisionId`, `visualEvidence`, and cache metadata. See the [report excerpt](../examples/review-report.json).

`review.rollout.userAcceptance = 'pending'` describes project rollout, not the decision for an individual model. Automated checks do not change that flag.

## External geometry evidence

`createReviewSession({outputDir, engine, plan, part?, geometry, artifactPaths, expected?})` accepts evidence from a trusted external checker. `geometry` contains `valid`, finite `facts`, verified `roundTrip`, and `issues`. Bound files must remain within `outputDir` after resolving filesystem links.

This interface does not execute OpenCascade. A caller using `engine: 'cadquery'` must perform actual OCCT checks and STEP round-trip validation. See [standard evidence format](architecture.md).

## CLI options and exit codes

The separate `verify-aicad` command and its pass/fail/pending exit codes are documented in [plugin usage](plugin.md); the table below applies to the original `build` and `review` commands.

```text
usd-brep-review build PART.json --output DIR
usd-brep-review review MODEL.usda --output DIR
  [--python PATH]
  [--expected-volume MM3]
  [--visual-provider MODULE --screenshots JSON]
```

| Exit code | Meaning |
| --- | --- |
| 0 | Geometry passed; delivery can still be pending or fail |
| 1 | Geometry review blocked |
| 2 | Input, process, or execution error |

Applications requiring complete acceptance must check `review.deliveryDecision`, rather than relying on the CLI exit code.
