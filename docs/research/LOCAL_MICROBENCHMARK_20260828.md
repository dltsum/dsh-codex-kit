# Local synthetic retrieval microbenchmark

Command:

```powershell
npm run benchmark:retrieval
```

One 2026-08-28 run on Node 25.9.0, 5,000 generated Skill summaries and 200 searches produced:

| Metric | Result |
|---|---:|
| Index build | 53.047 ms |
| Approximate added JS heap | 7,496,592 bytes |
| Search p50 | 5.994 ms |
| Search p95 | 10.920 ms |
| Search max | 15.245 ms |
| Last result count | 5 |
| Heuristic last-result tokens | 249 |
| Heuristic all-catalog tokens | 184,070 |

This is a synthetic, local lexical microbenchmark. The generated descriptions are repetitive; token numbers use the Kit's conservative character heuristic; timing varies by machine and Node version. It does not measure real Skill relevance, model task success, provider billing, request-cache behavior or end-to-end latency. Re-run it locally rather than treating these numbers as a product guarantee.
