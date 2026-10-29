// Small helpers shared by the command-line tools.

/** --key value / --flag parser. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const name = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[name] = true;
    else { out[name] = next; i++; }
  }
  return out;
}

/** Reads a line from the terminal without echoing it (for passphrases). */
function askHidden(question) {
  if (!process.stdin.isTTY) {
    throw new Error("No interactive terminal available for the passphrase prompt. (--demo-passphrases is for local demos only.)");
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const done = (fn, v) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      fn(v);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(resolve, buf);
        if (ch === "\u0003") return done(reject, new Error("Cancelled."));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** Fixed passphrases for local demos. Anyone can guess these, so never use them for real. */
const demoPassphrase = (trusteeNumber) => `demo passphrase for trustee ${trusteeNumber}`;

module.exports = { parseArgs, askHidden, demoPassphrase };
