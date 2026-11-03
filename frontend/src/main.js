import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { STRINGS, getLang, setLang } from "./i18n.js";
import {
  walletState,
  connectInjected,
  connectEphemeral,
  disconnect,
} from "./wallet.js";

const DEFAULT_CONTRACT =
  import.meta.env.VITE_CONTRACT_ADDRESS ||
  "0x0a0c2a3e40fc98d33F93db6157A37948265eaa32";
const EXPLORER = "https://explorer-studio.genlayer.com/address/";

const readClient = createClient({ chain: studionet });

let lang = getLang();
let contractAddress = DEFAULT_CONTRACT;
let graph = { skills: [], claims: [], people: new Map() };
let selected = null;
let filterText = "";
let nodes = [];
let edges = [];
let simRunning = false;
let dragNode = null;
let downPos = null;

const $ = (id) => document.getElementById(id);
const t = (key) => STRINGS[lang][key] || STRINGS.en[key] || key;
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 4000);
}

function setStatus(msg, kind = "") {
  const el = $("txStatus");
  el.textContent = msg || "";
  el.className = `tx-status ${kind}`;
}

function applyLang() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  $("langEn").classList.toggle("active", lang === "en");
  $("langZh").classList.toggle("active", lang === "zh");
  document.documentElement.lang = lang;
}

function renderWalletState() {
  const el = $("walletState");
  const btn = $("walletBtn");
  if (walletState.mode === "injected") {
    el.textContent = `${t("walletConnected")} ${shortAddr(walletState.address)}`;
    btn.textContent = t("walletDisconnect");
  } else if (walletState.mode === "ephemeral") {
    el.textContent = t("walletEphemeralOn");
    btn.textContent = t("walletDisconnect");
  } else {
    el.textContent = t("walletNone");
    btn.textContent = t("walletConnect");
  }
}

function receiptResult(receipt) {
  return (
    receipt?.consensus_data?.leader_receipt?.[0]?.execution_result ||
    receipt?.leader_receipt?.[0]?.execution_result ||
    receipt?.execution_result ||
    receipt?.statusName ||
    "UNKNOWN"
  );
}

function receiptError(receipt) {
  return (
    receipt?.consensus_data?.leader_receipt?.[0]?.error ||
    receipt?.leader_receipt?.[0]?.error ||
    ""
  );
}

function humanError(code) {
  const map = {
    DUPLICATE_CLAIM: "DUPLICATE_CLAIM",
    CAP_REACHED: "CAP_REACHED",
    INVALID_INPUT: "INVALID_INPUT",
    INVALID_STATUS: "INVALID_STATUS",
    EVIDENCE_UNREACHABLE: "EVIDENCE_UNREACHABLE",
    NOT_FOUND: "NOT_FOUND",
  };
  return map[code] || code || "WRITE_FAILED";
}

async function read(fn, args = []) {
  const raw = await readClient.readContract({
    address: contractAddress,
    functionName: fn,
    args,
  });
  if (raw === "" || raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function loadGraph() {
  $("graphLoading").hidden = false;
  $("graphEmpty").hidden = true;
  try {
    const counts = await read("get_counts", []);
    if (!counts) throw new Error("empty counts");
    $("meterClaims").textContent = counts.claim_count;
    $("meterSkills").textContent = counts.skill_count;
    $("meterWeight").textContent = counts.total_weight;

    const claims = [];
    for (let i = 0; i < counts.claim_count; i++) {
      const id = await readClient.readContract({
        address: contractAddress,
        functionName: "get_claim_id",
        args: [i],
      });
      if (!id) continue;
      const claim = await read("get_claim", [id]);
      if (claim) claims.push(claim);
    }
    const skills = [];
    for (let i = 0; i < counts.skill_count; i++) {
      const key = await readClient.readContract({
        address: contractAddress,
        functionName: "get_skill_id",
        args: [i],
      });
      if (!key) continue;
      const node = await read("get_skill", [key]);
      if (node) skills.push(node);
    }
    const people = new Map();
    for (const c of claims) {
      if (!people.has(c.claimer)) {
        people.set(c.claimer, { claimer: c.claimer, score: 0, claims: [] });
      }
      const p = people.get(c.claimer);
      p.claims.push(c);
      p.score += c.weight || 0;
    }
    graph = { skills, claims, people };
    buildSim();
    renderLeaders();
    $("graphLoading").hidden = true;
    $("graphEmpty").hidden = claims.length > 0;
  } catch (e) {
    $("graphLoading").hidden = true;
    setStatus(t("errLoad"), "err");
    console.error(e);
  }
}

async function renderLeaders() {
  try {
    const board = await read("get_leaderboard", []);
    if (!board) return;
    $("topSkills").innerHTML = board.top_skills
      .map(
        (s) =>
          `<li>${escapeHtml(s.skill)} <span class="w">${s.weight}</span> · ${s.endorsed_count} endorsed</li>`
      )
      .join("");
    $("topClaimers").innerHTML = board.top_claimers
      .map(
        (c) =>
          `<li><span class="who">${escapeHtml(c.claimer)}</span> <span class="w">${c.score}</span></li>`
      )
      .join("");
  } catch (e) {
    console.error(e);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSim() {
  const W = 900;
  const H = 560;
  nodes = [];
  edges = [];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  graph.skills.forEach((s, i) => {
    nodes.push({
      id: `skill:${s.skill_key}`,
      kind: "skill",
      label: s.skill,
      weight: s.weight,
      data: s,
      x: W / 2 + Math.cos((i / Math.max(1, graph.skills.length)) * Math.PI * 2) * 200,
      y: H / 2 + Math.sin((i / Math.max(1, graph.skills.length)) * Math.PI * 2) * 160,
      vx: 0,
      vy: 0,
    });
  });
  [...graph.people.values()].forEach((p, i) => {
    nodes.push({
      id: `person:${p.claimer}`,
      kind: "person",
      label: shortAddr(p.claimer),
      weight: p.score,
      data: p,
      x: 80 + ((i * 137) % 740),
      y: 60 + ((i * 89) % 440),
      vx: 0,
      vy: 0,
    });
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const c of graph.claims) {
    const a = byId.get(`person:${c.claimer}`);
    const b = byId.get(`skill:${c.skill_key}`);
    if (a && b) edges.push({ a, b, claim: c });
  }
  selected = null;
  renderDetail(null);
  drawGraph();
  if (!reduced) startSim();
}

function startSim() {
  if (simRunning) return;
  simRunning = true;
  let energy = Infinity;
  const tick = () => {
    if (!simRunning) return;
    const W = 900;
    const H = 560;
    energy = 0;
    for (const n of nodes) {
      if (n === dragNode) continue;
      let fx = (W / 2 - n.x) * 0.002;
      let fy = (H / 2 - n.y) * 0.002;
      for (const o of nodes) {
        if (o === n) continue;
        const dx = n.x - o.x;
        const dy = n.y - o.y;
        const d2 = Math.max(900, dx * dx + dy * dy);
        const f = 2600 / d2;
        fx += (dx / Math.sqrt(d2)) * f;
        fy += (dy / Math.sqrt(d2)) * f;
      }
      n.vx = (n.vx + fx) * 0.86;
      n.vy = (n.vy + fy) * 0.86;
      energy += Math.abs(n.vx) + Math.abs(n.vy);
    }
    for (const e of edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const rest = 110;
      const f = ((d - rest) / d) * 0.02;
      if (e.a !== dragNode) {
        e.a.vx += dx * f;
        e.a.vy += dy * f;
      }
      if (e.b !== dragNode) {
        e.b.vx -= dx * f;
        e.b.vy -= dy * f;
      }
    }
    for (const n of nodes) {
      if (n === dragNode) continue;
      n.x = Math.max(40, Math.min(W - 40, n.x + n.vx));
      n.y = Math.max(30, Math.min(H - 30, n.y + n.vy));
    }
    drawGraph();
    if (energy < 0.6) {
      simRunning = false;
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function nodeVisible(n) {
  if (!filterText) return true;
  if (n.kind === "skill") return n.label.toLowerCase().includes(filterText);
  return graph.claims.some(
    (c) =>
      c.claimer === n.data.claimer &&
      c.skill.toLowerCase().includes(filterText)
  );
}

function drawGraph() {
  const svg = $("graphSvg");
  const connected = new Set();
  if (selected) {
    for (const e of edges) {
      if (e.a === selected || e.b === selected) {
        connected.add(e.a.id);
        connected.add(e.b.id);
      }
    }
  }
  const dim = (n) =>
    (selected && !connected.has(n.id)) || !nodeVisible(n) ? 0.18 : 1;
  let html = "";
  for (const e of edges) {
    const w = 1 + (e.claim.weight || 0) * 1.4;
    const color =
      e.claim.status === "ENDORSED"
        ? "#8fce8a"
        : e.claim.status === "WEAK"
          ? "#e8b44a"
          : e.claim.status === "REJECTED"
            ? "#c96a5a"
            : "#6f8a76";
    const dash = e.claim.status === "PENDING" ? 'stroke-dasharray="5 4"' : "";
    const op =
      selected && !(connected.has(e.a.id) && connected.has(e.b.id))
        ? 0.15
        : nodeVisible(e.a) && nodeVisible(e.b)
          ? 0.9
          : 0.15;
    html += `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" stroke="${color}" stroke-width="${w}" opacity="${op}" ${dash} />`;
  }
  for (const n of nodes) {
    const r =
      n.kind === "skill"
        ? 15 + Math.min(n.weight, 20) * 0.9
        : 9 + Math.min(n.weight, 20) * 0.4;
    const fill = n.kind === "skill" ? "#4d7a52" : "#c9a86a";
    const stroke = selected === n ? "#f2efe4" : "none";
    html += `<g data-node="${n.id}" opacity="${dim(n)}" style="cursor:pointer">
      <circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" />
      <text x="${n.x}" y="${n.y + r + 14}" text-anchor="middle" fill="#f2efe4" font-size="12">${escapeHtml(n.label)}</text>
      <text x="${n.x}" y="${n.y + 4}" text-anchor="middle" fill="#0e1a12" font-size="12" font-weight="700">${n.weight}</text>
    </g>`;
  }
  svg.innerHTML = html;
  svg.querySelectorAll("[data-node]").forEach((g) => {
    const n = nodes.find((x) => x.id === g.dataset.node);
    g.addEventListener("pointerdown", (ev) => {
      dragNode = n;
      downPos = { x: ev.clientX, y: ev.clientY, moved: false };
      const pt = svgPoint(ev);
      n.x = pt.x;
      n.y = pt.y;
      if (!simRunning) startSim();
    });
    g.addEventListener("click", () => {
      if (downPos && downPos.moved) return;
      selected = n;
      renderDetail(n);
      drawGraph();
    });
  });
}

function svgPoint(ev) {
  const svg = $("graphSvg");
  const rect = svg.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * 900,
    y: ((ev.clientY - rect.top) / rect.height) * 560,
  };
}

function renderDetail(n) {
  const body = $("detailBody");
  if (!n) {
    body.innerHTML = `<p class="detail-hint">${escapeHtml(t("detailHint"))}</p>`;
    return;
  }
  if (n.kind === "skill") {
    const s = n.data;
    const claims = graph.claims.filter((c) => c.skill_key === s.skill_key);
    body.innerHTML = `<h3>${escapeHtml(s.skill)}</h3>
      <div class="detail-meta">${t("detailSkillWeight")}: ${s.weight} · ${s.claim_count} ${t("detailSkillClaims")} · ${s.endorsed_count}E ${s.weak_count}W ${s.rejected_count}R ${s.pending_count}P</div>
      <h3>${t("detailClaims")}</h3>
      ${claims.map(claimRow).join("")}`;
  } else {
    const p = n.data;
    body.innerHTML = `<h3>${escapeHtml(shortAddr(p.claimer))}</h3>
      <div class="detail-meta">${p.claimer}<br>${t("detailPersonScore")}: ${p.score} · ${p.claims.length} ${t("detailPersonClaims")}</div>
      <h3>${t("detailClaims")}</h3>
      ${p.claims.map(claimRow).join("")}`;
  }
  body.querySelectorAll("[data-endorse]").forEach((btn) => {
    btn.addEventListener("click", () => endorseClaim(btn.dataset.endorse));
  });
}

function claimRow(c) {
  const btn =
    c.status === "PENDING"
      ? `<button class="btn small" data-endorse="${c.claim_id}">${escapeHtml(t("detailEndorse"))}</button>`
      : `<span class="verdict ${c.status}">${c.status}</span>`;
  return `<div class="claim-row">
    <div><strong>${escapeHtml(c.skill)}</strong> · <span class="verdict ${c.status}">${c.status}</span> · +${c.weight}</div>
    <div class="who">${escapeHtml(c.claimer)}</div>
    <div><a href="${escapeHtml(c.evidence_url)}" target="_blank" rel="noreferrer">${escapeHtml(c.evidence_url)}</a></div>
    <div>${escapeHtml(c.note)}</div>
    <div style="margin-top:6px">${btn}</div>
  </div>`;
}

function ensureWriter() {
  if (walletState.mode === "ephemeral" && walletState.ephemeral) {
    return walletState.ephemeral;
  }
  if (walletState.mode === "injected") {
    const ok = window.confirm(
      "Your wallet is connected for reading. Writes here use the reviewer test account (its key stays in this tab, and the transaction is honestly attributed to the test account, not your wallet). Switch to the test account to continue?"
    );
    if (!ok) return null;
  }
  const account = connectEphemeral();
  renderWalletState();
  return account;
}

async function sendWrite(fn, args) {
  const account = ensureWriter();
  if (!account) return null;
  setStatus(t("statusWaiting"));
  try {
    const hash = await readClient.writeContract({
      address: contractAddress,
      account,
      functionName: fn,
      args,
      value: 0n,
    });
    const receipt = await readClient.waitForTransactionReceipt({
      hash,
      status: "FINALIZED",
    });
    const result = receiptResult(receipt);
    if (result !== "SUCCESS") {
      const code = receiptError(receipt);
      setStatus(`${t("errWrite")} (${humanError(code)})`, "err");
      return null;
    }
    setStatus(t("statusFinalized"), "ok");
    return receipt;
  } catch (e) {
    console.error(e);
    setStatus(t("errWrite"), "err");
    return null;
  }
}

async function claimSkill() {
  const skill = $("claimSkill").value.trim();
  const url = $("claimUrl").value.trim();
  const note = $("claimNote").value.trim();
  if (!skill || skill.length > 64 || !/^https?:\/\//.test(url)) {
    setStatus(t("errInput"), "err");
    return;
  }
  const receipt = await sendWrite("claim_skill", [skill, url, note]);
  if (receipt) {
    toast(t("toastClaimed"));
    await loadGraph();
  }
}

async function endorseClaim(claimId) {
  const receipt = await sendWrite("endorse_skill", [claimId]);
  if (receipt) {
    const claim = await read("get_claim", [claimId]);
    toast(`${t("toastEndorsed")} ${claim ? claim.verdict : ""}`);
    await loadGraph();
    const node = nodes.find((n) => n.id === `skill:${claim?.skill_key}`);
    if (node) {
      selected = node;
      renderDetail(node);
      drawGraph();
    }
  }
}

function initEvents() {
  $("skillFilter").addEventListener("input", (e) => {
    filterText = e.target.value.trim().toLowerCase();
    drawGraph();
  });
  $("resetViewBtn").addEventListener("click", () => {
    filterText = "";
    $("skillFilter").value = "";
    selected = null;
    renderDetail(null);
    drawGraph();
  });
  $("reloadBtn").addEventListener("click", loadGraph);
  $("claimBtn").addEventListener("click", claimSkill);
  $("walletBtn").addEventListener("click", async () => {
    if (walletState.mode !== "none") {
      disconnect();
      renderWalletState();
      return;
    }
    try {
      const addr = await connectInjected();
      if (!addr) {
        setStatus(t("errNoWallet"), "err");
        return;
      }
      setStatus("", "");
    } catch (e) {
      console.error(e);
      setStatus(t("errConnect"), "err");
    }
    renderWalletState();
  });
  $("ephemeralBtn").addEventListener("click", () => {
    connectEphemeral();
    renderWalletState();
  });
  $("langEn").addEventListener("click", () => {
    lang = "en";
    setLang("en");
    applyLang();
    renderDetail(selected);
  });
  $("langZh").addEventListener("click", () => {
    lang = "zh";
    setLang("zh");
    applyLang();
    renderDetail(selected);
  });
  $("loadContractBtn").addEventListener("click", () => {
    const v = $("contractInput").value.trim();
    if (!v) return;
    contractAddress = v;
    $("explorerLink").href = EXPLORER + v;
    loadGraph();
  });
  const svg = $("graphSvg");
  svg.addEventListener("pointermove", (ev) => {
    if (!dragNode) return;
    const pt = svgPoint(ev);
    if (downPos && Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y) > 4) {
      downPos.moved = true;
    }
    dragNode.x = pt.x;
    dragNode.y = pt.y;
  });
  window.addEventListener("pointerup", () => {
    dragNode = null;
    downPos = null;
  });
}

function init() {
  applyLang();
  renderWalletState();
  $("contractInput").value = contractAddress;
  $("explorerLink").href = EXPLORER + contractAddress;
  initEvents();
  loadGraph();
}

init();
