// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal registry for a public payroll cadence, not a payment executor.
/// @dev The deploying wallet is the authorized employer. Employee address, employer,
///      cadence and due time are public. Salary amounts are intentionally not stored.
contract PayrollScheduleRegistry {
    error UnauthorizedEmployer();
    error InvalidSchedule();
    error DuplicateSchedule();

    struct Schedule {
        address employer;
        address employee;
        uint64 intervalSeconds;
        uint64 firstDue;
        bool exists;
    }

    address public immutable employer;
    mapping(bytes32 scheduleId => Schedule schedule) private schedules;

    event PayrollScheduleCreated(
        bytes32 indexed scheduleId,
        address indexed employer,
        address indexed employee,
        uint64 intervalSeconds,
        uint64 firstDue
    );

    constructor() {
        employer = msg.sender;
    }

    function createSchedule(bytes32 scheduleId, address employee, uint64 intervalSeconds, uint64 firstDue) external {
        if (msg.sender != employer) revert UnauthorizedEmployer();
        if (scheduleId == bytes32(0) || employee == address(0) || intervalSeconds == 0 || firstDue <= block.timestamp) revert InvalidSchedule();
        if (schedules[scheduleId].exists) revert DuplicateSchedule();

        schedules[scheduleId] = Schedule(msg.sender, employee, intervalSeconds, firstDue, true);
        emit PayrollScheduleCreated(scheduleId, msg.sender, employee, intervalSeconds, firstDue);
    }

    function getSchedule(bytes32 scheduleId) external view returns (address scheduleEmployer, address employee, uint64 intervalSeconds, uint64 firstDue, bool exists) {
        Schedule memory schedule = schedules[scheduleId];
        return (schedule.employer, schedule.employee, schedule.intervalSeconds, schedule.firstDue, schedule.exists);
    }
}
