import { BrowserProvider, Contract } from "ethers";

const $ = (id) => document.getElementById(id);
const OPEN_ABI = ["function openElection(uint256 eligible, uint256 start, uint256 end)"];
const MIN_LEAD_SECONDS = 120; // the start must be safely in the future when the transaction is mined

const state = {
  election: null,
  fetchedAt: 0,
  stats: null,         // from /api/admin/stats (needs the admin key)
  adminKey: null,      // memory only
  keyInfo: null,
  progress: null,
  results: null,
  wallet: null,        // { provider, address }
  pending: null,       // { eligible, start, end } waiting for confirmation
};

// ---------- helpers ----------

function notice(text = "", kind = "") {
  const el = $("notice");
  el.textContent = text;
  el.className = "notice " + kind;
}

async function api(path, { method = "GET", body, adminKey } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(adminKey ? { "x-admin-api-key": adminKey } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Cannot reach the server.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const chainNow = () => state.election.chainTime + (nowSeconds() - state.fetchedAt);
const fmt = (unix) => new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const short = (a) => a.slice(0, 8) + "…" + a.slice(-6);

function formatLeft(seconds) {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function checkList(el, items) {
  el.replaceChildren();
  for (const { status, text } of items) {
    const li = document.createElement("li");
    li.className = status;
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = { ok: "✓", bad: "✗", wait: "…", warn: "!" }[status];
    const label = document.createElement("span");
    label.textContent = (status === "ok" ? "OK: " : status === "bad" ? "Problem: " : status === "warn" ? "Check: " : "Pending: ") + text;
    li.append(mark, label);
    el.append(li);
  }
}

// ---------- rendering ----------

function renderStatus() {
  const e = state.election;
  if (!e) return;
  $("title").textContent = e.title + " – administration";
  const chip = $("phaseChip");
  $("timeLeft").textContent = "";
  const t = chainNow();
  if (e.phase === "Setup") {
    chip.textContent = "Not opened"; chip.className = "chip";
    $("phaseText").textContent = "The election has been set up but not opened. Voters can register already.";
  } else if (e.phase === "Voting" && t < e.startTime) {
    chip.textContent = "Scheduled"; chip.className = "chip";
    $("phaseText").textContent = `Voting opens ${fmt(e.startTime)}.`;
    $("timeLeft").textContent = "opens in " + formatLeft(e.startTime - t);
  } else if (e.phase === "Voting" && t <= e.endTime) {
    chip.textContent = "Voting open"; chip.className = "chip open";
    $("phaseText").textContent = `Voting closes ${fmt(e.endTime)}.`;
    $("timeLeft").textContent = formatLeft(e.endTime - t) + " left";
  } else if (e.phase === "Voting") {
    chip.textContent = "Ready to close"; chip.className = "chip closed";
    $("phaseText").textContent = "The voting period is over. Close the election to start the count.";
  } else if (e.phase === "Closed") {
    chip.textContent = "Counting"; chip.className = "chip closed";
    $("phaseText").textContent = "Voting is closed. The trustees are decrypting and counting.";
  } else {
    chip.textContent = "Results final"; chip.className = "chip closed";
    $("phaseText").textContent = "The trustees agreed on the result.";
  }

  $("openCard").hidden = e.phase !== "Setup";
  $("scheduleCard").hidden = e.phase === "Setup";
  $("countCard").hidden = !(e.phase === "Closed" || e.phase === "Finalized");
  $("resultsCard").hidden = e.phase !== "Finalized";
  $("closeBox").hidden = !(e.phase === "Voting" && t > e.endTime);
  if (e.phase !== "Setup") {
    $("schedStart").textContent = fmt(e.startTime);
    $("schedEnd").textContent = fmt(e.endTime);
  }
}

function renderTurnout() {
  const e = state.election;
  if (!e) return;
  const eligible = e.eligibleVoters;
  const pct = eligible ? (e.ballotCount / eligible) * 100 : 0;
  $("turnoutPct").textContent = (eligible ? pct.toFixed(1) : "0") + "%";
  $("turnoutText").textContent = eligible ? `${e.ballotCount} of ${eligible} eligible voters have voted` : "The election has not been opened, so there is no voter limit yet.";
  $("turnoutBar").style.width = Math.min(100, pct) + "%";
  $("turnoutBarWrap").setAttribute("aria-label", `Turnout ${pct.toFixed(1)} percent`);

  const s = state.stats;
  $("cRoll").textContent = s ? s.rollSize : "locked";
  $("cRegistered").textContent = s ? s.registered : "locked";
  $("cIssued").textContent = s ? s.tokensIssued : "locked";
  $("cBallots").textContent = e.ballotCount;
  $("cEligible").textContent = eligible || "not set";

  const items = [];
  if (!s) {
    items.push({ status: "wait", text: "Unlock monitoring with the admin API key to run the consistency checks." });
  } else {
    if (e.phase !== "Setup") {
      items.push(eligible === s.rollSize
        ? { status: "ok", text: "The voter limit on the blockchain equals the electoral roll size." }
        : { status: "bad", text: `The voter limit on the blockchain (${eligible}) differs from the electoral roll (${s.rollSize}).` });
    }
    items.push(s.tokensUsed === e.ballotCount
      ? { status: "ok", text: "Every voting token that was used has exactly one ballot on the blockchain." }
      : { status: "warn", text: `Tokens used (${s.tokensUsed}) and ballots on the blockchain (${e.ballotCount}) differ. A vote may be in progress; if this persists, investigate.` });
    items.push(s.tokensIssued <= s.registered && s.registered >= 0
      ? { status: "ok", text: "No more tokens were issued than there are registered voters." }
      : { status: "bad", text: "More tokens were issued than registered voters." });
  }
  checkList($("consistency"), items);
}

function renderOpenChecks() {
  const e = state.election;
  if (!e || e.phase !== "Setup") return;
  const s = state.stats;
  const items = [];
  const keyHash = state.keyInfo?.keyHash;
  items.push(keyHash && keyHash === e.electionKeyHash
    ? { status: "ok", text: `The election key (${short(keyHash)}) matches the one fixed on the blockchain.` }
    : { status: "bad", text: "The election public key is missing or does not match the blockchain." });
  items.push(s
    ? (s.rollSize > 0 ? { status: "ok", text: `The electoral roll has ${s.rollSize} voters.` } : { status: "bad", text: "The electoral roll is empty." })
    : { status: "wait", text: "Unlock monitoring to check the electoral roll." });
  if (!state.wallet) {
    items.push({ status: "wait", text: "Connect the administrator wallet." });
  } else if (state.wallet.address.toLowerCase() !== e.admin.toLowerCase()) {
    items.push({ status: "bad", text: `This wallet (${short(state.wallet.address)}) is not the election administrator (${short(e.admin)}).` });
  } else if (state.wallet.chainId !== e.chainId) {
    items.push({ status: "bad", text: `The wallet is on network ${state.wallet.chainId}, but the election is on network ${e.chainId}.` });
  } else {
    items.push({ status: "ok", text: "The administrator wallet is connected on the right network." });
  }
  checkList($("openChecks"), items);
  $("walletInfo").textContent = state.wallet ? "Connected: " + state.wallet.address : "";
  if (s && !$("eligible").value) $("eligible").value = s.rollSize;
  $("eligibleHelp").textContent = s ? `The electoral roll has ${s.rollSize} voters. This limit should equal that.` : "Must equal the size of the electoral roll.";
}

function renderCounting() {
  const p = state.progress;
  if (!p) return;
  $("thresholdText").textContent = p.threshold;
  $("agreePct").textContent = `${p.leadingAgreement} of ${p.threshold}`;
  $("agreeText").textContent = state.election.phase === "Finalized" ? "trustees agreed: the result is final" : "matching tallies needed to finalise";
  const tbody = $("trusteeRows");
  tbody.replaceChildren();
  for (const t of p.trustees) {
    const tr = document.createElement("tr");
    const a = document.createElement("td");
    a.className = "mono";
    a.textContent = t.address;
    const b = document.createElement("td");
    b.textContent = t.submitted ? "Yes" : "Not yet";
    tr.append(a, b);
    tbody.append(tr);
  }
}

function renderResults() {
  const r = state.results;
  if (!r) return;
  const total = r.results.reduce((n, x) => n + x.votes, 0) || 1;
  const top = Math.max(...r.results.map((x) => x.votes));
  const box = $("results");
  box.replaceChildren();
  for (const item of r.results) {
    const row = document.createElement("div");
    row.className = "result-row" + (item.votes === top && top > 0 ? " winner" : "");
    const line = document.createElement("div");
    line.className = "label-line";
    const name = document.createElement("span");
    name.textContent = item.name;
    if (item.votes === top && top > 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Leading";
      name.append(badge);
    }
    const votes = document.createElement("span");
    votes.textContent = `${item.votes} (${((item.votes / total) * 100).toFixed(1)}%)`;
    line.append(name, votes);
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.style.width = (item.votes / total) * 100 + "%";
    bar.append(fill);
    row.append(line, bar);
    box.append(row);
  }
  $("resultsNote").textContent =
    `${r.counted} valid votes counted from ${r.ballots} ballots on the blockchain` +
    (r.notCounted ? `; ${r.notCounted} ballot(s) could not be decrypted and were not counted.` : ".") +
    ` Turnout ${r.eligibleVoters ? ((r.ballots / r.eligibleVoters) * 100).toFixed(1) : 0}%.`;
}

function renderAudit() {
  const e = state.election;
  if (!e) return;
  const rows = [
    ["Contract", e.contract], ["Network (chain id)", String(e.chainId)], ["Administrator", e.admin],
    ["Backend submitter", e.submitter], ["Trustees needed", `${e.threshold} of ${e.trustees.length}`],
    ["Election key fingerprint", e.electionKeyHash], ["Candidates", e.candidates.join(", ")],
  ];
  const dl = $("audit");
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    div.append(dt, dd);
    dl.append(div);
  }
}

// ---------- data loading ----------

async function loadAll() {
  state.election = await api("/api/election");
  state.fetchedAt = nowSeconds();
  if (!state.keyInfo) state.keyInfo = await api("/api/election-key").catch(() => null);
  if (state.adminKey) {
    try {
      state.stats = await api("/api/admin/stats", { adminKey: state.adminKey });
    } catch (e) {
      if (e.status === 401) lock("The admin API key was rejected.");
    }
  }
  if (state.election.phase === "Closed" || state.election.phase === "Finalized") {
    state.progress = await api("/api/public/tally-progress").catch(() => state.progress);
  }
  if (state.election.phase === "Finalized") {
    state.results = await api("/api/public/results").catch(() => state.results);
  }
  renderAll();
}

function renderAll() {
  renderStatus(); renderTurnout(); renderOpenChecks(); renderCounting(); renderResults(); renderAudit();
  updateSummary(); // function declaration below is hoisted
}

// ---------- access ----------

function lock(message) {
  state.adminKey = null;
  state.stats = null;
  $("adminKey").value = "";
  $("lockBtn").hidden = true;
  $("unlockBtn").hidden = false;
  if (message) notice(message, "err");
  if (state.election) renderAll();
}

$("unlockForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const key = $("adminKey").value;
  if (!key) return notice("Enter the admin API key.", "err");
  $("unlockBtn").disabled = true;
  try {
    state.stats = await api("/api/admin/stats", { adminKey: key });
    state.adminKey = key;
    $("adminKey").value = "";
    $("unlockBtn").hidden = true;
    $("lockBtn").hidden = false;
    notice("Monitoring unlocked.", "ok");
    renderAll();
  } catch (e) {
    notice(e.status === 401 ? "That admin API key is not correct." : e.message, "err");
  } finally {
    $("unlockBtn").disabled = false;
  }
});
$("lockBtn").addEventListener("click", () => { lock(); notice("Locked.", "ok"); });

// ---------- opening the election ----------

$("connectBtn").addEventListener("click", async () => {
  try {
    if (!window.ethereum) throw new Error("No wallet found in this browser. Install the administrator's wallet extension.");
    const provider = new BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    const net = await provider.getNetwork();
    state.wallet = { provider, address: accounts[0], chainId: Number(net.chainId) };
    notice();
    renderOpenChecks();
  } catch (e) {
    notice(e.message, "err");
  }
});

function defaultStart() {
  const d = new Date((nowSeconds() + 600) * 1000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readForm() {
  const eligible = Number($("eligible").value);
  const start = Math.floor(new Date($("startAt").value).getTime() / 1000);
  const hours = Number($("hours").value);
  if (!Number.isInteger(eligible) || eligible < 1 || eligible > 1_000_000_000) throw new Error("Enter the number of eligible voters (a whole number of at least 1).");
  if (!Number.isFinite(start)) throw new Error("Choose when voting opens.");
  if (start < chainNow() + MIN_LEAD_SECONDS) throw new Error("Voting must open at least 2 minutes from now.");
  if (!(hours >= 0.5 && hours <= 24 * 30)) throw new Error("Voting can stay open between 30 minutes and 30 days.");
  return { eligible, start, end: start + Math.round(hours * 3600) };
}

function updateSummary() {
  if (!state.election || state.election.phase !== "Setup") return;
  try {
    const f = readForm();
    $("openSummary").textContent = `Voting would open ${fmt(f.start)} and close ${fmt(f.end)}, for ${f.eligible} eligible voters.`;
  } catch (e) {
    $("openSummary").textContent = e.message;
  }
}
$("openForm").addEventListener("input", updateSummary);

$("openForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  try {
    state.pending = readForm();
    const s = state.stats;
    if (!s) throw new Error("Unlock monitoring first, so the voter limit can be checked against the electoral roll.");
    if (state.pending.eligible !== s.rollSize) {
      throw new Error(`The voter limit (${state.pending.eligible}) must equal the electoral roll size (${s.rollSize}).`);
    }
    if (!state.wallet) throw new Error("Connect the administrator wallet first.");
    if (state.wallet.address.toLowerCase() !== state.election.admin.toLowerCase()) throw new Error("This wallet is not the election administrator.");
    if (state.wallet.chainId !== state.election.chainId) throw new Error("Switch the wallet to the election's network.");
    notice();
    $("confirmOpen").hidden = false;
    $("reviewBtn").disabled = true;
    $("signBtn").focus();
  } catch (e) {
    notice(e.message, "err");
  }
});

$("cancelOpen").addEventListener("click", () => {
  $("confirmOpen").hidden = true;
  $("reviewBtn").disabled = false;
  state.pending = null;
});

$("signBtn").addEventListener("click", async () => {
  const p = state.pending;
  if (!p) return;
  $("signBtn").disabled = true;
  try {
    notice("Waiting for you to sign in your wallet…");
    const signer = await state.wallet.provider.getSigner();
    const contract = new Contract(state.election.contract, OPEN_ABI, signer);
    const tx = await contract.openElection(p.eligible, p.start, p.end);
    notice("Waiting for the blockchain to confirm…");
    await tx.wait();
    notice("The election is open.", "ok");
    $("confirmOpen").hidden = true;
    state.pending = null;
    await loadAll();
  } catch (e) {
    notice(e.shortMessage || e.reason || e.message, "err");
  } finally {
    $("signBtn").disabled = false;
    $("reviewBtn").disabled = false;
  }
});

// ---------- closing ----------

$("closeBtn").addEventListener("click", async () => {
  $("closeBtn").disabled = true;
  try {
    notice("Closing the election…");
    await api("/api/election/close", { method: "POST", body: {} });
    notice("The election is closed. The trustees can now count.", "ok");
    await loadAll();
  } catch (e) {
    notice(e.message, "err");
  } finally {
    $("closeBtn").disabled = false;
  }
});

// ---------- start ----------

(async function init() {
  $("startAt").value = defaultStart();
  $("hours").value = "8";
  try {
    await loadAll();
  } catch (e) {
    $("phaseChip").textContent = "Unavailable";
    notice(e.message, "err");
  }
  setInterval(() => { if (state.election) { renderStatus(); } }, 1000);
  setInterval(() => loadAll().catch(() => {}), 10000);
})();
