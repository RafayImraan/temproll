// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ITIP20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Executor-triggered recurring payment contract with employer-set Guardian policies.
/// @dev Policies are enforced in execute(); risk summaries from preflight() are advisory UI data.
///      All schedules, recipients, token amounts, limits, timing, and transfers are public.
contract RecurringPayments {
    error Unauthorized();
    error InvalidSchedule();
    error NotDue();
    error Expired();
    error Inactive();
    error LimitExceeded();
    error DailyLimitExceeded();
    error RecipientNotAllowed();
    error RecipientChangePending();
    error RecipientCooldown();
    error ApprovalRequired();
    error AlreadyExecuted();
    error InsufficientTokenBalance();
    error TransferFailed();
    error ReentrantCall();

    uint16 public constant FLAG_INACTIVE = 1;
    uint16 public constant FLAG_NOT_DUE = 2;
    uint16 public constant FLAG_EXPIRED = 4;
    uint16 public constant FLAG_RECIPIENT_NOT_ALLOWED = 8;
    uint16 public constant FLAG_RECIPIENT_CHANGE_PENDING = 16;
    uint16 public constant FLAG_PAYMENT_CAP = 32;
    uint16 public constant FLAG_DAILY_LIMIT = 64;
    uint16 public constant FLAG_INSUFFICIENT_BALANCE = 128;
    uint16 public constant FLAG_APPROVAL_REQUIRED = 256;
    uint16 public constant FLAG_NEAR_DAILY_LIMIT = 512;

    struct Schedule {
        address owner;
        address recipient;
        address token;
        uint128 amount;
        uint128 maxPerPayment;
        uint64 interval;
        uint64 nextDue;
        uint64 endAt;
        uint32 executions;
        bool active;
    }

    struct TokenPolicy {
        uint128 maxPerPayment;
        uint128 dailyLimit;
        uint128 approvalThreshold;
        uint64 recipientChangeCooldown;
        bool configured;
    }

    address public owner;
    address public executor;
    bool public paused;
    uint256 public nextScheduleId = 1;
    uint256 private lockState = 1;
    mapping(address => bool) public authorizedEmployers;
    mapping(uint256 => Schedule) public schedules;
    mapping(uint256 => mapping(uint32 => bool)) public executed;
    mapping(uint256 => address) public pendingRecipients;
    mapping(uint256 => uint64) public recipientChangeAt;
    mapping(address => bool) public approvedRecipients;
    mapping(address => TokenPolicy) public tokenPolicies;
    mapping(address => mapping(uint64 => uint256)) public dailySpent;
    mapping(uint256 => mapping(uint32 => bytes32)) public paymentApprovals;

    event ExecutorUpdated(address indexed executor);
    event EmployerAuthorizationUpdated(address indexed employer, bool authorized);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event RecipientApprovalUpdated(address indexed recipient, bool allowed);
    event TokenPolicyUpdated(address indexed token, uint128 maxPerPayment, uint128 dailyLimit, uint128 approvalThreshold, uint64 recipientChangeCooldown);
    event ScheduleCreated(uint256 indexed id, address indexed owner, address indexed recipient, address token, uint256 amount, uint64 nextDue, uint64 interval);
    event ScheduleCancelled(uint256 indexed id, address indexed by);
    event ScheduleUpdated(uint256 indexed id, address indexed recipient, address indexed token, uint256 amount, uint64 nextDue, uint64 interval, uint64 endAt);
    event RecipientChangeStarted(uint256 indexed id, address indexed oldRecipient, address indexed newRecipient, uint64 activatesAt);
    event RecipientChanged(uint256 indexed id, address indexed previousRecipient, address indexed newRecipient);
    event PaymentApproved(uint256 indexed id, uint32 indexed installment, address recipient, uint256 amount, uint64 dueAt);
    event PaymentExecuted(uint256 indexed id, uint32 indexed execution, address indexed recipient, address token, uint256 amount, uint64 nextDue);

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier onlyExecutor() { if (msg.sender != executor) revert Unauthorized(); _; }
    modifier onlyAuthorizedEmployer() { if (!authorizedEmployers[msg.sender]) revert Unauthorized(); _; }
    modifier nonReentrant() { if (lockState != 1) revert ReentrantCall(); lockState = 2; _; lockState = 1; }

    constructor(address initialExecutor) {
        if (initialExecutor == address(0)) revert InvalidSchedule();
        owner = msg.sender;
        executor = initialExecutor;
        authorizedEmployers[msg.sender] = true;
    }

    function setEmployerAuthorized(address employer, bool authorized) external onlyOwner {
        if (employer == address(0)) revert InvalidSchedule();
        authorizedEmployers[employer] = authorized;
        emit EmployerAuthorizationUpdated(employer, authorized);
    }

    function setExecutor(address next) external onlyOwner {
        if (next == address(0)) revert InvalidSchedule();
        executor = next;
        emit ExecutorUpdated(next);
    }

    function setTokenPolicy(address token, uint128 maxPerPayment, uint128 dailyLimit, uint128 approvalThreshold, uint64 recipientChangeCooldown) external onlyOwner {
        if (token == address(0) || maxPerPayment == 0 || dailyLimit < maxPerPayment || approvalThreshold > maxPerPayment) revert InvalidSchedule();
        tokenPolicies[token] = TokenPolicy(maxPerPayment, dailyLimit, approvalThreshold, recipientChangeCooldown, true);
        emit TokenPolicyUpdated(token, maxPerPayment, dailyLimit, approvalThreshold, recipientChangeCooldown);
    }

    function setRecipientAllowed(address recipient, bool allowed) external onlyOwner {
        if (recipient == address(0)) revert InvalidSchedule();
        approvedRecipients[recipient] = allowed;
        emit RecipientApprovalUpdated(recipient, allowed);
    }

    function pause() external onlyOwner { paused = true; emit Paused(msg.sender); }
    function unpause() external onlyOwner { paused = false; emit Unpaused(msg.sender); }

    function createSchedule(address recipient, address token, uint128 amount, uint128 maxPerPayment, uint64 firstDue, uint64 interval, uint64 endAt) external onlyAuthorizedEmployer returns (uint256 id) {
        TokenPolicy memory policy = tokenPolicies[token];
        if (recipient == address(0) || token == address(0) || amount == 0 || maxPerPayment < amount || interval == 0 || firstDue <= block.timestamp || (endAt != 0 && endAt < firstDue) || !policy.configured) revert InvalidSchedule();
        if (!approvedRecipients[recipient]) revert RecipientNotAllowed();
        if (amount > policy.maxPerPayment || maxPerPayment > policy.maxPerPayment) revert LimitExceeded();
        id = nextScheduleId++;
        schedules[id] = Schedule(msg.sender, recipient, token, amount, maxPerPayment, interval, firstDue, endAt, 0, true);
        emit ScheduleCreated(id, msg.sender, recipient, token, amount, firstDue, interval);
    }

    function cancelSchedule(uint256 id) external {
        Schedule storage s = schedules[id];
        if (s.owner != msg.sender && msg.sender != owner) revert Unauthorized();
        if (!s.active) revert Inactive();
        s.active = false;
        emit ScheduleCancelled(id, msg.sender);
    }

    function updateSchedule(uint256 id, address recipient, address token, uint128 amount, uint128 maxPerPayment, uint64 nextDue, uint64 interval, uint64 endAt) external {
        Schedule storage s = schedules[id];
        if (s.owner != msg.sender) revert Unauthorized();
        if (!s.active) revert Inactive();
        TokenPolicy memory policy = tokenPolicies[token];
        if (recipient == address(0) || token == address(0) || amount == 0 || maxPerPayment < amount || nextDue <= block.timestamp || interval == 0 || (endAt != 0 && endAt < nextDue) || !policy.configured) revert InvalidSchedule();
        if (!approvedRecipients[recipient]) revert RecipientNotAllowed();
        if (amount > policy.maxPerPayment || maxPerPayment > policy.maxPerPayment) revert LimitExceeded();
        if (recipient != s.recipient) {
            if (pendingRecipients[id] != address(0)) revert RecipientChangePending();
            pendingRecipients[id] = recipient;
            recipientChangeAt[id] = uint64(block.timestamp) + policy.recipientChangeCooldown;
            emit RecipientChangeStarted(id, s.recipient, recipient, recipientChangeAt[id]);
        }
        s.token = token;
        s.amount = amount;
        s.maxPerPayment = maxPerPayment;
        s.nextDue = nextDue;
        s.interval = interval;
        s.endAt = endAt;
        delete paymentApprovals[id][s.executions];
        emit ScheduleUpdated(id, recipient, token, amount, nextDue, interval, endAt);
    }

    function activateRecipientChange(uint256 id) external {
        Schedule storage s = schedules[id];
        if (s.owner != msg.sender) revert Unauthorized();
        if (!s.active) revert Inactive();
        address pendingRecipient = pendingRecipients[id];
        if (pendingRecipient == address(0)) revert InvalidSchedule();
        if (block.timestamp < recipientChangeAt[id]) revert RecipientCooldown();
        if (!approvedRecipients[pendingRecipient]) revert RecipientNotAllowed();
        address previous = s.recipient;
        s.recipient = pendingRecipient;
        delete pendingRecipients[id];
        delete recipientChangeAt[id];
        emit RecipientChanged(id, previous, s.recipient);
    }

    /// @notice Employer approval commits to the current exact recipient, amount, due time and installment.
    function approvePayment(uint256 id) external {
        Schedule storage s = schedules[id];
        if (s.owner != msg.sender) revert Unauthorized();
        if (!s.active) revert Inactive();
        if (pendingRecipients[id] != address(0)) revert RecipientChangePending();
        TokenPolicy memory policy = tokenPolicies[s.token];
        if (!policy.configured || policy.approvalThreshold == 0 || s.amount < policy.approvalThreshold) revert InvalidSchedule();
        bytes32 terms = _approvalTerms(id, s);
        paymentApprovals[id][s.executions] = terms;
        emit PaymentApproved(id, s.executions, s.recipient, s.amount, s.nextDue);
    }

    /// @notice Transparent deterministic policy result. `flags` bit values are public constants above.
    /// @dev A frontend score is advisory; execute() always calls the same policy evaluator before transfer.
    function preflight(uint256 id) external view returns (uint16 flags, uint8 riskScore, uint8 action, uint32 installment, uint64 dueAt, uint256 tokenBalance, uint256 spentToday) {
        Schedule storage s = schedules[id];
        installment = s.executions;
        dueAt = s.nextDue;
        if (s.owner == address(0) || !s.active || paused) flags |= FLAG_INACTIVE;
        if (block.timestamp < s.nextDue) flags |= FLAG_NOT_DUE;
        if (s.endAt != 0 && s.nextDue > s.endAt) flags |= FLAG_EXPIRED;
        if (!approvedRecipients[s.recipient]) flags |= FLAG_RECIPIENT_NOT_ALLOWED;
        if (pendingRecipients[id] != address(0)) flags |= FLAG_RECIPIENT_CHANGE_PENDING;
        TokenPolicy memory policy = tokenPolicies[s.token];
        if (!policy.configured || s.amount > s.maxPerPayment || s.amount > policy.maxPerPayment) flags |= FLAG_PAYMENT_CAP;
        uint64 day = uint64(block.timestamp / 1 days);
        spentToday = dailySpent[s.token][day];
        if (!policy.configured || spentToday + s.amount > policy.dailyLimit) flags |= FLAG_DAILY_LIMIT;
        else if (spentToday + s.amount >= (uint256(policy.dailyLimit) * 75) / 100) flags |= FLAG_NEAR_DAILY_LIMIT;
        if (s.token != address(0)) {
            try ITIP20(s.token).balanceOf(address(this)) returns (uint256 balance) {
                tokenBalance = balance;
                if (balance < s.amount) flags |= FLAG_INSUFFICIENT_BALANCE;
            } catch { flags |= FLAG_INSUFFICIENT_BALANCE; }
        } else {
            flags |= FLAG_INSUFFICIENT_BALANCE;
        }
        if (policy.configured && policy.approvalThreshold != 0 && s.amount >= policy.approvalThreshold && paymentApprovals[id][s.executions] != _approvalTerms(id, s)) flags |= FLAG_APPROVAL_REQUIRED;
        bool blocking = flags & (FLAG_INACTIVE | FLAG_NOT_DUE | FLAG_EXPIRED | FLAG_RECIPIENT_NOT_ALLOWED | FLAG_RECIPIENT_CHANGE_PENDING | FLAG_PAYMENT_CAP | FLAG_DAILY_LIMIT | FLAG_INSUFFICIENT_BALANCE) != 0;
        if (blocking) return (flags, 100, 2, installment, dueAt, tokenBalance, spentToday);
        if (flags & FLAG_APPROVAL_REQUIRED != 0) return (flags, 70, 1, installment, dueAt, tokenBalance, spentToday);
        if (flags & FLAG_NEAR_DAILY_LIMIT != 0) return (flags, 45, 0, installment, dueAt, tokenBalance, spentToday);
        return (flags, 10, 0, installment, dueAt, tokenBalance, spentToday);
    }

    /// @notice Execute exactly the currently due installment after enforcing all configured policies.
    function execute(uint256 id) external onlyExecutor nonReentrant {
        (uint16 flags,,,) = _preflightFlags(id);
        if (flags & FLAG_INACTIVE != 0) revert Inactive();
        if (flags & FLAG_NOT_DUE != 0) revert NotDue();
        if (flags & FLAG_EXPIRED != 0) revert Expired();
        if (flags & FLAG_RECIPIENT_NOT_ALLOWED != 0) revert RecipientNotAllowed();
        if (flags & FLAG_RECIPIENT_CHANGE_PENDING != 0) revert RecipientChangePending();
        if (flags & FLAG_PAYMENT_CAP != 0) revert LimitExceeded();
        if (flags & FLAG_DAILY_LIMIT != 0) revert DailyLimitExceeded();
        if (flags & FLAG_INSUFFICIENT_BALANCE != 0) revert InsufficientTokenBalance();
        if (flags & FLAG_APPROVAL_REQUIRED != 0) revert ApprovalRequired();

        Schedule storage s = schedules[id];
        uint64 dueAt = s.nextDue;
        uint32 installment = s.executions;
        address recipient = s.recipient;
        address token = s.token;
        uint128 amount = s.amount;
        uint64 day = uint64(block.timestamp / 1 days);
        executed[id][installment] = true;
        delete paymentApprovals[id][installment];
        dailySpent[token][day] += amount;
        (bool ok, bytes memory data) = token.call(abi.encodeCall(ITIP20.transfer, (recipient, amount)));
        if (!ok || (data.length != 0 && (data.length < 32 || !abi.decode(data, (bool))))) revert TransferFailed();
        unchecked { s.executions = installment + 1; }
        s.nextDue = dueAt + s.interval;
        if (s.endAt != 0 && s.nextDue > s.endAt) s.active = false;
        emit PaymentExecuted(id, installment, recipient, token, amount, s.nextDue);
    }

    function _preflightFlags(uint256 id) internal view returns (uint16 flags, uint8 riskScore, uint8 action, uint32 installment) {
        (flags, riskScore, action, installment,,,) = this.preflight(id);
    }

    function _approvalTerms(uint256 id, Schedule storage s) internal view returns (bytes32) {
        return keccak256(abi.encode(id, s.executions, s.recipient, s.token, s.amount, s.nextDue));
    }
}
