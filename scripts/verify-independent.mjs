import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { createClient } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = JSON.parse(
  fs.readFileSync(path.join(ROOT, "evidence.json"), "utf8")
);
const client = createClient({ chain: studionet });
const addr = ev.contractAddress;
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label} ${detail}`);
  if (!ok) failures++;
};

const sha = crypto
  .createHash("sha256")
  .update(fs.readFileSync(path.join(ROOT, "contracts/skillgraph.py")))
  .digest("hex");
check("source SHA256 matches evidence", sha === ev.sourceSha256, sha.slice(0, 16));

const read = async (fn, args) => {
  await sleep(2200);
  return client.readContract({ address: addr, functionName: fn, args });
};
const jread = async (fn, args) => {
  const raw = await read(fn, args);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const counts = await jread("get_counts", []);
check("counts claim_count 37", counts?.claim_count === 37, JSON.stringify(counts));
check("counts skill_count 36", counts?.skill_count === 36);
check("counts claimer_count 3", counts?.claimer_count === 3);
check("counts assessed_count 4", counts?.assessed_count === 4);
check("counts total_weight 5", counts?.total_weight === 5);

const doc = await jread("get_skill", ["documentation"]);
check("documentation weight 4", doc?.weight === 4, JSON.stringify(doc));
check("documentation claim_count 2", doc?.claim_count === 2);
check("documentation endorsed_count 2", doc?.endorsed_count === 2);
const qc = await jread("get_skill", ["quantum-computing"]);
check("quantum-computing weight 1", qc?.weight === 1);
check("quantum-computing weak_count 1", qc?.weak_count === 1);
const tiny = await jread("get_skill", ["tiny-skill"]);
check("tiny-skill weight 0", tiny?.weight === 0);
check("tiny-skill rejected_count 1", tiny?.rejected_count === 1);
const unreach = await jread("get_skill", ["unreachable-skill"]);
check("unreachable-skill pending_count 1", unreach?.pending_count === 1);
const claim3 = await jread("get_claim", ["claim-3"]);
check("claim-3 still PENDING", claim3?.status === "PENDING", claim3?.status);
const claim4 = await jread("get_claim", ["claim-4"]);
check("claim-4 ENDORSED weight 2", claim4?.status === "ENDORSED" && claim4?.weight === 2);
const board = await jread("get_leaderboard", []);
check(
  "leaderboard top skill documentation weight 4",
  board?.top_skills?.[0]?.skill === "documentation" && board.top_skills[0].weight === 4
);
check(
  "leaderboard second skill quantum-computing",
  board?.top_skills?.[1]?.skill === "quantum-computing"
);
const expectedError = new Set([
  "endorse-D-unreachable",
  "claim-E-duplicate",
  "claim-cap-32-rejected",
]);
for (const s of ev.steps) {
  await sleep(2200);
  const tx = await client.getTransaction({ hash: s.hash });
  const exec =
    tx?.consensus_data?.leader_receipt?.[0]?.execution_result ||
    tx?.execution_result ||
    "UNKNOWN";
  const want = expectedError.has(s.label) ? "ERROR" : "SUCCESS";
  const ok = tx?.status === 7 && exec === want && s.executionResult === want;
  check(`tx ${s.label} FINALIZED/${want}`, ok, `${s.hash.slice(0, 10)} status=${tx?.status} exec=${exec}`);
}

console.log(failures === 0 ? "INDEPENDENT VERIFICATION: ALL PASS" : `INDEPENDENT VERIFICATION: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
