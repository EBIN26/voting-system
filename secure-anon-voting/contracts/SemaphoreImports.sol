// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Forces Hardhat to compile the Semaphore contracts so tests and deploy
// scripts can use their artifacts.
import {Semaphore} from "@semaphore-protocol/contracts/Semaphore.sol";
import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
