# 环境 proposal 评审 · 人工检查清单

配合 agent 检查清单（`agent.en.md`）使用。agent 先执行所有检查，你只判断下面这些点。把 **Review comment** 下面的内容整段复制到 proposal PR 的 GitHub review 里，符合的打勾；没勾的项目下面写一句原因。

## Review comment

### 环境 proposal 评审 · 关键项

**Agent 报告：** Reject `<n>` · Human judge `<n>`

<details><summary>Agent 报告</summary>

<!-- 把 agent 的 workflow 轨迹、结论表和建议贴在这里。 -->

</details>

**H0 · agent 检查已通过**
- [ ] H0.1 agent 报告里没有 Reject，或每一项都有你能接受的理由。 (D1–D8)
- [ ] H0.2 你已解决影响范围批准的待澄清事项，并对 agent 标为 Human judge 的每一项做出决定。

**H1 · 主要 workflow 值得为个人 agent 任务构建吗？**

模板： §2 “Briefly describe the main workflows and why this environment would be useful for personal-agent tasks.”

- [ ] H1.1 要把这些 workflow 做对，得了解这个人：他的历史、偏好、家庭或其他 App。 (D1.1)
- [ ] H1.2 你能想到至少一个 task 作者会想在上面做的 task。 (D1.1, D1.2)

发现重叠提案时，提醒作者并链接已有工作，建议协作或说明分工。批准不占坑，允许并行实现；已有实现合并后，再评估后续提交的新增价值。只有通过验收并 merge 才算 accepted contribution。 (D1.3)

**H2 · App 连接服务于这些 workflow 吗？**

模板： §3 “Name possible connections and briefly explain their purpose.”

- [ ] H2.1 每个连接都被 §2 的某个 workflow 用到，没有只是摆着好看的。 (D5.3, D7.1)
- [ ] H2.2 报告列出了每个 workflow 需要的个人 App，并核实实际 App / 接口是否支持，包括 Agent 单独调用工具的情况。必需连接有可行计划；缺失能力有负责人、替代方案或首版范围取舍。写出 App 或拟议契约的名字不代表已经存在。不需要消息通信时可以写 None；不默认要求接入 Mail 或 Calendar。 (D5.3, D7.1)

**H3 · 平台和 task 作者能在上面构建吗？**

模板： §3 Integration details：Operations and access、State and lifecycle、Events and notifications、Shared data and dependencies 都是必填。

- [ ] H3.1 task 作者能为某个特定的人摆好开局情境，结束后也能 reset。 (D4.1, D4.3)
- [ ] H3.2 动作和事件涵盖这些 workflow 上的 task 会用到的东西，没有缺少关键的部分。 (D3.1, D5.1)
- [ ] H3.3 App 能单独运行：只需要自己的 package、共享 runtime 和声明的依赖。 (D7.1)

**H4 · 能按这份计划验收最终成果吗？**

模板： “The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.”

- [ ] H4.1 以范围、列出的人手和日历时间来看，总工作量合理。 (D7.2, D7.3)
- [ ] H4.2 验收计划检查真实接收端记录 / 文件、调用方需要的业务结果，以及相关失败与重试结果。提供的消息示例已对照接收契约，或明确记录兼容性缺口。投递回执不自动代表业务决策，也不保证发送端回滚。承诺的 evaluator record 可由 App 历史、Core audit 与给定的 Agent 执行记录组合得到，并说明关联与计数规则。Core audit 缺少某字段，不自动代表 Core 必须增加功能。 (D4.2, D8.1, D8.2, D8.3)
- [ ] H4.3 范围边界对第一版的取舍是对的，并区分当前参考运行时限制与未来需要的 adapter。 (D2.3)

**H5 · 数据、素材和运行时依赖可以安全使用吗？**

模板： §4 License and external dependencies：代码和素材的许可、哪些托管而不再分发、运行时服务如何回放或受控。

- [ ] H5.1 数据和素材里没有发布风险：来源、品牌使用和许可都站得住。 (D6.3)
- [ ] H5.2 外部服务的回放或替身方案可信，运行不会依赖真实网络。 (D7.1)

**建议**（勾一项；建议不等于批准或合并 PR）

- [ ] Ready for scope approval（可以批准范围）
- [ ] Needs design changes（需要修改设计）
- [ ] Insufficient evidence（证据不足）
