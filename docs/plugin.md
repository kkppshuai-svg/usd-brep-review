# 审查插件 / Review plugin

这个插件把已有的 NVIDIA BRep 检查、同版本视觉结果、用户验收要求和运动采样证据合并为一份报告。报告的 `verificationMatrix` 对每项给出 `pass`、`fail` 或 `pending`、原因和实际覆盖范围。必要证据缺失时保持待验证；一项失败即不能交付通过。

## 检查 AICAD 当前版本

```bash
usd-brep-review verify-aicad /path/to/assemblies/assembly-id \
  --requirements examples/planetary-requirements.json \
  --measurements /path/to/independent-native-measurements.json \
  --output review.json
```

省略 `--measurements` 时，要求实测尺寸的项为 `pending`。只读检查现有文件，不运行测量器、不重建模型，也不修改 AICAD。独立测量文件必须包含原生测量方法和所涉实体文件的 SHA-256；哈希用于绑定输入文件，不能证明调用方的测量过程可信。CLI 状态码：`0` 全部通过，`1` 失败，`3` 尚有必要项待验证，`2` 输入或执行错误。原有 `build` / `review` 命令的状态码规则保持不变。

要求中的运动范围必须有实际采样端点，允许配置最大帧间距和最小间隙。插件核验完整性、帧序、有限值、碰撞标志和汇总一致性；只报告已采样的角度范围，不把对称性当作未经验证的全周期证明。速比来自绑定的运动报告，不能证明承载能力。

## SDK 和宿主插件接口

```js
import { createReviewPlugin, reviewAicadRevision } from '@kkppshuai-svg/usd-brep-review';

const plugin = createReviewPlugin({ onProgress: async event => console.log(event) });
plugin.register({ registerReviewPlugin: installed => {
  // The host stores installed.manifest, installed.review and installed.repair.
}});
const report = await reviewAicadRevision({ assemblyDir, requirements, measurementReport, plugin });
console.log(report.status, report.verificationMatrix);
```

`registerReviewPlugin` 是本包定义的轻量宿主接口，并非声称兼容所有 CAD 软件的原生插件 API。宿主提供可靠的 BRep、视觉、运动和尺寸证据。本包不包含视觉模型、不替宿主运行通用运动仿真，也不执行 AI 生成代码。

`plugin.repair({input, propose, build, commit, authorizedPartIds, maxAttempts})` 是可选的受限复验循环：补丁只允许修改明确授权的零件，宿主负责构建独立草稿，插件对未授权零件比较计划和几何摘要，完整要求通过后才调用宿主的 `commit`。最多三次尝试；需要的证据缺失、审查失败、原产物变化或取消都不会调用 `commit`。宿主必须在 `commit` 内原子检查 `expectedBaseRevision`，并保证 `build` 不修改原版本；接口不能代替宿主的事务和并发锁。零件体积、包围盒和中心一致也不能证明整个曲面完全相同。

## 上游版本与精度

生产依赖仍固定为 `usd-brep==1.0.0`。NVIDIA 的 [1.0.1 更新日志](https://github.com/NVIDIA-Omniverse/usd-brep/blob/main/CHANGELOG.md)列出新增的非修复式 USD BRep 校验接口、三角化提速及多项布尔和距离修复。本地 Windows / Python 3.12 独立环境中，1.0.1 的带孔板构建、回读和体积参考检查通过；球体以 `relative_accuracy=1e-8` 计算体积时抛出 `SM_ERR`，以 `1e-7` 可计算。因此尚未将其设为默认版本，也未降低当前精度策略。这个结果是本机复现，不能推断所有平台和模型都如此。

在本机中文路径下安装 1.0.1 时，还出现了上游 USD 资源插件注册失败；把 Python 环境放到纯英文路径后带孔板测试通过。建议 Windows 原生环境先使用英文目录，并复现所需几何操作。

## 研究来源与实践边界

- [BenchCAD (2026)](https://arxiv.org/abs/2605.10865)：强调操作、参数和局部编辑评价。这里实现了明确需求项与非目标零件检查，**未复现 BenchCAD 指标或数据集**。
- [CADWorld (2026)](https://arxiv.org/abs/2609.16251)：强调持久工程文件上的可执行检查和可诊断流程。这里通过修订、文件哈希、检查结果和有限修复记录落地，**不是 CADWorld 的 FreeCAD 评测器**。
- [MUSE (2026)](https://arxiv.org/abs/2605.28579)：强调多零件装配结构与接口。这里可消费独立间隙测量和采样运动证据，**尚未实现论文的完整 Physical Assembly Graph / SIE 评估**。

本地 5∶1 行星减速机 `rev-0009` 实测：齿宽、轴孔和轴向间隙的独立回读，以及 301 个运动采样通过；原视觉审查为失败，故插件综合结果为失败。结果来自已有产物和本地测量，不是通用齿轮精度、连续运动、制造公差或承载认证。
