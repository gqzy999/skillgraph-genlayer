import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const RPC = "https://studio.genlayer.com/api";
const CODE = readFileSync(new URL("../contracts/skillgraph.py", import.meta.url), "utf8");
const EVIDENCE_PATH = new URL("../evidence.json", import.meta.url);

const client = createClient({ chain: studionet });

const evidence = {
  network: "studionet",
  chainId: 61999,
  contractAddress: null,
  deployTx: null,
  sourceSha256: null,
  steps: [],
  counts: null,
  leaderboard: null,
  verified: false,
};

function checkpoint() {
  writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n");
}

async function waitFinalized(hash) {
  let lastErr = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      return await client.waitForTransactionReceipt({
        hash,
        status: "FINALIZED",
        interval: 3000,
        retries: 200,
      });
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const transient =
        msg.includes("<!DOCTYPE") ||
        msg.includes("not valid JSON") ||
        msg.includes("UnknownRpcError") ||
        msg.includes("eth_getTransactionByHash");
      if (!transient) throw e;
      console.log("transient RPC error while polling", hash.slice(0, 14), "- retrying in 15s (attempt", attempt + 1, ")");
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  throw lastErr;
}

function executionResult(receipt) {
  const paths = [
    receipt?.consensus_data?.leader_receipt?.[0]?.execution_result,
    receipt?.leader_receipt?.[0]?.execution_result,
    receipt?.execution_result,
    receipt?.statusName,
  ];
  for (const p of paths) {
    if (p) return p;
  }
  if (typeof receipt?.status === "number") return `STATUS_${receipt.status}`;
  return "UNKNOWN";
}

async function read(fn, args = []) {
  const raw = await client.readContract({
    address: evidence.contractAddress,
    functionName: fn,
    args,
  });
  return raw === "" ? null : JSON.parse(raw);
}

async function readRaw(fn, args = []) {
  return client.readContract({
    address: evidence.contractAddress,
    functionName: fn,
    args,
  });
}

function recordStep(label, hash, result, note = "") {
  evidence.steps.push({ label, hash, executionResult: result, note });
  checkpoint();
  console.log(label, result, evidence.contractAddress);
}

async function writeTx(label, account, fn, args, expected = "SUCCESS") {
  const hash = await client.writeContract({
    address: evidence.contractAddress,
    account,
    functionName: fn,
    args,
    value: 0n,
  });
  const receipt = await waitFinalized(hash);
  const result = executionResult(receipt);
  recordStep(label, hash, result);
  if (expected === "SUCCESS" && result !== "SUCCESS") {
    throw new Error(`${label}: expected SUCCESS, got ${result} (tx ${hash})`);
  }
  if (expected === "ERROR" && result !== "ERROR") {
    throw new Error(`${label}: expected ERROR, got ${result} (tx ${hash})`);
  }
  return { hash, receipt, result };
}

function assertEq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`assertion failed: ${what}: expected ${expected}, got ${actual}`);
  }
}

async function endorseWithRetry(label, account, claimId, expectedVerdict) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { result } = await writeTx(label, account, "endorse_skill", [claimId], "SUCCESS");
    void result;
    const claim = await read("get_claim", [claimId]);
    if (claim && claim.status === expectedVerdict) return claim;
    if (claim && claim.status !== "PENDING") {
      throw new Error(`${label}: unexpected verdict ${claim.status}, wanted ${expectedVerdict}`);
    }
    console.log(`${label}: still PENDING after attempt ${attempt}, retrying`);
  }
  throw new Error(`${label}: did not reach ${expectedVerdict} after 3 attempts`);
}

async function main() {
  const crypto = await import("node:crypto");
  evidence.sourceSha256 = crypto.createHash("sha256").update(CODE).digest("hex");

  const deployer = createAccount();
  const alice = createAccount();
  const bob = createAccount();
  const capper = createAccount();
  console.log("deployer:", deployer.address);
  console.log("alice:", alice.address);
  console.log("bob:", bob.address);
  console.log("capper:", capper.address);

  const deployHash = await client.deployContract({ code: CODE, account: deployer });
  const deployReceipt = await waitFinalized(deployHash);
  const address =
    deployReceipt?.data?.contract_address || deployReceipt?.to_address;
  if (!address) throw new Error("deploy receipt has no contract address");
  evidence.contractAddress = address;
  evidence.deployTx = deployHash;
  recordStep("deploy", deployHash, executionResult(deployReceipt));
  console.log("contract:", address);

  const deployerClient = client;
  void deployerClient;
  void deployer;

  const claimA = await writeTx("claim-A-documentation", alice, "claim_skill", [
    "documentation",
    "https://example.com",
    "writes docs",
  ]);
  void claimA;
  let claim = await read("get_claim", ["claim-0"]);
  assertEq(claim.status, "PENDING", "claim-0 status after claim");
  assertEq(claim.claimer, alice.address.toLowerCase(), "claim-0 claimer");

  await endorseWithRetry("endorse-A", alice, "claim-0", "ENDORSED");
  claim = await read("get_claim", ["claim-0"]);
  assertEq(claim.weight, 2, "claim-0 weight");
  let skill = await read("get_skill", ["documentation"]);
  assertEq(skill.weight, 2, "documentation weight");
  assertEq(skill.endorsed_count, 1, "documentation endorsed_count");

  await writeTx("claim-B-quantum", alice, "claim_skill", [
    "quantum-computing",
    "https://example.com",
    "reads papers",
  ]);
  await endorseWithRetry("endorse-B", alice, "claim-1", "WEAK");
  skill = await read("get_skill", ["quantum-computing"]);
  assertEq(skill.weight, 1, "quantum weight");
  assertEq(skill.weak_count, 1, "quantum weak_count");

  await writeTx("claim-C-tiny", bob, "claim_skill", [
    "tiny-skill",
    "https://httpbin.org/status/200",
    "minimal",
  ]);
  await endorseWithRetry("endorse-C", bob, "claim-2", "REJECTED");
  skill = await read("get_skill", ["tiny-skill"]);
  assertEq(skill.weight, 0, "tiny weight");
  assertEq(skill.rejected_count, 1, "tiny rejected_count");

  await writeTx("claim-D-unreachable", bob, "claim_skill", [
    "unreachable-skill",
    "https://github.com/this-repo-does-not-exist-xyz-12345",
    "gone",
  ]);
  await writeTx("endorse-D-unreachable", bob, "endorse_skill", ["claim-3"], "ERROR");
  claim = await read("get_claim", ["claim-3"]);
  assertEq(claim.status, "PENDING", "claim-3 stays PENDING after unreachable");
  skill = await read("get_skill", ["unreachable-skill"]);
  assertEq(skill.pending_count, 1, "unreachable pending_count");

  await writeTx("claim-E-duplicate", alice, "claim_skill", [
    "DOCUMENTATION",
    "https://example.com",
    "again",
  ], "ERROR");
  let counts = await read("get_counts", []);
  assertEq(counts.claim_count, 4, "claim_count after duplicate rejection");

  await writeTx("claim-F-same-skill-other-claimer", bob, "claim_skill", [
    "documentation",
    "https://example.com",
    "also writes docs",
  ]);
  skill = await read("get_skill", ["documentation"]);
  assertEq(skill.claim_count, 2, "documentation claim_count after second claimer");
  assertEq(skill.pending_count, 1, "documentation pending_count");

  for (let i = 0; i < 32; i++) {
    await writeTx(`claim-cap-${i}`, capper, "claim_skill", [
      `cap-skill-${i}`,
      "https://example.com",
      "cap test",
    ]);
  }
  await writeTx("claim-cap-32-rejected", capper, "claim_skill", [
    "cap-skill-32",
    "https://example.com",
    "over cap",
  ], "ERROR");
  counts = await read("get_counts", []);
  assertEq(counts.claim_count, 37, "final claim_count");
  assertEq(counts.skill_count, 36, "final skill_count");
  assertEq(counts.claimer_count, 3, "final claimer_count");
  assertEq(counts.assessed_count, 3, "assessed_count before final endorse");
  assertEq(counts.total_weight, 3, "total_weight before final endorse");

  await endorseWithRetry("endorse-F", bob, "claim-4", "ENDORSED");
  skill = await read("get_skill", ["documentation"]);
  assertEq(skill.weight, 4, "documentation weight after second endorsement");
  counts = await read("get_counts", []);
  assertEq(counts.assessed_count, 4, "final assessed_count");
  assertEq(counts.total_weight, 5, "final total_weight");

  const board = await read("get_leaderboard", []);
  evidence.leaderboard = board;
  assertEq(board.top_skills[0].skill, "documentation", "leaderboard top skill");
  assertEq(board.top_skills[0].weight, 4, "leaderboard top skill weight");
  assertEq(board.top_skills[1].skill, "quantum-computing", "leaderboard second skill");
  assertEq(board.top_claimers[0].score, 3, "leaderboard top claimer score");
  assertEq(board.top_claimers[0].claimer, alice.address.toLowerCase(), "leaderboard top claimer");

  evidence.counts = counts;
  evidence.verified = true;
  checkpoint();
  console.log("VERIFIED. contract:", address);
  console.log("counts:", JSON.stringify(counts));
  console.log("leaderboard top skills:", JSON.stringify(board.top_skills.slice(0, 3)));
}

main().catch((e) => {
  console.error("FAILED:", e);
  try {
    checkpoint();
  } catch {}
  process.exit(1);
});
