# SkillOpt and context-efficiency research notes

This document separates paper claims from project decisions. Unless stated otherwise, the cited results are the authors' reported results on their own benchmarks and are not measurements of DSH Codex Kit.

## Design evidence

### Reusable skill libraries

Voyager (2023) uses an expanding library of executable skills with retrieval and iterative improvement in Minecraft. SkillWeaver (2025) learns reusable Web-agent APIs and reports transfer between stronger and weaker agents. These works support modular, reusable capability libraries; they do not establish that arbitrary third-party skills are safe or that automatic self-modification should be enabled by default.

Project decision: preserve a clean provider registry and load one selected body on demand. Do not let the Kit write or “improve” user Skill files automatically.

### Retrieval instead of full exposure

RAG-MCP (2025) retrieves relevant MCP/tool descriptions before model selection and reports lower prompt size and better selection on its benchmark. Dynamic System Instructions and Tool Exposure (2025 preprint) proposes per-step instruction/tool retrieval and reports large savings on a controlled benchmark.

Project decision: use retrieval for the narrower, currently public Skill API. Do not dynamically mutate the complete DSH tool set until assembly/execution/replay invariants are verified.

Evidence caution: both are arXiv works, and their reported percentages are not adopted as Kit performance claims.

### Retrieval is not solved

BRIGHT shows that surface-form retrieval performs poorly on reasoning-intensive queries. SkillRet (2026) provides a large skill-retrieval benchmark and reports substantial headroom for off-the-shelf retrievers. SkillRouter (2026) reports a large accuracy drop when full skill bodies are hidden in an approximately 80K-candidate setup and proposes body-aware retrieve/rerank.

Project decision: deterministic lexical search is a low-cost baseline and operational fallback, not a statement of state-of-the-art semantic routing. Record empty results and misses, and reserve body-aware reranking for an opt-in evaluated release.

### Token-aware set selection

Optimal Skill Selection for LLM Agents (2026 preprint) formulates multi-skill choice under a hard token budget with redundancy/benefit trade-offs and reports improved success with fewer tokens on its benchmark.

Project decision: the current release uses a simple bounded top-k for transparency. A future multi-skill selector should optimize the set rather than scoring each skill independently, but only after relevance labels and end-to-end tasks exist.

### Prompt compression

LLMLingua-2 (Findings of ACL 2024) treats compression as token classification and reports speed/latency improvements on its evaluated datasets.

Project decision: no learned compressor is bundled. Exact commands, negative rules and permission boundaries in Skill bodies make unvalidated compression unsafe. The Kit first removes unnecessary catalog exposure, which does not alter selected instructions.

### Multi-agent/tool routing

Tool-to-Agent Retrieval (2025 preprint) jointly represents tools and parent agents, reporting better retrieval on its benchmark. This is relevant to Codex-like delegation and large MCP sets.

Project decision: keep official subagent providers optional and disabled until installed and explicitly enabled. SkillOpt does not route subagents in this release.

## Implementation mapping

| Research lesson | 0.1.0 implementation | Deferred validation |
|---|---|---|
| Progressive disclosure can reduce prompt bloat | One stable `skillopt` tool; full catalog disabled in lean preset | Provider-reported token benchmark |
| Retrieval must respect hard budgets | Result count + approximate token budget | Tokenizer-specific packing |
| Metadata-only routing can miss body-resident signals | Explicitly documented limitation; empty rather than guessed matches | Body-aware reranker and SkillRet-style evaluation |
| Redundant skills waste budget | Deterministic top-k and small default | Submodular/set-aware selection |
| Learned compression can be useful but risky | No body rewriting | Fidelity test set before opt-in compressor |
| Dynamic tool exposure can break lifecycle/replay assumptions | Stable tool registration; Skills only | Pinned DSH tool-projection experiment |

## What would justify a 0.2 experiment

1. A public, contamination-controlled skill-routing evaluation set.
2. Provider-reported token and cache metrics, not only character estimates.
3. A body-aware reranker small enough to remain optional and local.
4. A no-regression gate for task success and policy filtering.
5. Model/download licenses and a clear offline uninstall path.
