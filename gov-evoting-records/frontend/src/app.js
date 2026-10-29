import { keccak_256 } from "@noble/hashes/sha3";
import { encryptBallot, toHex, fromHex } from "../../lib/ballot";

const $ = (id) => document.getElementById(id);
const SCREENS = ["home", "otp", "registered", "ballot", "confirm", "done"];

const state = {
  election: null,
  fetchedAt: 0,         // wall-clock seconds when `election` was loaded, to run the countdown
  key: null,            // { spki: Uint8Array, keyHash, electionId }
  keyOk: false,
  mode: null,           // "register" | "login"
  txnId: null,
  session: null,        // login session lives in memory only
  token: null,          // voting token (0x…), also saved in localStorage until used
  choice: null,
};

// ---------- helpers ----------

function notice(text = "", kind = "") {
  const el = $("notice");
  el.textContent = text;
  el.className = "notice " + kind;
}

function show(name) {
  for (const s of SCREENS) $("screen-" + s).hidden = s !== name;
  const heading = $("screen-" + name).querySelector("h2");
  heading?.focus({ preventScroll: false });
}

async function api(path, { method = "GET", body, session } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(session ? { Authorization: "Bearer " + session } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
  return data;
}

// Browser storage can be blocked (private mode), so it is never relied on silently.
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  del(key) { try { localStorage.removeItem(key); } catch {} },
};
// Includes the election key fingerprint, so a new election deployed at the same address
// (as happens on a fresh local test chain) never inherits an old saved token.
const storeKey = () => "govvote:" + (state.election?.contract || "x") + ":" + (state.key?.keyHash || "");
const loadSaved = () => { try { return JSON.parse(store.get(storeKey()) || "null"); } catch { return null; } };

const tokenHashOf = (token) => toHex(keccak_256(fromHex(token)));
const shorten = (h) => h.slice(0, 10) + "…" + h.slice(-8);

function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function formatLeft(seconds) {
  if (seconds <= 0) return "closed";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (d) return `${d}d ${h}h left`;
  if (h) return `${h}h ${m}m left`;
  return m ? `${m}m ${s}s left` : `${s}s left`;
}

const votingOpen = () => {
  const e = state.election;
  if (!e || e.phase !== "Voting") return false;
  const now = e.chainTime + (Math.floor(Date.now() / 1000) - state.fetchedAt);
  return now >= e.startTime && now <= e.endTime;
};

// ---------- election status ----------

function renderStatus() {
  const e = state.election;
  if (!e) return;
  $("title").textContent = e.title;
  const chip = $("phaseChip");
  const text = $("phaseText");
  const now = e.chainTime + (Math.floor(Date.now() / 1000) - state.fetchedAt);
  $("timeLeft").textContent = "";

  if (e.phase === "Setup") {
    chip.textContent = "Not open yet"; chip.className = "chip";
    text.textContent = "Voting has not opened yet. You can register now.";
  } else if (e.phase === "Voting" && now < e.startTime) {
    chip.textContent = "Opening soon"; chip.className = "chip";
    text.textContent = "Voting opens soon. You can register now.";
  } else if (votingOpen()) {
    chip.textContent = "Voting open"; chip.className = "chip open";
    text.textContent = "Voting is open.";
    $("timeLeft").textContent = formatLeft(e.endTime - now);
  } else if (e.phase === "Voting") {
    chip.textContent = "Voting closed"; chip.className = "chip closed";
    text.textContent = "The voting period is over. The votes will be counted shortly.";
  } else if (e.phase === "Closed") {
    chip.textContent = "Counting"; chip.className = "chip closed";
    text.textContent = "Voting is closed. The election trustees are counting the votes.";
  } else {
    chip.textContent = "Results final"; chip.className = "chip closed";
    text.textContent = "The election is over and the trustees have agreed on the result.";
  }

  $("goLogin").disabled = !votingOpen() || !state.keyOk;
  renderResume();
}

function renderResume() {
  const saved = loadSaved();
  const hasToken = !!(state.token || saved?.state === "issued");
  $("resumeBox").hidden = !(hasToken && votingOpen() && state.keyOk);
  $("resumeText").textContent = "You already have a voting token. You can go straight to your ballot.";
  $("votedBox").hidden = saved?.state !== "cast";
}

async function loadElection() {
  state.election = await api("/api/election");
  state.fetchedAt = Math.floor(Date.now() / 1000);
  await loadResults();
}

let resultsShown = false;
async function loadResults() {
  const card = $("resultsCard");
  if (state.election.phase !== "Finalized") { card.hidden = true; resultsShown = false; return; }
  if (resultsShown) return;
  try {
    const r = await api("/api/public/results");
    const total = r.results.reduce((n, x) => n + x.votes, 0) || 1;
    const top = Math.max(...r.results.map((x) => x.votes));
    const box = $("results");
    box.replaceChildren();
    for (const item of r.results) {
      const row = document.createElement("div");
      row.className = "result-row";
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
    $("resultsNote").textContent = `${r.counted} valid votes counted from ${r.ballots} ballots recorded on the blockchain.`;
    card.hidden = false;
    resultsShown = true;
  } catch {
    card.hidden = true;
  }
}

async function loadKey() {
  try {
    const key = await api("/api/election-key");
    const spki = pemToDer(key.publicKeyPem);
    // The key we were given must hash to the fingerprint we were told. A mismatch means
    // the response was tampered with, and the app refuses to encrypt anything.
    state.keyOk = toHex(keccak_256(spki)) === key.keyHash;
    state.key = { spki, keyHash: key.keyHash, electionId: key.electionId };
    $("fingerprint").textContent = shorten(key.keyHash);
    if (!state.keyOk) notice("The election key failed its integrity check. Do not vote from this page.", "err");
  } catch (e) {
    state.keyOk = false;
    notice(e.message, "err");
  }
}

// ---------- registration and login ----------

function startFlow(mode) {
  state.mode = mode;
  state.txnId = null;
  $("otpHeading").textContent = mode === "register" ? "Register" : "Log in to vote";
  $("otpIntro").textContent =
    mode === "register"
      ? "Enter your Aadhaar number. We send an OTP to the phone linked to it. You only register once."
      : "Enter your Aadhaar number to get a login OTP. After logging in you receive a one-time voting token.";
  $("aadhaarForm").hidden = false;
  $("otpForm").hidden = true;
  $("demoOtp").hidden = true;
  $("aadhaar").value = "";
  $("otp").value = "";
  notice();
  show("otp");
}

const aadhaarDigits = () => $("aadhaar").value.replace(/\D/g, "");

$("aadhaar").addEventListener("input", (e) => {
  const d = e.target.value.replace(/\D/g, "").slice(0, 12);
  e.target.value = d.replace(/(\d{4})(?=\d)/g, "$1 ");
});

$("aadhaarForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const digits = aadhaarDigits();
  if (!/^[2-9]\d{11}$/.test(digits)) return notice("Enter a valid 12-digit Aadhaar number.", "err");
  const btn = $("sendOtp");
  btn.disabled = true;
  try {
    const r = await api(`/api/${state.mode === "register" ? "register" : "auth"}/start`, { method: "POST", body: { aadhaar: digits } });
    state.txnId = r.txnId;
    $("aadhaar").value = ""; // the number is not kept on screen or in memory longer than needed
    $("aadhaarForm").hidden = true;
    $("otpForm").hidden = false;
    const demo = $("demoOtp");
    demo.hidden = !r.demoOtp;
    if (r.demoOtp) {
      demo.textContent = `Demo mode: your OTP is ${r.demoOtp}`;
      $("demoBanner").hidden = false;
    }
    notice("If your number is valid, an OTP was sent to your linked phone.", "ok");
    $("otp").focus();
  } catch (err) {
    notice(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

$("resend").addEventListener("click", () => startFlow(state.mode));

$("otpForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const otp = $("otp").value.trim();
  if (!/^\d{6}$/.test(otp)) return notice("The OTP has 6 digits.", "err");
  const btn = $("verifyOtp");
  btn.disabled = true;
  try {
    if (state.mode === "register") {
      const r = await api("/api/register/verify", { method: "POST", body: { txnId: state.txnId, otp } });
      $("regDoneText").textContent = r.alreadyRegistered
        ? "You were already registered. You can log in when voting is open."
        : "Registration complete. When voting is open, log in with a new OTP to get your ballot.";
      notice();
      show("registered");
    } else {
      const r = await api("/api/auth/verify", { method: "POST", body: { txnId: state.txnId, otp } });
      state.session = r.session;
      await getToken();
    }
  } catch (err) {
    notice(err.message, "err");
  } finally {
    btn.disabled = false;
    $("otp").value = "";
  }
});

// ---------- voting token ----------

async function getToken() {
  notice("Checking your eligibility…");
  try {
    const r = await api("/api/voting/token", { method: "POST", body: {}, session: state.session });
    state.token = r.token;
    // Saved BEFORE anything else: the server shows it once and can never re-issue it.
    const saved = store.set(storeKey(), JSON.stringify({ state: "issued", token: r.token }));
    notice(saved ? "You are verified. Your voting token is saved in this browser." : "You are verified. This browser could not save your token: download the backup on the next screen before voting.", saved ? "ok" : "warn");
    openBallot();
  } catch (err) {
    notice(err.message, "err");
    show("home");
  } finally {
    state.session = null; // the login ends here; from now on only the token is used
  }
}

function openBallot() {
  const box = $("choices");
  box.replaceChildren();
  state.election.candidates.forEach((name, i) => {
    const label = document.createElement("label");
    label.className = "choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "candidate";
    input.value = String(i);
    const span = document.createElement("span");
    span.id = "candidate-name-" + i;
    span.textContent = name;
    input.setAttribute("aria-labelledby", span.id); // screen readers announce the name, not the index
    label.append(input, span);
    box.append(label);
  });
  state.choice = null;
  show("ballot");
}

$("ballotForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const sel = document.querySelector("input[name=candidate]:checked");
  if (!sel) return notice("Pick a candidate first.", "warn");
  state.choice = Number(sel.value);
  $("confirmChoice").textContent = state.election.candidates[state.choice];
  notice();
  show("confirm");
});

$("changeBtn").addEventListener("click", () => { notice(); show("ballot"); });

$("downloadToken").addEventListener("click", () => {
  if (!state.token) return;
  const blob = new Blob([`Voting token (keep private; anyone with it can cast your vote):\n${state.token}\n`], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "voting-token-backup.txt";
  a.click();
  URL.revokeObjectURL(a.href);
  notice("Backup downloaded. Keep it private.", "ok");
});

// ---------- casting ----------

$("castBtn").addEventListener("click", async () => {
  if (!state.keyOk) return notice("The election key could not be verified. Not voting.", "err");
  if (!votingOpen()) return notice("Voting is not open.", "err");
  const btn = $("castBtn");
  btn.disabled = true;
  $("changeBtn").disabled = true;
  $("progress").hidden = false;
  try {
    notice("Encrypting your vote on this device…");
    const ballot = await encryptBallot(state.key.spki, state.choice, state.key.electionId);
    notice("Sending your encrypted vote…");
    // No login session is sent: the ballot carries only the one-time token.
    const r = await api("/api/voting/cast", { method: "POST", body: { token: state.token, ballot } });
    const hash = tokenHashOf(state.token);
    store.set(storeKey(), JSON.stringify({ state: "cast", tokenHash: hash, txHash: r.txHash }));
    state.token = null;
    state.choice = null; // nothing about the choice is kept
    $("receiptCode").textContent = hash;
    notice();
    show("done");
  } catch (err) {
    notice(err.message, "err");
  } finally {
    btn.disabled = false;
    $("changeBtn").disabled = false;
    $("progress").hidden = true;
  }
});

// ---------- receipt ----------

async function checkReceipt(hash) {
  try {
    const r = await api("/api/receipt/" + hash);
    notice(r.recorded ? "Confirmed: a ballot with this code is recorded on the blockchain." : "Not found on the blockchain yet. Try again in a moment.", r.recorded ? "ok" : "warn");
  } catch (err) {
    notice(err.message, "err");
  }
}
$("receiptCheck").addEventListener("click", () => checkReceipt($("receiptCode").textContent));
$("checkBtn").addEventListener("click", () => {
  const saved = loadSaved();
  if (saved?.tokenHash) {
    $("receiptCode").textContent = saved.tokenHash;
    show("done");
    checkReceipt(saved.tokenHash);
  }
});

// ---------- navigation ----------

$("goRegister").addEventListener("click", () => startFlow("register"));
$("goLogin").addEventListener("click", () => startFlow("login"));
$("regToLogin").addEventListener("click", () => (votingOpen() ? startFlow("login") : (notice("Voting is not open yet. Come back when it opens.", "warn"), show("home"))));
document.querySelectorAll(".back").forEach((b) => b.addEventListener("click", () => { notice(); show("home"); renderStatus(); }));

$("resumeBtn").addEventListener("click", () => {
  const saved = loadSaved();
  state.token = state.token || saved?.token || null;
  if (!state.token) return notice("No saved token found.", "err");
  notice();
  openBallot();
});

$("tokenForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("tokenInput").value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(t)) return notice("That does not look like a voting token.", "err");
  if (!votingOpen() || !state.keyOk) return notice("Voting is not open.", "warn");
  state.token = t;
  $("tokenInput").value = "";
  store.set(storeKey(), JSON.stringify({ state: "issued", token: t }));
  notice();
  openBallot();
});

// ---------- start ----------

(async function init() {
  try {
    await loadElection();
    await loadKey();
    renderStatus();
    show("home");
  } catch (err) {
    $("phaseChip").textContent = "Unavailable";
    notice(err.message, "err");
  }
  setInterval(() => { if (state.election) renderStatus(); }, 1000);
  setInterval(() => loadElection().then(renderStatus).catch(() => {}), 15000);
})();
