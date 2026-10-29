require("dotenv").config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

const config = {
  rpcUrl: required("RPC_URL"),
  contractAddress: required("CONTRACT_ADDRESS"),
  // Two different keys on purpose: a leak of one must not give both powers.
  // The election admin key is NOT configured here; it never touches the server.
  registrarKey: required("REGISTRAR_PRIVATE_KEY"),
  relayerKey: required("RELAYER_PRIVATE_KEY"),
  adminApiKey: required("ADMIN_API_KEY"),
  codePepper: required("CODE_PEPPER"),
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  minVoters: Number(process.env.MIN_VOTERS || 3),
};

if (config.adminApiKey.length < 32) throw new Error("ADMIN_API_KEY must be at least 32 characters.");
if (config.codePepper.length < 32) throw new Error("CODE_PEPPER must be at least 32 characters.");
if (config.registrarKey === config.relayerKey) {
  throw new Error("REGISTRAR_PRIVATE_KEY and RELAYER_PRIVATE_KEY must be different keys.");
}

module.exports = config;
