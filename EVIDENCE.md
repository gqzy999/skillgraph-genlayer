# SkillGraph — Evidence

Network: Stable Studionet, chain ID 61999, RPC https://studio.genlayer.com/api.
Contract: `0x0a0c2a3e40fc98d33F93db6157A37948265eaa32`
Explorer: https://explorer-studio.genlayer.com/address/0x0a0c2a3e40fc98d33F93db6157A37948265eaa32
Deploy tx: `0x859eeb335d8d1453356a8e33028491eda6ba98ddd499499896b5111e70c58ca6`
Source SHA256: `962d81578fc0ae56330aec09029b8761abe3604a29fce56f3fdb690ebd4fa64b`
(matches `contracts/skillgraph.py` in this repo, verified independently.)

Machine-readable record: `evidence.json` (all 45 steps with tx hashes,
plus the attempt log below).

## Verification loop (all FINALIZED, independently re-verified)

Evidence URLs used: `https://example.com` (577 bytes, body contains
"documentation"), `https://httpbin.org/status/200` (200, empty body),
`https://github.com/this-repo-does-not-exist-xyz-12345` (404).

| Step | Result | What it proves |
|---|---|---|
| deploy | SUCCESS | Contract deployed and readable |
| claim-A "documentation" (example.com) | SUCCESS | claim-0 PENDING |
| endorse-A | SUCCESS | ENDORSED, skill weight 2, claimer score 2 |
| claim-B "quantum-computing" (example.com) | SUCCESS | claim-1 PENDING |
| endorse-B | SUCCESS | WEAK (577-char body, no skill mention), skill weight 1 |
| claim-C "tiny-skill" (httpbin 200, empty) | SUCCESS | claim-2 PENDING |
| endorse-C | SUCCESS | REJECTED (short body), skill weight 0 |
| claim-D "unreachable-skill" (GitHub 404) | SUCCESS | claim-3 PENDING |
| endorse-D-unreachable | ERROR (expected) | Fail-closed: claim-3 still PENDING, assessed count unchanged |
| claim-E "DOCUMENTATION" (different case) | ERROR (expected) | DUPLICATE_CLAIM, claim count still 4 |
| claim-F "documentation" (other claimer) | SUCCESS | claim-4, same skill claim_count 2 |
| claim-cap-0 … claim-cap-31 (32 claims) | SUCCESS × 32 | Per-claimer cap reached exactly at 32 |
| claim-cap-32-rejected | ERROR (expected) | CAP_REACHED, counts unchanged |
| endorse-F | SUCCESS | ENDORSED, documentation weight 4 |

Final readbacks (loop + independent re-check, identical):

- counts: claim_count 37, skill_count 36, claimer_count 3,
  assessed_count 4, total_weight 5
- documentation: weight 4, claim_count 2, endorsed_count 2
- quantum-computing: weight 1, weak_count 1
- tiny-skill: weight 0, rejected_count 1
- unreachable-skill: pending_count 1; claim-3 still PENDING
- claim-4: ENDORSED, weight 2
- leaderboard top skills: documentation (4), quantum-computing (1);
  top claimer score 3
- every loop transaction re-read from the chain: status FINALIZED (7)
  with the expected execution result, including the three expected ERROR
  transactions. Independent check: 64/64 PASS
  (`scripts/verify-independent.mjs`).

## Attempt log (abandoned addresses, never the deployment)

All of these produced no functional contract. None of their addresses is
cited as the deployment anywhere.

1. Deploy without an account: client-side error ("No account set"), no
   transaction sent.
2. Plain class + `@allow_storage`: deploy
   `0x4237ba16048f53f6d9fde206085ca35326e44cf47d9477680293d5d1c0233c1a`
   FINALIZED/ERROR (`contract_error`, exit_code 1), address
   `0x2CfF2070b9a9B8bc124Aa1f5A181d4317f6149C4` holds no contract.
3. Plain class + allow_storage compatibility shim: deploy
   `0x408b07d86c4894912ea987361380c1574feaa9bb077588fa8ee274e93af12f95`
   FINALIZED/ERROR, address
   `0x5bFD04de41164F9f1EC3990cB160Ba723F4013Dc` holds no contract.
4. Diagnostic minimal probes (plain class, both runner hashes, one funded
   with 1 GEN, one with `@allow_storage`): deploys
   `0x9c1aa7567651bfa19bc83c51c108990afe6d58919bc58bd543630945979db6d5`,
   `0x993eaef73d406e53fef3ede01f6fc88bbdd5338d7d03cf14236f9df901a2d366`,
   `0xb1675a222671f141451497834b4a99fb1f55971ad5d09364ce2515d72926f9ba`,
   `0xb4ae42163bebd1a6b6a87095cd32a5d8b06de61a8f3fdcbc994f9dc9a5b21a1c`
   — all FINALIZED/ERROR. These ruled out the runner hash, funding, and
   the marker as causes.

Root cause, found via the Studio schema check
(`gen_getContractSchemaForCode`): the runner raised "no contract
defined" because the contract class did not subclass `gl.Contract`.
Fix: `class SkillGraph(gl.Contract)` (the allow_storage compatibility
shim is retained for newer local VMs). The schema check then passed and
the deployment succeeded. The local direct-mode tests accept plain
classes, so this requirement is only visible against the live runner —
the static check `scripts/check_contract.py` now enforces the subclass.

## Findings

- Error receipts on this network carry no error string, so guard proofs
  rest on FINALIZED status plus state readbacks (counts and records
  unchanged after expected-ERROR transactions), which is what the loop
  asserts.
- Reads are rate-limited (30/minute); the independent verifier spaces
  calls 2.2 s apart.
- The endorsement judge is deterministic and string-only: skill mention
  → ENDORSED, body ≥ 100 chars → WEAK, otherwise REJECTED; any fetch
  failure or non-200 → fail-closed PENDING.

## Scope

Verification used ephemeral script accounts on Stable Studionet and a
separate read-back client. The frontend implements any-injected-wallet
connect + read and an in-browser reviewer test account for writes
(key stays in the browser; transactions are attributed to the test
account, never presented as wallet-signed). The live site deployment and
a real-browser render check are separate steps after this evidence.

## Post-build frontend fix (live-browser finding, 2026-11-04)

The first live-browser render check found the graph and leaderboard empty
with a red "Could not load the graph" error, even though the top meters
(37 claims / 36 skills / weight 5) loaded fine. Root causes, both in the
frontend only (contract untouched, no redeploy):

1. Rate-limit burst: the first `loadGraph` fired ~148 contract reads
   back-to-back (counts + 37x2 claim reads + 36x2 skill reads +
   leaderboard). Studionet allows ~30 reads/minute, so the enumeration
   failed partway and the whole graph render was skipped. Fix: phase 1
   renders meters + leaderboard from 2 reads immediately; phase 2a bursts
   only the first 10 claims (20 reads, inside budget) so the core graph
   appears within seconds; phase 2b trickles the rest at one read per
   2.2s with 65s retries on -32029, rebuilding incrementally. Skill nodes
   are now derived from claims (the leaderboard already carries weights),
   so the separate skill enumeration is gone.
2. Overlay overlap: `.graph-empty { display: grid }` (author CSS) beats
   the UA `[hidden]` rule, so the `hidden` attribute never hid the
   loading/empty overlays and they stacked on each other. Fix: a global
   `[hidden] { display: none !important; }` rule.
3. Stale status language: status messages were set as translated text,
   so switching language left an English error on screen. Fix: statuses
   are now keyed and re-rendered on language switch.

Verified after the fix: production build passes, bundle contains the
deployed contract address, i18n 58/58 with 0 missing, no "Install
MetaMask" text. A second live-browser render check is required before
any live-verified claim.

## Second frontend fix (live-browser re-check, 2026-11-04)

The fresh-tab re-check confirmed the first fix (progress counter, top-2
leaderboard, rendered graph, no overlap, no red error) but found two
residual issues, both frontend-only (contract untouched, no redeploy):

1. Background load stalled at ~13/37 with the "partially loaded" note.
   Cause: the read retry only retried rate-limit errors; any other
   transient failure (e.g. the RPC occasionally answering HTML instead
   of JSON) failed the whole enumeration immediately. Fix: retries now
   cover all read errors (65s wait for rate limits, 3s for others,
   up to 3 attempts per read).
2. Clicking a graph node never updated the detail panel. Cause: the
   simulation re-renders the SVG every frame, so a node can drift out
   from under the pointer between press and release and the click
   misses; pressing also teleported the node to the pointer, jerking
   it. Fix: selection is now decided on window pointerup from the
   recorded pressed node (press without drag = click, even if the node
   moved), the teleport on press is removed, and the per-element click
   handler is gone.

Not a bug (browser expectation corrected): tiny-skill is absent from
the Top 10 leaderboard because the contract's leaderboard sorts by
(-weight, skill_key) and 32 weight-0 cap skills sort before it
alphabetically; tiny-skill renders on the graph with weight 0, which
is the correct state.

## Third frontend fix (live-browser re-check, 2026-11-04)

The second re-check (fresh tab, cache-busted) confirmed the graph
renders with correct weights, but found two residual issues, both
frontend-only (contract untouched, no redeploy):

1. Background load stalled around 13/37 claims with the "partially
   loaded" note in two separate sessions, while the same indices read
   fine from an independent client (no data problem). The load burns
   ~22 reads for phase 1 + burst, so the ~30/minute budget runs out
   mid-background-load, and retries alone could not reliably recover
   inside one page session. Fix: claims are now cached per contract,
   so Reload resumes from the cache instead of re-spending reads;
   retries cover all transient read errors (65s for rate limits, 5s
   for others, up to 5 attempts); the progress counter stays visible
   on a partial load so the reviewer sees how far it got.
2. Clicking a node never updated the detail panel. Cause: every
   background rebuild reset `selected` to null and re-rendered the
   placeholder, wiping a click that had actually worked. (The
   pointerup selection from the second fix was correct but its result
   was discarded by the next rebuild.) Fix: buildSim now preserves the
   selected node across rebuilds (matched by id) and re-renders its
   detail instead of clearing it.
