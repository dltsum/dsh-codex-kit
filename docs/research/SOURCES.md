# Source ledger

Retrieved or re-verified 2026-08-28. Links are provided instead of bundling copyrighted PDFs or third-party code.

## Official DeepSeek Harness

- [Official repository and developer-preview notice](https://github.com/deepseek-ai/deepseek-harness)
- [Official documentation site](https://deepseek-harness.github.io/deepseek-harness/)
- [Skills subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)
- [Filesystem Skill provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md)
- [Compaction subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md)
- [Configuration catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.md)
- [Extension cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md)
- [Safety notice](https://github.com/deepseek-ai/deepseek-harness/blob/master/SAFETY.md)
- [Official GitHub Discussions forum](https://github.com/deepseek-ai/deepseek-harness/discussions)
- [NPM package](https://www.npmjs.com/package/@deepseek-ai/dsh)

Reproduce registry state:

```powershell
npm view @deepseek-ai/dsh version dist-tags time --json
npm view @deepseek-ai/dsh-subagent-codex dist-tags versions --json
npm view @deepseek-ai/dsh-subagent-claude-code dist-tags versions --json
```

## Relevant DSH forum threads

These are community reports/RFCs, not confirmed release notes unless the upstream maintainers say so.

- [#524 Provider-neutral ToolSearch and staged activation seams](https://github.com/deepseek-ai/deepseek-harness/discussions/524)
- [#4749 Prefix-cache impact of pre-step message ordering](https://github.com/deepseek-ai/deepseek-harness/discussions/4749)
- [#2379 Context overflow involving fixed output budget](https://github.com/deepseek-ai/deepseek-harness/discussions/2379)
- [#4586 Extension guardrails and safe authoring RFC](https://github.com/deepseek-ai/deepseek-harness/discussions/4586)
- [#4622 Sticky max-token state question](https://github.com/deepseek-ai/deepseek-harness/discussions/4622)
- [#4703 Token meter underflow report](https://github.com/deepseek-ai/deepseek-harness/discussions/4703)
- [#1886 Token-usage projection discussion](https://github.com/deepseek-ai/deepseek-harness/discussions/1886)
- [#3482 Harness Intelligence discussion](https://github.com/deepseek-ai/deepseek-harness/discussions/3482)

## Papers

- Wang et al. [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291), arXiv:2305.16291, 2023.
- Pan et al. [LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression](https://arxiv.org/abs/2403.12968), arXiv:2403.12968, Findings of ACL 2024.
- Su et al. [BRIGHT: A Realistic and Challenging Benchmark for Reasoning-Intensive Retrieval](https://arxiv.org/abs/2407.12883), arXiv:2407.12883, 2024/2025 revision.
- Zheng et al. [SkillWeaver: Web Agents can Self-Improve by Discovering and Honing Skills](https://arxiv.org/abs/2504.07079), arXiv:2504.07079, 2025.
- Gan and Sun. [RAG-MCP: Mitigating Prompt Bloat in LLM Tool Selection via Retrieval-Augmented Generation](https://arxiv.org/abs/2505.03275), arXiv:2505.03275, 2025.
- Lumer et al. [Tool-to-Agent Retrieval: Bridging Tools and Agents for Scalable LLM Multi-Agent Systems](https://arxiv.org/abs/2511.01854), arXiv:2511.01854, 2025.
- Franko. [Dynamic System Instructions and Tool Exposure for Efficient Agentic LLMs](https://arxiv.org/abs/2602.17046), arXiv:2602.17046, 2025 submission; preprint.
- Zheng et al. [SkillRouter: Skill Routing for LLM Agents at Scale](https://arxiv.org/abs/2603.22455), arXiv:2603.22455v5, 2026.
- Cho et al. [SkillRet: A Large-Scale Benchmark for Skill Retrieval in LLM Agents](https://arxiv.org/abs/2605.05726), arXiv:2605.05726, 2026.
- Chen et al. [Optimal Skill Selection for LLM Agents with Provable Bicriteria Guarantees](https://arxiv.org/abs/2608.19993), arXiv:2608.19993, 2026; preprint.

The Kit uses these works for design hypotheses and limitations. It does not copy their reported metrics into project claims.

## Community ecosystem discovery

- [Official `dsh-plugin` GitHub topic](https://github.com/topics/dsh-plugin)
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- [Bilingual community list](https://github.com/HackSing/dsh-plugins)
- [DSH ecosystem map](https://github.com/zoahdev/dsh-ecosystem)

Community catalogs are useful discovery indexes, not endorsement or a trust root. The executable catalog in this repository includes only explicit, pinned install specs that were separately inspected at the snapshot date.
