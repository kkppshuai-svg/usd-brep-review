# Getting started / 安装与运行

[Overview](../README.md) · [中文概述](../README.zh-CN.md) · [API reference](api.md)

## Requirements

| Component | Required version |
| --- | --- |
| Node.js | 20 or later |
| Native Python environment | 3.12 |
| NVIDIA Python package | `usd-brep==1.0.0` |

The JavaScript core has no third-party runtime dependencies. Consult the [NVIDIA upstream repository](https://github.com/NVIDIA-Omniverse/usd-brep#requirements) for platform runtime and source-build requirements.

Upstream 1.0.1 is available but is not yet the default: see the [1.0.1 test results and Windows installation-path limitation](plugin.md#上游版本与精度).

## Installation

```bash
git clone https://github.com/kkppshuai-svg/usd-brep-review.git
cd usd-brep-review
```

Linux:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-native.txt
export USD_BREP_PYTHON="$PWD/.venv/bin/python"
```

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
& ./.venv/Scripts/python.exe -m pip install -r requirements-native.txt
$env:USD_BREP_PYTHON = (Resolve-Path ./.venv/Scripts/python.exe).Path
```

`USD_BREP_PYTHON` selects the Python executable. Geometry-only use does not require AI credentials. The core test command can run before installing the native environment:

```bash
npm test
```

## Native example

```bash
node scripts/cli.mjs build examples/plate.json --output output/plate
node scripts/cli.mjs review output/plate/native-solid.usda --output output/review --expected-volume 6898.40710525538
```

The plate is 40 × 30 × 6 mm with a centered 8 mm through-hole. Its reference volume is `40 × 30 × 6 − π × 4² × 6` mm³. The full report is written to `output/review/unified-review.json`; a [checked-in excerpt](../examples/review-report.json) documents one local run.

| Operation | Output artifacts |
| --- | --- |
| Build | `native-solid.usda`, `native-preview.stl`, `native-mesh.usda`, build report, unified report |
| Inspect | `review-input.usda`, `review-roundtrip.usda`, unified report |

Preview meshes are visualization artifacts. Native geometry evidence comes from the BRep.

Run the complete checks:

```bash
npm run check
```

With `USD_BREP_PYTHON` configured, this includes Python tests and real native build/import tests. Their summary is written to `output/native-smoke-report.json`.

## Inspect an existing model

```bash
node scripts/cli.mjs review model.usda --output output/my-review
```

The current adapter accepts one BRep in a self-contained USDA declaring `metersPerUnit = 0.001` and `upAxis = "Z"`. It rejects external references, binary USDC, other units, and multi-BRep stages. See [validation scope](validation.md) before processing production models.

## SDK installation

```bash
npm install git+https://github.com/kkppshuai-svg/usd-brep-review.git
```

Import from `@kkppshuai-svg/usd-brep-review`. Pin a tested commit for reproducible deployments; the package is not published to the npm registry. The installed CLI executable is `usd-brep-review`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Python cannot be started | Set `USD_BREP_PYTHON` to the intended environment, or pass `--python PATH` |
| `usd_brep` cannot be imported | Install `requirements-native.txt` into that Python 3.12 environment |
| Unit or metadata error | Use self-contained, millimeter, Z-up USDA; units are not silently converted |
| Geometry passes but delivery is pending | Supply current screenshots and a real [visual provider](api.md#visual-provider) |
| Artifact-integrity error | Rebuild or re-import the changed artifact instead of reusing old evidence |

The process records `runtimeWarnings` when the native package writes to stderr. Inspect the upstream runtime configuration if warnings persist; successful geometry tests do not establish that every upstream API is available.

## 中文说明

按对应系统的命令创建 Python 3.12 环境并安装依赖，将 `USD_BREP_PYTHON` 指向该环境。运行示例后，可在输出目录查看精确 USD、预览网格和联合报告。

几何检查无需 AI 账号。完整交付还需要真实视觉检查，不能把 CLI 退出码 0 或几何通过当成完整验收。数值策略和未覆盖项目见[验证范围](validation.md)。
