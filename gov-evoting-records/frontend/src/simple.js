// Demo page: one button press sends { voterId, candidate } to the backend, which runs
// the whole pipeline (verify -> token -> encrypt -> blockchain) and reports each step.
const $ = (id) => document.getElementById(id);
const STEP_NAMES = ["Check the request", "Verify the voter", "Issue a one-time voting token", "Encrypt the ballot", "Record on the blockchain"];
const RECORD_STEP = "Save a sealed record for the admin"; // only when the server has vote records switched on
let candidateList = []; // [{ name, symbol }]
const REVEAL_MS = 350; // steps appear one by one so the flow is easy to follow in a demo

let election = null;
let busy = false;

function notice(text = "", kind = "") {
  $("notice").textContent = text;
  $("notice").className = "notice " + kind;
}

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  } catch {
    throw new Error("Cannot reach the server.");
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const votingOpen = () => election && election.phase === "Voting" && election.chainTime >= election.startTime && election.chainTime <= election.endTime;

function renderStatus() {
  $("title").textContent = election.title;
  const chip = $("phaseChip");
  if (votingOpen()) { chip.textContent = "Voting open"; chip.className = "chip open"; }
  else if (election.phase === "Setup" || (election.phase === "Voting" && election.chainTime < election.startTime)) { chip.textContent = "Not open yet"; chip.className = "chip"; }
  else { chip.textContent = "Voting closed"; chip.className = "chip closed"; }
  $("countText").textContent = election.eligibleVoters
    ? `${election.ballotCount} of ${election.eligibleVoters} ballots on the blockchain`
    : "The election has not been opened yet.";
  document.querySelectorAll("#candidates button").forEach((b) => (b.disabled = busy || !votingOpen()));
}

function renderCandidates() {
  const box = $("candidates");
  box.replaceChildren();
  (candidateList.length ? candidateList : election.candidates.map((name) => ({ name, symbol: "" }))).forEach(({ name, symbol }, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "primary";
    const n = document.createElement("span");
    n.className = "name";
    n.textContent = name;
    const s = document.createElement("span");
    s.className = "sub";
    s.textContent = symbol ? `Symbol: ${symbol}` : "Vote";
    b.append(n, s);
    b.setAttribute("aria-label", symbol ? `Vote for ${name}, symbol ${symbol}` : `Vote for ${name}`);
    b.addEventListener("click", () => vote(i));
    box.append(b);
  });
}

async function loadVoters() {
  const r = await api("/api/simple/voters");
  if (!r.ok) throw new Error(r.status === 404 ? "Simple mode is not switched on (SIMPLE_VOTING=1)." : r.data.error);
  const sel = $("voter");
  sel.replaceChildren();
  for (const v of r.data.voters) {
    const o = document.createElement("option");
    o.value = v.voterId;
    o.textContent = `${v.voterId.replace(/(\d{4})(?=\d)/g, "$1 ")}${v.onRoll ? "" : "  (not on the roll)"}`;
    sel.append(o);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stepItem(name, state, detail = "", ms = null) {
  const li = document.createElement("li");
  li.className = state;
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = state === "ok" ? "✓" : state === "bad" ? "✗" : "…";
  const nm = document.createElement("span");
  nm.className = "name";
  nm.textContent = name;
  const t = document.createElement("span");
  t.className = "ms";
  t.textContent = ms === null ? "" : `${ms} ms`;
  const d = document.createElement("span");
  d.className = "detail";
  d.textContent = state === "ok" ? detail : state === "bad" ? detail : state === "skipped" ? "Not run." : "Working…";
  li.append(mark, nm, t, d);
  return li;
}

async function showSteps(steps) {
  const list = $("pipeline");
  list.replaceChildren(...STEP_NAMES.map((n) => stepItem(n, "pending")));
  for (let i = 0; i < STEP_NAMES.length; i++) {
    await sleep(REVEAL_MS);
    const s = steps[i];
    list.children[i].replaceWith(s ? stepItem(s.name, s.ok ? "ok" : "bad", s.detail, s.ms) : stepItem(STEP_NAMES[i], "skipped"));
  }
}

async function vote(candidate) {
  if (busy) return;
  busy = true;
  renderStatus();
  notice("Processing…");
  $("pipelineCard").hidden = false;
  $("receipt").hidden = true;
  $("pipeline").replaceChildren(...STEP_NAMES.map((n) => stepItem(n, "pending")));
  try {
    const r = await api("/api/simple/vote", { voterId: $("voter").value, candidate });
    await showSteps(r.data.steps || []);
    if (r.ok) {
      $("receiptCode").textContent = r.data.receipt.confirmationCode;
      $("receiptTx").textContent = `${r.data.receipt.txHash} (block ${r.data.receipt.blockNumber})`;
      $("receipt").hidden = false;
      notice("Vote recorded on the blockchain.", "ok");
    } else {
      notice(r.data.error || "The vote was not recorded.", "err");
    }
  } catch (e) {
    notice(e.message, "err");
  } finally {
    busy = false;
    await refresh();
  }
}

async function refresh() {
  const r = await api("/api/election");
  if (!r.ok) throw new Error(r.data.error || "Election unavailable.");
  election = r.data;
  renderStatus();
}

(async function init() {
  try {
    await refresh();
    const c = await api("/api/simple/candidates");
    if (c.ok) {
      candidateList = c.data.candidates;
      if (c.data.recordsEnabled && !STEP_NAMES.includes(RECORD_STEP)) STEP_NAMES.push(RECORD_STEP);
    }
    renderCandidates();
    renderStatus();
    await loadVoters();
  } catch (e) {
    $("phaseChip").textContent = "Unavailable";
    notice(e.message, "err");
  }
  setInterval(() => refresh().catch(() => {}), 5000);
})();
