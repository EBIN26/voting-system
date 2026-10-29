// Prints the exact file name the sealed records will be saved under, for the Oracle link.
//   npm run records:name        (after npm run live:deploy)
const { deployment } = require("./lib/live");
const { objectName } = require("../backend/records-export");

try {
  const d = deployment();
  if (!d) throw new Error("Deploy first: npm run live:deploy");
  console.log(objectName(d.contract));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
