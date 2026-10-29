require("dotenv").config({ quiet: true });

function required(env, name) {
  const v = env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

function loadConfig(env = process.env) {
  const config = {
    production: env.NODE_ENV === "production",
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 3000),
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : false,
    dbFile: env.DB_FILE || "data/evoting.sqlite",
    // Keyed-hash secret that turns an identity reference into the stored voter id.
    idPepper: required(env, "ID_PEPPER"),
    // OTP values are stored only as keyed hashes.
    otpSecret: required(env, "OTP_SECRET"),
    adminApiKey: required(env, "ADMIN_API_KEY"),
    // Chain access (the submitter key is the only key this server holds).
    rpcUrl: required(env, "RPC_URL"),
    contractAddress: required(env, "CONTRACT_ADDRESS"),
    // First block that can hold this contract's events. Log queries start here, not at block 0.
    deployBlock: Number(env.DEPLOY_BLOCK || 0),
    submitterKey: required(env, "SUBMITTER_PRIVATE_KEY"),
    // Mock UIDAI (development only).
    mockUidaiSecret: env.MOCK_UIDAI_SECRET || "",
    mockUidaiFile: env.MOCK_UIDAI_FILE || "data/mock-uidai.json",
    // Demo only: returns the OTP in the API response because there is no SMS gateway.
    showDemoOtp: env.SHOW_DEMO_OTP === "1",
    // Demo only: one-click voting page that skips registration and OTP login.
    simpleVoting: env.SIMPLE_VOTING === "1",
    otpTtlSeconds: Number(env.OTP_TTL_SECONDS || 300),
    sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS || 600),
  };
  for (const k of ["idPepper", "otpSecret", "adminApiKey"]) {
    if (config[k].length < 32) throw new Error(`${k} must be at least 32 characters.`);
  }
  if (config.production && (config.mockUidaiSecret || config.showDemoOtp || config.simpleVoting)) {
    throw new Error("The mock Aadhaar service, demo OTPs and simple voting must not be enabled in production.");
  }
  if (config.simpleVoting && !config.mockUidaiSecret) {
    throw new Error("SIMPLE_VOTING only works with the mock Aadhaar service.");
  }
  if (config.showDemoOtp && !config.mockUidaiSecret) {
    throw new Error("SHOW_DEMO_OTP only works with the mock Aadhaar service.");
  }
  return config;
}

module.exports = { loadConfig };
