import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface HybridEncryptedPayload {
  encryptedAesKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Generate or load persistent RSA key pair
 */
export function generateKeyPair(): KeyPair {

  const keysDir = path.resolve(process.cwd(), "keys");

  console.log("RSA key folder:", keysDir);

  const publicKeyPath = path.join(keysDir, "public.pem");
  const privateKeyPath = path.join(keysDir, "private.pem");


  // Load existing keys
  if (
    fs.existsSync(publicKeyPath) &&
    fs.existsSync(privateKeyPath)
  ) {
    console.log("Loading existing RSA keys");

    return {
      publicKey: fs.readFileSync(publicKeyPath, "utf8"),
      privateKey: fs.readFileSync(privateKeyPath, "utf8"),
    };
  }


  console.log("Generating new RSA key pair");


  // Create keys directory
  fs.mkdirSync(keysDir, {
    recursive: true,
  });


  const {
    publicKey,
    privateKey,
  } = crypto.generateKeyPairSync("rsa", {

    modulusLength: 2048,

    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },

    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });


  // Save keys
  fs.writeFileSync(
    publicKeyPath,
    publicKey,
    "utf8"
  );

  fs.writeFileSync(
    privateKeyPath,
    privateKey,
    "utf8"
  );


  console.log("RSA keys saved successfully");


  return {
    publicKey,
    privateKey,
  };
}


/**
 * Hybrid encryption:
 * AES-256-GCM encrypts vote data
 * RSA encrypts AES key
 */
export function encryptVote(
  payload: Record<string, any>,
  publicKeyPem: string
): string {

  const jsonString = JSON.stringify(payload);

  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);


  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    aesKey,
    iv
  );


  let ciphertext = cipher.update(
    jsonString,
    "utf8",
    "base64"
  );

  ciphertext += cipher.final("base64");


  const authTag =
    cipher.getAuthTag()
      .toString("base64");


  const encryptedAesKey =
    crypto.publicEncrypt(
      {
        key: publicKeyPem,
        padding:
          crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      aesKey
    )
    .toString("base64");


  const bundle: HybridEncryptedPayload = {

    encryptedAesKey,

    iv: iv.toString("base64"),

    authTag,

    ciphertext,
  };


  return Buffer
    .from(JSON.stringify(bundle))
    .toString("base64");
}


/**
 * Hybrid decryption
 */
export function decryptVote(
  base64Bundle: string,
  privateKeyPem: string
): Record<string, any> {


  const bundle =
    JSON.parse(
      Buffer.from(
        base64Bundle,
        "base64"
      ).toString("utf8")
    ) as HybridEncryptedPayload;



  const aesKey =
    crypto.privateDecrypt(

      {
        key: privateKeyPem,

        padding:
          crypto.constants.RSA_PKCS1_OAEP_PADDING,

        oaepHash: "sha256",
      },

      Buffer.from(
        bundle.encryptedAesKey,
        "base64"
      )
    );



  const decipher =
    crypto.createDecipheriv(

      "aes-256-gcm",

      aesKey,

      Buffer.from(
        bundle.iv,
        "base64"
      )
    );


  decipher.setAuthTag(
    Buffer.from(
      bundle.authTag,
      "base64"
    )
  );


  let decrypted =
    decipher.update(
      bundle.ciphertext,
      "base64",
      "utf8"
    );


  decrypted += decipher.final("utf8");


  return JSON.parse(decrypted);
}