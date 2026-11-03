# SkillGraph — the endorsement mycelium

**Website:** https://gqzy999.github.io/skillgraph-genlayer/
**Contract (Stable Studionet, chain ID 61999):** https://explorer-studio.genlayer.com/address/0x0a0c2a3e40fc98d33F93db6157A37948265eaa32

SkillGraph is an on-chain skill endorsement graph. Anyone claims a skill
with evidence (a URL plus a note). Validators fetch the evidence and agree
on a verdict — ENDORSED, WEAK, or REJECTED — and the verdict changes the
skill node's weight, the claimer's score, and a live leaderboard. Unreachable
evidence fails closed: the claim stays pending instead of being rejected.

## How it works

- `claim_skill(skill, evidence_url, note)` — claim a skill with evidence.
  Per-claimer cap: 32 claims. Duplicate claims (same claimer, same skill,
  case-insensitive) are rejected.
- `endorse_skill(claim_id)` — validators fetch the evidence URL and judge
  support with a deterministic rule: the skill name appears in the page
  body → ENDORSED; otherwise a body of 100+ characters → WEAK; otherwise
  → REJECTED. A fetch failure or non-200 response → the claim stays
  PENDING (fail-closed, never a rejection).
- Weight: ENDORSED +2, WEAK +1, REJECTED +0 — applied to the skill node
  and to the claimer's total score.
- Views: `get_skill`, `get_claim`, `get_leaderboard`, `get_counts`
  (plus `get_claim_id` / `get_skill_id` for enumeration).

No funds move through this contract. No floats are used anywhere
consensus is involved.

## Frontend

The site is an interactive graph explorer: people and skills are nodes,
endorsements are weighted edges. Click a node to inspect its endorsements,
filter by skill, drag nodes to rearrange the mycelium. The claim form and
the endorse buttons live in the same view as the graph.

Any injected EVM wallet can connect and read. Writes use a clearly labelled
in-browser reviewer test account (its key never leaves the browser; the
transaction is real and is honestly attributed to the test account, never
presented as signed by the connected wallet).

## Evidence

See [EVIDENCE.md](EVIDENCE.md) for the deployment, the full verification
loop (all FINALIZED transactions with readbacks), and the attempt log.
Machine-readable record: [evidence.json](evidence.json).

## Develop

```bash
# contract tests (run the two suites in separate processes)
.venv/bin/python -m pytest tests -q
.venv/bin/python -m pytest tests_direct -q

# frontend
cd frontend && npm install && npm run build
```

Contract checks: `genvm-lint check contracts/skillgraph.py`,
`python scripts/check_contract.py`, `node scripts/check-i18n.mjs`
(from `frontend/`).
