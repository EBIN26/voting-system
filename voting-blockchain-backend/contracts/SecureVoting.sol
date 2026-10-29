// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SecureVoting {
    address public admin;

    uint256 public totalVotes;
    uint256 public startTime;
    uint256 public endTime;

    enum ElectionState {
        NotStarted,
        Active,
        Ended
    }

    ElectionState public electionState;

    string[] private encryptedVotes;

    mapping(bytes32 => bool) public hasVoted;

    event ElectionStarted(
        uint256 startTime,
        uint256 endTime
    );

    event ElectionEnded();

    event VoteCast(
        uint256 indexed voteIndex,
        bytes32 indexed voterHash,
        address indexed relayer
    );

    modifier onlyAdmin() {
        require(
            msg.sender == admin,
            "Only admin can perform this action."
        );
        _;
    }

    modifier electionActive() {
        require(
            electionState == ElectionState.Active,
            "Election is not active."
        );

        require(
            block.timestamp >= startTime,
            "Election has not started yet."
        );

        require(
            block.timestamp <= endTime,
            "Election has ended."
        );

        _;
    }

    constructor(
        uint256 _startTime,
        uint256 _endTime
    ) {
        require(
            _startTime < _endTime,
            "Start time must be before end time."
        );

        admin = msg.sender;

        startTime = _startTime;
        endTime = _endTime;

        electionState = ElectionState.NotStarted;
    }

    /**
     * @dev Activates the election once the scheduled start time
     * has been reached.
     */
    function startElection()
        external
        onlyAdmin
    {
        require(
            electionState == ElectionState.NotStarted,
            "Election has already started or ended."
        );

        require(
            block.timestamp >= startTime,
            "Election has not started yet."
        );

        require(
            block.timestamp <= endTime,
            "Election has already ended."
        );

        electionState = ElectionState.Active;

        emit ElectionStarted(
            startTime,
            endTime
        );
    }

    /**
     * @dev Manually ends the election.
     */
    function endElection()
        external
        onlyAdmin
    {
        require(
            electionState == ElectionState.Active,
            "Election is not active."
        );

        electionState = ElectionState.Ended;

        emit ElectionEnded();
    }

    /**
     * @dev Cast an encrypted vote.
     *
     * Voting is allowed only when:
     * 1. The election is Active
     * 2. Current blockchain time >= startTime
     * 3. Current blockchain time <= endTime
     * 4. The voter has not already voted
     */
    function castVote(
        string calldata encryptedPayload,
        bytes32 voterHash
    )
        external
        electionActive
    {
        require(
            !hasVoted[voterHash],
            "Voter has already voted."
        );

        hasVoted[voterHash] = true;

        encryptedVotes.push(
            encryptedPayload
        );

        totalVotes++;

        emit VoteCast(
            totalVotes - 1,
            voterHash,
            msg.sender
        );
    }

    /**
     * @dev Returns an encrypted vote.
     */
    function getVote(
        uint256 index
    )
        external
        view
        returns (string memory)
    {
        require(
            index < encryptedVotes.length,
            "Invalid vote index."
        );

        return encryptedVotes[index];
    }

    /**
     * @dev Returns total number of votes.
     */
    function getTotalVotes()
        external
        view
        returns (uint256)
    {
        return totalVotes;
    }
}