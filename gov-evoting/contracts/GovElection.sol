// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Government e-voting ledger with trustee-verified results
/// @notice Stores encrypted ballots and enforces the election rules. It never
/// sees a plaintext vote or a voter identity.
///
/// Roles (all different addresses, enforced in the constructor):
///  - admin:     opens the election and fixes the window and voter cap.
///               Cannot read, add, change or remove ballots.
///  - submitter: the backend. Only it can submit ballots, after it has
///               verified the voter and issued a single-use voting token.
///  - trustees:  hold shares of the decryption key. After the election closes
///               they decrypt and count off-chain, then each submits the tally
///               they computed. Results become final only when `threshold`
///               trustees submit the identical tally.
contract GovElection {
    enum Phase { Setup, Voting, Closed, Finalized }

    uint256 public constant MAX_BALLOT_BYTES = 1024;

    address public immutable admin;
    address public immutable submitter;
    uint256 public immutable threshold;
    /// @dev keccak256 of the election public key so voters can check that they
    /// are encrypting to the key whose shares the trustees hold.
    bytes32 public immutable electionKeyHash;

    string public title;
    string[] private _candidates;
    address[] private _trustees;
    mapping(address => bool) public isTrustee;

    Phase public phase;
    uint256 public eligibleVoters;
    uint256 public startTime;
    uint256 public endTime;

    bytes[] private _ballots;
    mapping(bytes32 => bool) public tokenUsed;

    mapping(address => bytes32) private _submittedTallyHash;
    mapping(bytes32 => uint256) public tallyAgreement;
    uint256[] private _finalTally;

    event ElectionOpened(uint256 eligibleVoters, uint256 startTime, uint256 endTime);
    event BallotCast(uint256 indexed index, bytes32 indexed tokenHash);
    event ElectionClosed(uint256 ballotCount);
    event TallySubmitted(address indexed trustee, bytes32 tallyHash);
    event ResultsFinalized(uint256[] tally);

    error NotAdmin();
    error NotSubmitter();
    error NotTrustee();
    error WrongPhase(Phase expected, Phase actual);
    error BadSetup();
    error OutsideVotingWindow();
    error VotingNotOver();
    error InvalidToken();
    error TokenAlreadyUsed();
    error InvalidBallot();
    error BallotCapReached();
    error BadTally();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier inPhase(Phase p) {
        if (phase != p) revert WrongPhase(p, phase);
        _;
    }

    constructor(
        address _submitter,
        string memory _title,
        string[] memory candidateNames,
        address[] memory trusteeList,
        uint256 _threshold,
        bytes32 _electionKeyHash
    ) {
        if (candidateNames.length < 2 || candidateNames.length > 50) revert BadSetup();
        if (_threshold < 2 || _threshold > trusteeList.length || trusteeList.length > 20) revert BadSetup();
        if (_submitter == address(0) || _submitter == msg.sender || _electionKeyHash == bytes32(0)) revert BadSetup();

        admin = msg.sender;
        submitter = _submitter;
        threshold = _threshold;
        electionKeyHash = _electionKeyHash;
        title = _title;

        for (uint256 i = 0; i < candidateNames.length; i++) {
            _candidates.push(candidateNames[i]);
        }
        for (uint256 i = 0; i < trusteeList.length; i++) {
            address t = trusteeList[i];
            // Separation of duties: nobody holds two roles, and no duplicates.
            if (t == address(0) || t == msg.sender || t == _submitter || isTrustee[t]) revert BadSetup();
            isTrustee[t] = true;
            _trustees.push(t);
        }
    }

    // ---------- Admin ----------

    /// @param eligible number of people on the electoral roll for this election.
    /// It is public, and the contract never accepts more ballots than this.
    function openElection(uint256 eligible, uint256 start, uint256 end)
        external
        onlyAdmin
        inPhase(Phase.Setup)
    {
        if (eligible == 0 || start < block.timestamp || end <= start) revert BadSetup();
        eligibleVoters = eligible;
        startTime = start;
        endTime = end;
        phase = Phase.Voting;
        emit ElectionOpened(eligible, start, end);
    }

    /// @notice Anyone can close the election once the window is over, so the
    /// admin can neither cut voting short nor stall the count.
    function closeElection() external inPhase(Phase.Voting) {
        if (block.timestamp <= endTime) revert VotingNotOver();
        phase = Phase.Closed;
        emit ElectionClosed(_ballots.length);
    }

    // ---------- Submitter ----------

    /// @param tokenHash keccak256 of the single-use voting token.
    /// @param ballot    the encrypted ballot (opaque bytes).
    function castBallot(bytes32 tokenHash, bytes calldata ballot)
        external
        inPhase(Phase.Voting)
    {
        if (msg.sender != submitter) revert NotSubmitter();
        if (block.timestamp < startTime || block.timestamp > endTime) revert OutsideVotingWindow();
        if (tokenHash == bytes32(0)) revert InvalidToken();
        if (tokenUsed[tokenHash]) revert TokenAlreadyUsed();
        if (ballot.length == 0 || ballot.length > MAX_BALLOT_BYTES) revert InvalidBallot();
        if (_ballots.length >= eligibleVoters) revert BallotCapReached();

        tokenUsed[tokenHash] = true;
        _ballots.push(ballot);
        emit BallotCast(_ballots.length - 1, tokenHash);
    }

    // ---------- Trustees ----------

    /// @notice Each trustee submits the tally they computed after decrypting.
    /// Results are final once `threshold` trustees submit identical counts.
    /// A trustee may correct their submission until then.
    function submitTally(uint256[] calldata counts) external inPhase(Phase.Closed) {
        if (!isTrustee[msg.sender]) revert NotTrustee();
        if (counts.length != _candidates.length) revert BadTally();

        uint256 sum;
        for (uint256 i = 0; i < counts.length; i++) sum += counts[i];
        // Ballots that fail to decrypt are not counted, so the sum may be lower.
        if (sum > _ballots.length) revert BadTally();

        bytes32 h = keccak256(abi.encode(counts));
        bytes32 previous = _submittedTallyHash[msg.sender];
        if (previous != bytes32(0)) tallyAgreement[previous]--;
        _submittedTallyHash[msg.sender] = h;
        tallyAgreement[h]++;
        emit TallySubmitted(msg.sender, h);

        if (tallyAgreement[h] >= threshold) {
            _finalTally = counts;
            phase = Phase.Finalized;
            emit ResultsFinalized(counts);
        }
    }

    // ---------- Views ----------

    function candidates() external view returns (string[] memory) {
        return _candidates;
    }

    function trustees() external view returns (address[] memory) {
        return _trustees;
    }

    function ballotCount() external view returns (uint256) {
        return _ballots.length;
    }

    function getBallot(uint256 index) external view returns (bytes memory) {
        return _ballots[index];
    }

    /// @notice Only available after `threshold` trustees agreed on the tally.
    function results() external view inPhase(Phase.Finalized) returns (uint256[] memory) {
        return _finalTally;
    }
}
