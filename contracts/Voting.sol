// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Commit-reveal e-voting
/// @notice The election authority registers eligible voters, then voters commit a
/// hashed ballot, then reveal it. Tallies are only counted on reveal, so partial
/// results cannot influence voters while voting is open.
contract Voting {
    enum Phase { Registration, Commit, Reveal, Ended }

    struct Voter {
        bool registered;
        bool committed;
        bool revealed;
        bytes32 commitment;
    }

    address public immutable admin;
    string public title;
    string[] private _candidates;
    Phase public phase;

    mapping(address => Voter) public voters;
    mapping(uint256 => uint256) public tally;
    uint256 public registeredCount;
    uint256 public committedCount;
    uint256 public revealedCount;

    event VoterRegistered(address indexed voter);
    event PhaseChanged(Phase phase);
    event VoteCommitted(address indexed voter, bytes32 commitment);
    event VoteRevealed(address indexed voter, uint256 candidate);

    error NotAdmin();
    error WrongPhase(Phase expected, Phase actual);
    error NotRegistered();
    error AlreadyRegistered();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error InvalidCandidate();
    error InvalidReveal();
    error BadSetup();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier inPhase(Phase p) {
        if (phase != p) revert WrongPhase(p, phase);
        _;
    }

    constructor(string memory _title, string[] memory candidateNames) {
        if (candidateNames.length < 2 || candidateNames.length > 50) revert BadSetup();
        admin = msg.sender;
        title = _title;
        for (uint256 i = 0; i < candidateNames.length; i++) {
            _candidates.push(candidateNames[i]);
        }
    }

    // ---------- Registration ----------

    function registerVoters(address[] calldata list) external onlyAdmin inPhase(Phase.Registration) {
        for (uint256 i = 0; i < list.length; i++) {
            address v = list[i];
            if (voters[v].registered) revert AlreadyRegistered();
            voters[v].registered = true;
            registeredCount++;
            emit VoterRegistered(v);
        }
    }

    // ---------- Phase control (one-way) ----------

    function startCommit() external onlyAdmin inPhase(Phase.Registration) {
        phase = Phase.Commit;
        emit PhaseChanged(phase);
    }

    function startReveal() external onlyAdmin inPhase(Phase.Commit) {
        phase = Phase.Reveal;
        emit PhaseChanged(phase);
    }

    function endElection() external onlyAdmin inPhase(Phase.Reveal) {
        phase = Phase.Ended;
        emit PhaseChanged(phase);
    }

    // ---------- Voting ----------

    /// @notice commitment = keccak256(abi.encodePacked(candidate, salt, voter, address(this)))
    function commitVote(bytes32 commitment) external inPhase(Phase.Commit) {
        Voter storage v = voters[msg.sender];
        if (!v.registered) revert NotRegistered();
        if (v.committed) revert AlreadyCommitted();
        v.committed = true;
        v.commitment = commitment;
        committedCount++;
        emit VoteCommitted(msg.sender, commitment);
    }

    function revealVote(uint256 candidate, bytes32 salt) external inPhase(Phase.Reveal) {
        Voter storage v = voters[msg.sender];
        if (!v.committed) revert NotCommitted();
        if (v.revealed) revert AlreadyRevealed();
        if (candidate >= _candidates.length) revert InvalidCandidate();
        if (computeCommitment(candidate, salt, msg.sender) != v.commitment) revert InvalidReveal();
        v.revealed = true;
        tally[candidate]++;
        revealedCount++;
        emit VoteRevealed(msg.sender, candidate);
    }

    // ---------- Views ----------

    function computeCommitment(uint256 candidate, bytes32 salt, address voter) public view returns (bytes32) {
        return keccak256(abi.encodePacked(candidate, salt, voter, address(this)));
    }

    function candidateCount() external view returns (uint256) {
        return _candidates.length;
    }

    function candidates() external view returns (string[] memory) {
        return _candidates;
    }

    /// @notice Final results; only available once the election has ended.
    function results() external view inPhase(Phase.Ended) returns (uint256[] memory counts) {
        counts = new uint256[](_candidates.length);
        for (uint256 i = 0; i < counts.length; i++) counts[i] = tally[i];
    }
}
