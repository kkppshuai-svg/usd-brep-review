# Contributing

Contributions improving input coverage, evidence quality, reproducibility, or integration are welcome. Start with a reproducible issue or a focused pull request.

## Reporting a problem

Include the commit, operating system, Node and Python versions, NVIDIA package version, exact command, expected result, and observed result. Supply the smallest shareable feature plan or USDA that reproduces the problem. Remove confidential geometry, credentials, and personal paths.

For visual-provider problems, identify the provider, screenshot views, review version, and conflicting decision. A report alone does not establish that a real visual check occurred.

## Development workflow

1. Create a feature branch.
2. Run `npm test` for the provider-independent core.
3. For native changes, configure the environment following [Getting started](docs/getting-started.md) and run `npm run check`.
4. Add meaningful regression coverage for changed review behavior, supported inputs, or failure handling.
5. Update API and validation documentation when the contract changes.
6. Submit a pull request describing the problem, resulting behavior, verification, and limitations.

Do not commit generated models, local environments, account configuration, or credentials. Fixtures must be small, redistributable, and accompanied by provenance and expected results.

## Review requirements

- Missing evidence must not become a pass.
- Visual approval must not override failed geometry or changed artifact content.
- Geometry facts must come from the declared checker, rather than preview meshes or invented values.
- Unsupported native operations must be explicit; avoid silent backend fallback.
- Changes to comparison semantics must update the versioned policy and relevant tests.
- Documentation must distinguish implemented behavior, automated verification, and application-level acceptance.

## Contribution priorities

| Area | Requested work |
| --- | --- |
| Native measurements | Exact, reproducible adapters with documented evidence and tolerances |
| USD input coverage | Binary USD, references, or multiple BReps with explicit unit and dependency handling |
| Visual integrations | Reproducible real-provider examples with version binding and failure behavior |
| External geometry | Actual OCCT execution and STEP validation behind the evidence interface |
| Cross-platform checks | Small regression cases with Linux/Windows reproduction commands |

These are proposed areas, not implemented features or release commitments. Open an [issue](https://github.com/kkppshuai-svg/usd-brep-review/issues) to discuss substantial changes.

## Documentation and license

Keep English and Chinese README summaries consistent. Use relative repository links, identify measured examples, and preserve validation limitations.

Contributions are submitted under [MIT](LICENSE). Third-party dependencies retain their licenses; do not vendor NVIDIA binaries or source without reviewing upstream terms.
