import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/deploy-probe.mjs <contract-file>");
  process.exit(2);
}
const CODE = fs.readFileSync(path.resolve(file), "utf8");
const client = createClient({ chain: studionet });
const account = createAccount();
console.log("prober:", account.address);
const hash = await client.deployContract({ code: CODE, account });
console.log("deploy tx:", hash);
const receipt = await client.waitForTransactionReceipt({
  hash,
  status: "FINALIZED",
});
const exec =
  receipt?.consensus_data?.leader_receipt?.[0]?.execution_result ||
  receipt?.leader_receipt?.[0]?.execution_result ||
  receipt?.execution_result ||
  "UNKNOWN";
const addr = receipt?.data?.contract_address || receipt?.to_address;
console.log("execution_result:", exec);
console.log("contract_address:", addr || "(none)");
if (addr && exec === "SUCCESS") {
  try {
    const out = await client.readContract({
      address: addr,
      functionName: "get_count",
      args: [],
    });
    console.log("read get_count:", JSON.stringify(out));
  } catch (e) {
    console.log("read failed:", e.message.slice(0, 200));
  }
}
process.exit(0);
