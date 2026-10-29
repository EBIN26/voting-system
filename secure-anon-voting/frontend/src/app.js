import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";

const $ = (id) => document.getElementById(id);
const IDENTITY_KEY = "anon-vote:identity";
const VOTED_KEY = "anon-vote:voted";

let election = null;

// ---------- small helpers ----------

function say(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + kind;
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function loadIdentity() {
  const saved = storageGet(IDENTITY_KEY);
  if (!saved) return null;
  try { return Identity.import(saved); } catch { return null; }
}

function formatLeft(seconds) {
  if (seconds <= 0) return "closed";
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

// ---------- rendering ----------

let choicesFor = "";
function renderChoices() {
  const key = election.candidates.join("|");
  if (choicesFor === key) return;
  choicesFor = key;
  const box = $("choices");
  box.replaceChildren();
  election.candidates.forEach((name, i) => {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "candidate";
    input.value = String(i);
    const span = document.createElement("span");
    span.textContent = name;
    label.append(input, span);
    box.append(label);
  });
}

async function renderResults() {
  const { results } = await api("/api/results");
  const total = results.reduce((a, r) => a + r.votes, 0) || 1;
  const box = $("results");
  box.replaceChildren();
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "result-row";
    const text = document.createElement("div");
    text.textContent = `${r.name}: ${r.votes}`;
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.style.width = `${(r.votes / total) * 100}%`;
    bar.append(fill);
    row.append(text, bar);
    box.append(row);
  }
}

async function refresh() {
  election = await api("/api/election");
  $("title").textContent = election.title;
  $("phase").textContent = election.phase;
  $("registered").textContent = election.registeredCount;
  $("votes").textContent = election.totalVotes;

  const left = election.votingEndsAt - election.chainTime;
  $("timeleft").textContent = election.phase === "Voting" ? formatLeft(left) : "-";

  const identity = loadIdentity();
  const voted = storageGet(VOTED_KEY) === election.contract + ":" + election.groupId;
  const closedButNotFinal = election.phase === "Voting" && left <= 0;

  $("registerCard").hidden = election.phase !== "Registration";
  $("voteCard").hidden = election.phase !== "Voting" || closedButNotFinal;
  $("finalizeCard").hidden = !closedButNotFinal;
  $("resultsCard").hidden = election.phase !== "Ended";

  if (election.phase === "Voting") {
    renderChoices();
    $("voteBtn").disabled = !identity || voted;
    $("voteHint").textContent = !identity
      ? "No identity found in this browser. Restore your backup below."
      : voted
        ? "You have already voted from this browser."
        : election.registeredCount < 5
          ? "Note: with so few registered voters, anonymity is weak."
          : "Pick a candidate. Your proof is generated on this device.";
  }
  if (election.phase === "Ended") await renderResults();
}

// ---------- actions ----------

$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("registerBtn");
  btn.disabled = true;
  try {
    let identity = loadIdentity();
    if (!identity) {
      identity = new Identity();
      if (!storageSet(IDENTITY_KEY, identity.export())) {
        throw new Error("Could not save your identity in this browser (private mode?). Registration cancelled.");
      }
    }
    await api("/api/register", { code: $("code").value, commitment: identity.commitment.toString() });
    $("code").value = "";
    say("Registered. Download your identity backup below, then come back when voting opens.", "ok");
  } catch (err) {
    say(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

$("voteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const selected = document.querySelector("input[name=candidate]:checked");
  if (!selected) return say("Pick a candidate first.", "warn");
  const candidate = Number(selected.value);
  const identity = loadIdentity();
  if (!identity) return say("No identity found in this browser.", "err");

  $("voteBtn").disabled = true;
  $("progressWrap").hidden = false;
  try {
    say("Preparing your anonymous proof. This can take a few seconds...");
    const { members } = await api("/api/group");
    const commitment = identity.commitment.toString();
    if (!members.includes(commitment)) throw new Error("This identity is not in the voter list.");

    const group = new Group(members.map(BigInt));
    const depth = Math.max(1, group.depth);
    const proof = await generateProof(identity, group, candidate, election.groupId, depth, {
      wasm: `/artifacts/v4.13.0/semaphore-${depth}.wasm`,
      zkey: `/artifacts/v4.13.0/semaphore-${depth}.zkey`,
    });

    say("Submitting your vote...");
    await api("/api/vote", {
      candidate,
      proof: {
        merkleTreeDepth: String(proof.merkleTreeDepth),
        merkleTreeRoot: String(proof.merkleTreeRoot),
        nullifier: String(proof.nullifier),
        message: String(proof.message),
        scope: String(proof.scope),
        points: proof.points.map(String),
      },
    });
    storageSet(VOTED_KEY, election.contract + ":" + election.groupId);
    say("Your vote was recorded anonymously. Thank you!", "ok");
  } catch (err) {
    say(err.message, "err");
  } finally {
    $("progressWrap").hidden = true;
    await refresh().catch(() => {});
  }
});

$("finalizeBtn").addEventListener("click", async () => {
  $("finalizeBtn").disabled = true;
  try {
    await api("/api/election/end", {});
    say("Election finalised.", "ok");
  } catch (err) {
    say(err.message, "err");
  } finally {
    $("finalizeBtn").disabled = false;
    await refresh().catch(() => {});
  }
});

$("exportBtn").addEventListener("click", () => {
  const identity = loadIdentity();
  if (!identity) return say("No identity in this browser yet.", "warn");
  const blob = new Blob([identity.export()], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "voting-identity-backup.txt";
  a.click();
  URL.revokeObjectURL(a.href);
  say("Backup downloaded. Keep it private: anyone with this file can vote as you.", "ok");
});

$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const identity = Identity.import((await file.text()).trim());
    storageSet(IDENTITY_KEY, identity.export());
    say("Identity restored.", "ok");
    await refresh();
  } catch {
    say("That file is not a valid identity backup.", "err");
  }
  e.target.value = "";
});

refresh().catch((err) => say(err.message, "err"));
setInterval(() => refresh().catch(() => {}), 10000);
