// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/// @title Anonymous e-voting on Semaphore (zero-knowledge group membership)
/// @notice Eligible voters are added to a Semaphore group as anonymous identity
/// commitments during Registration. During Voting, a voter proves in zero
/// knowledge that they belong to the group and have not voted, without revealing
/// which member they are. The proof's nullifier prevents double voting; its
/// message is the chosen candidate.
///
/// Trust model:
///  - `admin` controls the election phases and cannot see or change any vote.
///  - `registrar` (the backend) adds commitments for verified voters. It knows
///    which commitment it issued to whom, but a commitment cannot be linked to a
///    vote. It can add fake members (ballot stuffing), which is why
///    `registeredCount` is public and should be checked against the voter roll.
///  - Anyone (e.g. a relayer) may submit a vote; the proof binds the candidate,
///    so a relayer can neither change nor attribute it.
contract AnonymousVoting {
    enum Phase { Registration, Voting, Ended }

    ISemaphore public immutable semaphore;
    uint256 public immutable groupId;
    address public immutable admin;
    address public immutable registrar;

    string public title;
    string[] private _candidates;

    Phase public phase;
    uint256 public votingEndsAt;
    uint256 public registeredCount;
    uint256 public totalVotes;
    mapping(uint256 => uint256) private _tally;

    event VotersRegistered(uint256 count, uint256 totalRegistered);
    event VotingStarted(uint256 endsAt);
    event ElectionEnded();
    event VoteCast(uint256 indexed candidate, uint256 nullifier);

    error NotAdmin();
    error NotRegistrar();
    error WrongPhase(Phase expected, Phase actual);
    error BadSetup();
    error NoVoters();
    error InvalidCandidate();
    error InvalidScope();
    error VotingClosed();
    error VotingStillOpen();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier inPhase(Phase p) {
        if (phase != p) revert WrongPhase(p, phase);
        _;
    }

    constructor(
        ISemaphore _semaphore,
        address _registrar,
        string memory _title,
        string[] memory candidateNames
    ) {
        if (candidateNames.length < 2 || candidateNames.length > 50) revert BadSetup();
        if (_registrar == address(0)) revert BadSetup();
        semaphore = _semaphore;
        admin = msg.sender;
        registrar = _registrar;
        title = _title;
        for (uint256 i = 0; i < candidateNames.length; i++) {
            _candidates.push(candidateNames[i]);
        }
        // This contract is the group admin, so only it can change membership.
        groupId = _semaphore.createGroup(address(this));
    }

    // ---------- Registration ----------

    function registerVoters(uint256[] calldata identityCommitments)
        external
        inPhase(Phase.Registration)
    {
        if (msg.sender != registrar) revert NotRegistrar();
        semaphore.addMembers(groupId, identityCommitments);
        registeredCount += identityCommitments.length;
        emit VotersRegistered(identityCommitments.length, registeredCount);
    }

    // ---------- Phase control (one-way) ----------

    /// @notice Closes registration and opens voting for `duration` seconds.
    function startVoting(uint256 duration) external onlyAdmin inPhase(Phase.Registration) {
        if (registeredCount == 0) revert NoVoters();
        if (duration == 0) revert BadSetup();
        phase = Phase.Voting;
        votingEndsAt = block.timestamp + duration;
        emit VotingStarted(votingEndsAt);
    }

    /// @notice Anyone can finalise once the deadline has passed, so the admin
    /// cannot cut voting short or stall the results.
    function endElection() external inPhase(Phase.Voting) {
        if (block.timestamp <= votingEndsAt) revert VotingStillOpen();
        phase = Phase.Ended;
        emit ElectionEnded();
    }

    // ---------- Voting ----------

    /// @param candidate index of the chosen candidate
    /// @param proof Semaphore proof with message == candidate and scope == groupId
    function vote(uint256 candidate, ISemaphore.SemaphoreProof calldata proof)
        external
        inPhase(Phase.Voting)
    {
        if (block.timestamp > votingEndsAt) revert VotingClosed();
        if (candidate >= _candidates.length) revert InvalidCandidate();
        // Fixing the scope means each member has exactly one nullifier.
        if (proof.scope != groupId) revert InvalidScope();
        // Binds the candidate to the proof so it cannot be altered in transit.
        if (proof.message != candidate) revert InvalidCandidate();

        // Reverts on an invalid proof or a reused nullifier (double vote).
        semaphore.validateProof(groupId, proof);

        _tally[candidate]++;
        totalVotes++;
        emit VoteCast(candidate, proof.nullifier);
    }

    // ---------- Views ----------

    function candidates() external view returns (string[] memory) {
        return _candidates;
    }

    function candidateCount() external view returns (uint256) {
        return _candidates.length;
    }

    /// @notice Final results; only available after the election has ended.
    /// @dev Contract storage is readable by anyone on a public chain, so this
    /// gate hides interim results from honest clients only. Use a private or
    /// permissioned chain, or an encrypted tally, if interim secrecy matters.
    function results() external view inPhase(Phase.Ended) returns (uint256[] memory counts) {
        counts = new uint256[](_candidates.length);
        for (uint256 i = 0; i < counts.length; i++) counts[i] = _tally[i];
    }
}
