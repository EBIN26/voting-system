// MOCK of UIDAI's OTP authentication, for development and demos only.
//
// A real deployment replaces this with an adapter that calls UIDAI through a
// licensed Authentication User Agency (AUA/KUA). Both must expose this interface:
//
//   sendOtp(aadhaarNumber)    -> Promise<{ txnId }>
//       Starts an OTP to the phone linked to the Aadhaar. Always returns a txnId,
//       even for unknown numbers, so callers cannot probe which numbers exist.
//   verifyOtp(txnId, otp)     -> Promise<{ ok: true, uidToken } | { ok: false }>
//       uidToken is a stable, per-person reference that is NOT the Aadhaar number
//       (UIDAI issues such tokens). Only this reference ever reaches the voting system.
const crypto = require("node:crypto");
const fs = require("node:fs");
const { hmac, safeEqual, sixDigitOtp } = require("./crypto-util");

const MAX_ATTEMPTS = 3;

/**
 * @param {object} opts
 * @param {string} opts.secret        mock-UIDAI secret (derives uidTokens and hashes OTPs)
 * @param {Array<{aadhaar:string, phone:string}>} opts.citizens  test identities
 * @param {(phone:string, otp:string) => void} opts.deliver     stands in for the SMS gateway
 * @param {number} opts.ttlSeconds
 */
function createMockUidai({ secret, citizens, deliver, ttlSeconds = 300, exposeOtp = false, now = () => Date.now() }) {
  if (!secret) throw new Error("Mock UIDAI needs a secret.");
  const byNumber = new Map(citizens.map((c) => [c.aadhaar, c]));
  const txns = new Map();

  const uidTokenFor = (aadhaar) => hmac(secret, "uid:" + aadhaar);

  function sweep() {
    const t = now();
    for (const [id, tx] of txns) if (tx.expires <= t) txns.delete(id);
  }

  return {
    uidTokenFor, // test helper: lets scripts compute the same reference

    async sendOtp(aadhaarNumber) {
      sweep();
      const txnId = crypto.randomBytes(16).toString("hex");
      const citizen = byNumber.get(String(aadhaarNumber));
      const tx = { expires: now() + ttlSeconds * 1000, attempts: 0, otpHash: null, uidToken: null };
      let demoOtp;
      if (citizen) {
        const otp = sixDigitOtp();
        tx.otpHash = hmac(secret, "otp:" + txnId + ":" + otp);
        tx.uidToken = uidTokenFor(citizen.aadhaar);
        deliver(citizen.phone, otp);
        // Demo mode only: with no SMS gateway the screen has to show the code. Unknown
        // numbers get none, which makes demo mode reveal who exists. Never use it for real.
        if (exposeOtp) demoOtp = otp;
      }
      txns.set(txnId, tx); // unknown numbers get a txn that can never verify
      return demoOtp ? { txnId, demoOtp } : { txnId };
    },

    async verifyOtp(txnId, otp) {
      sweep();
      const tx = txns.get(String(txnId));
      if (!tx || !tx.otpHash) return { ok: false };
      if (++tx.attempts > MAX_ATTEMPTS) {
        txns.delete(String(txnId));
        return { ok: false };
      }
      const candidate = hmac(secret, "otp:" + txnId + ":" + String(otp));
      if (!safeEqual(candidate, tx.otpHash)) return { ok: false };
      txns.delete(String(txnId)); // an OTP works once
      return { ok: true, uidToken: tx.uidToken };
    },
  };
}

function loadCitizens(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = { createMockUidai, loadCitizens };
