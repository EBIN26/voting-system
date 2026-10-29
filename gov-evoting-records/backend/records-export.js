// Copies the sealed vote records to storage, but ONLY once the election has ended.
//
// Until the contract reports "Closed" or "Finalized" the records stay inside this server's database,
// sealed for the admin. When the phase changes, the whole set is written to storage as one file.
// The check runs on a timer, so nobody has to remember to trigger it.
const objectName = (contractAddress) => `vote-records-${String(contractAddress).toLowerCase()}.json`;

function createRecordsExporter({ db, chain, storage, electionId, candidates, log = console }) {
  let running = false;

  async function check() {
    if (running) return { exported: false, reason: "busy" };
    running = true;
    try {
      const info = await chain.info();
      if (info.phase !== "Closed" && info.phase !== "Finalized") {
        return { exported: false, reason: `The election is ${info.phase}.` };
      }
      const name = objectName(chain.address);
      // Cloud storage with a write-only link cannot be asked "is it there?", so this server remembers
      // for itself. Local storage can also be asked directly.
      const marker = `records-exported:${name}`;
      if (db.getMeta(marker)) return { exported: false, reason: "already exported", name };
      if (storage.exists && (await storage.exists(name))) {
        db.setMeta(marker, new Date().toISOString());
        return { exported: false, reason: "already exported", name };
      }

      const sealed = db.allRecords();
      const bundle = {
        version: 1,
        kind: "gov-evoting-vote-records",
        election: electionId,
        contract: chain.address,
        title: info.title,
        candidates: candidates(info),
        count: sealed.length,
        ballotsOnChain: info.ballotCount,
        // Each entry is sealed for the admin. Nothing in this file is readable without the admin's key.
        records: sealed,
      };
      await storage.put(name, JSON.stringify(bundle, null, 2));
      db.setMeta(marker, new Date().toISOString()); // only after the upload succeeded, so a failed upload is retried
      log.log(`Vote records exported to storage: ${name} (${sealed.length} records).`);
      return { exported: true, name, count: sealed.length };
    } finally {
      running = false;
    }
  }

  /** Starts the timer. Returns a function that stops it. */
  function start(intervalMs = 10_000) {
    const timer = setInterval(() => check().catch((e) => log.error("Records export failed:", e.message)), intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { check, start, objectName };
}

module.exports = { createRecordsExporter, objectName };
