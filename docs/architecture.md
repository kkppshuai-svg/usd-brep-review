# 接口与架构

[项目概述](../README.zh-CN.md) · [API 参考](api.md) · [验证范围](validation.md)

`src/review-policy.js` 定义数值策略和几何/视觉/交付的独立判定。`src/unified-review-channel.js` 核对文件与计划摘要，最多缓存 128 项。`src/combined-review.js` 按一个模型版本组合几何与视觉。`src/session.js` 验证标准几何证据并提供 `session.review()`。`src/native-adapter.js` 通过隔离的 Python 进程调用 NVIDIA。

`adapter.build()` 从特征树创建精确实体；`adapter.inspect()` 直接导入已有精确 USDA，不要求 AICAD 的 manifest、服务或修订存储。Python I/O 在 ASCII 临时路径执行，兼容 Windows 中文工作路径，完成后复制产物回调用者目录。

标准几何接口：

```js
{
  valid: true,
  facts: {
    solidCount: 1, volume: 1000, bbox: [10,10,10],
    boundsMin: [0,0,0], boundsMax: [10,10,10], center: [5,5,5]
  },
  roundTrip: { valid: true, issues: [], comparisons: [] },
  issues: []
}
```

这是可信内核检查器的输出协议，不是用户填写 JSON 后即可证明几何的捷径。外部检查器必须实际运行内核与导出回读。原生适配器自动产生证据并把实际文件绑定到 SHA-256。

数值策略：线性绝对 1e-6 mm、相对 1e-9；体积绝对 1e-8 mm³、相对 1e-7；SMLib 体积积分相对精度 1e-8。相对线性尺度采用物体大小，不能按距离原点的位置放宽。中心使用内核 `Brep.center()`；当前导入适配器限定一个 BRep，不能把此值宣称为载荷或材料质量重心。

视觉接口输入包含截图、模型审查版本、计划和当前几何报告。输出必须携带相同版本，`status` 为 pass/warning/fail，及可选 `recommendedNextAction`、`summary`、`findings`。提供器负责实际识别；通道负责版本绑定和决策。新审查失败会清除内存中的旧视觉通过，返回 `visualAttempt.status = unavailable`。

`report.review.rollout` 标记 NVIDIA 主通道、CadQuery 并行接口及用户待验收状态。它不意味着一次调用自动执行两个内核，也不意味着两个内核已互相交换精确实体。完整交付通过要求几何和当前视觉同时通过。

审查证据绑定要求所有产物位于 `outputDir` 内；符号链接经 realpath 检查，缺失或越界均阻断。JavaScript API 面向可信本地调用者；若包装成网络服务，应自行管理认证、截图真实性、上传路径和并发修订锁，不能把插件调用暴露给不受信任用户。
