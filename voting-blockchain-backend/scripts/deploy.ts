import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

async function main() {
  // --------------------------------------------------
  // 1. Load environment variables
  // --------------------------------------------------

  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = process.env.BLOCKCHAIN_PRIVATE_KEY;

  if (!RPC_URL || !PRIVATE_KEY) {
    throw new Error(
      "Missing RPC_URL or BLOCKCHAIN_PRIVATE_KEY in .env"
    );
  }


  // --------------------------------------------------
  // 2. Connect to Hardhat
  // --------------------------------------------------

  const provider =
    new ethers.JsonRpcProvider(RPC_URL);

  const signer =
    new ethers.Wallet(
      PRIVATE_KEY,
      provider
    );

  console.log(
    "\nDeploying from account:",
    signer.address
  );


  // --------------------------------------------------
  // 3. Read current blockchain time
  // --------------------------------------------------

  const latestBlock =
    await provider.getBlock("latest");

  if (!latestBlock) {
    throw new Error(
      "Unable to read latest blockchain block."
    );
  }

  const currentTime =
    Number(latestBlock.timestamp);


  // --------------------------------------------------
  // 4. Configure election window
  // --------------------------------------------------

  // Election starts 60 seconds after deployment.
  const startTime =
    BigInt(currentTime + 60);

  // Election ends 1 hour after deployment.
  const endTime =
    BigInt(currentTime + 3600);


  console.log(
    "Election start time:",
    startTime.toString()
  );

  console.log(
    "Election end time:",
    endTime.toString()
  );


  // --------------------------------------------------
  // 5. Load compiled contract artifact
  // --------------------------------------------------

  const artifactPath =
    path.resolve(
      "artifacts/contracts/SecureVoting.sol/SecureVoting.json"
    );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      "Contract artifact not found. Run `npx hardhat compile` first."
    );
  }

  const artifact =
    JSON.parse(
      fs.readFileSync(
        artifactPath,
        "utf8"
      )
    );


  // --------------------------------------------------
  // 6. Create contract factory
  // --------------------------------------------------

  const factory =
    new ethers.ContractFactory(
      artifact.abi,
      artifact.bytecode,
      signer
    );


  // --------------------------------------------------
  // 7. Deploy contract
  // --------------------------------------------------

  console.log(
    "\nDeploying SecureVoting contract..."
  );

  const contract =
    await factory.deploy(
      startTime,
      endTime
    );

  await contract.waitForDeployment();


  const address =
    await contract.getAddress();


  // --------------------------------------------------
  // 8. Display deployment information
  // --------------------------------------------------

  console.log(
    "\nSecureVoting contract deployed successfully."
  );

  console.log(
    "Contract address:",
    address
  );

  console.log(
    "Start time:",
    startTime.toString()
  );

  console.log(
    "End time:",
    endTime.toString()
  );


  // --------------------------------------------------
  // 9. Update CONTRACT_ADDRESS in .env
  // --------------------------------------------------

  const envPath =
    path.resolve(".env");

  if (fs.existsSync(envPath)) {

    let envContent =
      fs.readFileSync(
        envPath,
        "utf8"
      );

    if (
      /^CONTRACT_ADDRESS=.*$/m.test(
        envContent
      )
    ) {

      envContent =
        envContent.replace(
          /^CONTRACT_ADDRESS=.*$/m,
          `CONTRACT_ADDRESS=${address}`
        );

    } else {

      if (
        !envContent.endsWith("\n")
      ) {
        envContent += "\n";
      }

      envContent +=
        `CONTRACT_ADDRESS=${address}\n`;
    }

    fs.writeFileSync(
      envPath,
      envContent,
      "utf8"
    );

    console.log(
      "\nCONTRACT_ADDRESS updated in .env"
    );
  }


  console.log(
    "\nDeployment complete."
  );
}


main().catch((error) => {
  console.error(
    "\nDeployment failed:"
  );

  console.error(error);

  process.exitCode = 1;
});