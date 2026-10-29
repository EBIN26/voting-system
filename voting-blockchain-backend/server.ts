import "dotenv/config";

import express from "express";
import type {
  Request,
  Response,
  NextFunction,
} from "express";

import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";

import { ethers } from "ethers";

import {
  generateKeyPair,
  encryptVote,
  decryptVote,
} from "./utils/crypto.js";


// ==================================================
// BigInt JSON serialization
// ==================================================

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};


// ==================================================
// Express
// ==================================================

const app = express();


// ==================================================
// HTTP security headers
// ==================================================

app.use(helmet());


// ==================================================
// CORS configuration
// ==================================================

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:5173,http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);


app.use(
  cors({
    origin: (
      origin,
      callback
    ) => {

      // Allow requests without an Origin header.
      // This allows PowerShell, Postman and
      // server-to-server requests.

      if (!origin) {
        return callback(null, true);
      }


      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }


      return callback(
        new Error(
          "Origin not allowed by CORS."
        )
      );
    },

    methods: [
      "GET",
      "POST",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "x-admin-api-key",
    ],
  })
);


// ==================================================
// JSON request body limit
// ==================================================

app.use(
  express.json({
    limit: "10kb",
  })
);


// ==================================================
// RSA encryption keys
// ==================================================

const {
  publicKey,
  privateKey,
} = generateKeyPair();


// ==================================================
// Environment configuration
// ==================================================

const RPC_URL =
  process.env.RPC_URL;

const BLOCKCHAIN_PRIVATE_KEY =
  process.env.BLOCKCHAIN_PRIVATE_KEY;

const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS;

const ADMIN_API_KEY =
  process.env.ADMIN_API_KEY;


if (
  !RPC_URL ||
  !BLOCKCHAIN_PRIVATE_KEY ||
  !CONTRACT_ADDRESS ||
  !ADMIN_API_KEY
) {
  throw new Error(
    "Missing environment variables. Check RPC_URL, BLOCKCHAIN_PRIVATE_KEY, CONTRACT_ADDRESS, and ADMIN_API_KEY."
  );
}


// ==================================================
// Blockchain connection
// ==================================================

const provider =
  new ethers.JsonRpcProvider(
    RPC_URL
  );


const signer =
  new ethers.Wallet(
    BLOCKCHAIN_PRIVATE_KEY,
    provider
  );


// ==================================================
// Contract ABI
// ==================================================

const CONTRACT_ABI = [

  "function startElection() external",

  "function endElection() external",

  "function admin() external view returns (address)",

  "function electionState() external view returns (uint8)",

  "function startTime() external view returns (uint256)",

  "function endTime() external view returns (uint256)",

  "function castVote(string calldata encryptedPayload, bytes32 voterHash) external",

  "function getVote(uint256 index) external view returns (string memory)",

  "function getTotalVotes() external view returns (uint256)",

  "function hasVoted(bytes32 voterHash) external view returns (bool)",
];


// ==================================================
// Contract
// ==================================================

const votingContract =
  new ethers.Contract(
    CONTRACT_ADDRESS,
    CONTRACT_ABI,
    signer
  );


// ==================================================
// Blockchain startup verification
// ==================================================

async function verifyBlockchainConfiguration() {

  try {

    const contractAdmin =
      await votingContract.admin();

    const signerAddress =
      await signer.getAddress();


    if (
      contractAdmin.toLowerCase() !==
      signerAddress.toLowerCase()
    ) {

      throw new Error(
        `Blockchain signer is not the contract admin. Signer: ${signerAddress}, Contract admin: ${contractAdmin}`
      );
    }


    console.log(
      "Blockchain admin verified:",
      contractAdmin
    );

  } catch (error: any) {

    console.error(
      "Blockchain startup verification failed:",
      error.message
    );

    throw error;
  }
}


// ==================================================
// Admin authentication middleware
// ==================================================

function requireAdminApiKey(
  req: Request,
  res: Response,
  next: NextFunction
) {

  const providedKey =
    req.headers["x-admin-api-key"];


  if (
    typeof providedKey !== "string"
  ) {

    return res.status(401).json({

      success: false,

      error:
        "Missing admin API key.",
    });
  }


  if (
    providedKey !== ADMIN_API_KEY
  ) {

    return res.status(403).json({

      success: false,

      error:
        "Invalid admin API key.",
    });
  }


  next();
}


// ==================================================
// Vote rate limiter
// ==================================================

const voteRateLimiter =
  rateLimit({

    windowMs:
      60 * 1000,

    max:
      10,

    standardHeaders:
      true,

    legacyHeaders:
      false,

    message: {

      success: false,

      error:
        "Too many vote requests. Please try again later.",
    },
  });


// ==================================================
// Vote input validation
// ==================================================

function validateVoteInput(
  req: Request,
  res: Response,
  next: NextFunction
) {

  const {
    voterId,
    candidateName,
    symbolName,
  } = req.body;


  // ------------------------------------------------
  // Type validation
  // ------------------------------------------------

  if (
    typeof voterId !== "string" ||
    typeof candidateName !== "string" ||
    typeof symbolName !== "string"
  ) {

    return res.status(400).json({

      success: false,

      error:
        "voterId, candidateName, and symbolName must be strings.",
    });
  }


  // ------------------------------------------------
  // Empty value validation
  // ------------------------------------------------

  if (
    voterId.trim().length === 0 ||
    candidateName.trim().length === 0 ||
    symbolName.trim().length === 0
  ) {

    return res.status(400).json({

      success: false,

      error:
        "Vote parameters cannot be empty.",
    });
  }


  // ------------------------------------------------
  // Maximum length validation
  // ------------------------------------------------

  if (
    voterId.length > 100 ||
    candidateName.length > 100 ||
    symbolName.length > 100
  ) {

    return res.status(400).json({

      success: false,

      error:
        "Vote parameters exceed the allowed length.",
    });
  }


  next();
}


// ==================================================
// Root endpoint
// ==================================================

app.get(
  "/",
  (
    req: Request,
    res: Response
  ) => {

    return res.json({

      status:
        "online",

      message:
        "Secure Voting Blockchain Backend API",

      endpoints: {

        castVote:
          "POST /api/vote",

        totalVotes:
          "GET /api/votes/count",

        electionStatus:
          "GET /api/admin/election/status",

        startElection:
          "POST /api/admin/election/start",

        endElection:
          "POST /api/admin/election/end",

        adminTally:
          "GET /api/admin/tally",
      },
    });
  }
);


// ==================================================
// Election status
// ==================================================

app.get(
  "/api/admin/election/status",

  requireAdminApiKey,

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const state =
        await votingContract.electionState();


      const startTime =
        await votingContract.startTime();


      const endTime =
        await votingContract.endTime();


      const admin =
        await votingContract.admin();


      const stateNames = [
        "NotStarted",
        "Active",
        "Ended",
      ];


      return res.json({

        success:
          true,

        election: {

          state:
            stateNames[
              Number(state)
            ],

          stateCode:
            Number(state),

          startTime:
            startTime.toString(),

          endTime:
            endTime.toString(),

          admin,
        },
      });

    } catch (error: any) {

      console.error(
        "Election status error:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          "Internal server error.",
      });
    }
  }
);


// ==================================================
// Start election
// ==================================================

app.post(
  "/api/admin/election/start",

  requireAdminApiKey,

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const tx =
        await votingContract.startElection();


      await tx.wait();


      return res.json({

        success:
          true,

        message:
          "Election started successfully.",

        txHash:
          tx.hash,
      });

    } catch (error: any) {

      console.error(
        "Start election error:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          "Internal server error.",
      });
    }
  }
);


// ==================================================
// End election
// ==================================================

app.post(
  "/api/admin/election/end",

  requireAdminApiKey,

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const tx =
        await votingContract.endElection();


      await tx.wait();


      return res.json({

        success:
          true,

        message:
          "Election ended successfully.",

        txHash:
          tx.hash,
      });

    } catch (error: any) {

      console.error(
        "End election error:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          "Internal server error.",
      });
    }
  }
);


// ==================================================
// Submit vote
// ==================================================

app.post(
  "/api/vote",

  voteRateLimiter,

  validateVoteInput,

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const {
        voterId,
        candidateName,
        symbolName,
      } = req.body;


      // ------------------------------------------------
      // Generate voter hash
      // ------------------------------------------------

      const voterHash =
        ethers.solidityPackedKeccak256(
          ["string"],
          [voterId]
        );


      // ------------------------------------------------
      // Check duplicate voting
      // ------------------------------------------------

      const alreadyVoted =
        await votingContract.hasVoted(
          voterHash
        );


      if (alreadyVoted) {

        return res.status(400).json({

          success:
            false,

          error:
            "Voter has already cast a vote.",
        });
      }


      // ------------------------------------------------
      // Prepare vote payload
      // ------------------------------------------------

      const rawPayload = {

        voterId,

        candidateName,

        symbolName,
      };


      // ------------------------------------------------
      // Encrypt vote
      // ------------------------------------------------

      const encryptedPayload =
        encryptVote(
          rawPayload,
          publicKey
        );


      // ------------------------------------------------
      // Record vote on blockchain
      // ------------------------------------------------

      const tx =
        await votingContract.castVote(
          encryptedPayload,
          voterHash
        );


      await tx.wait();


      return res.json({

        success:
          true,

        message:
          "Vote cast and recorded on-chain successfully.",

        txHash:
          tx.hash,

        voterHash,
      });

    } catch (error: any) {

      console.error(
        "Vote processing error:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          "Internal server error.",
      });
    }
  }
);


// ==================================================
// Total votes
// ==================================================

app.get(
  "/api/votes/count",

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const count =
        await votingContract.getTotalVotes();


      return res.json({

        success:
          true,

        totalVotes:
          count,
      });

    } catch (error: any) {

      console.error(
        "Vote count error:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          "Internal server error.",
      });
    }
  }
);


// ==================================================
// Admin tally
// ==================================================

app.get(
  "/api/admin/tally",

  requireAdminApiKey,

  async (
    req: Request,
    res: Response
  ) => {

    try {

      const totalVotes: bigint =
        await votingContract.getTotalVotes();


      const decryptedVotes = [];


      for (
        let i = 0;
        i < Number(totalVotes);
        i++
      ) {

        const encryptedPayload: string =
          await votingContract.getVote(i);


        const decrypted =
          decryptVote(
            encryptedPayload,
            privateKey
          );


        decryptedVotes.push(
          decrypted
        );
      }


      return res.json({

        success:
          true,

        decryptedVotes,
      });

    } catch (error: any) {

      console.error(
        "Admin tally error:",
        error
      );

      return res.status(500).json({

        success:
          false,

        error:
          "Internal server error.",
      });
    }
  }
);


// ==================================================
// Global error handler
// ==================================================

app.use(
  (
    error: any,
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    console.error(
      "Unhandled server error:",
      error
    );


    if (res.headersSent) {

      return next(error);
    }


    return res.status(500).json({

      success:
        false,

      error:
        "Internal server error.",
    });
  }
);


// ==================================================
// Start server
// ==================================================

async function startServer() {

  try {

    // ------------------------------------------------
    // Verify blockchain configuration first
    // ------------------------------------------------

    await verifyBlockchainConfiguration();


    // ------------------------------------------------
    // Start Express server
    // ------------------------------------------------

    app.listen(
      3000,
      () => {

        console.log(
          "Secure Voting Express Backend running on http://localhost:3000"
        );


        console.log(
          "Connected contract:",
          CONTRACT_ADDRESS
        );
      }
    );

  } catch (error: any) {

    console.error(
      "Backend startup failed:",
      error
    );

    process.exit(1);
  }
}


startServer();