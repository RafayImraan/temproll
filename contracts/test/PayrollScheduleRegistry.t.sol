// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/PayrollScheduleRegistry.sol";

contract PayrollScheduleRegistryTest is Test {
    PayrollScheduleRegistry registry;
    address employee = address(0xBEEF);
    bytes32 scheduleId = keccak256("demo-payroll-schedule");

    function setUp() public {
        registry = new PayrollScheduleRegistry();
    }

    function testEmployerCreatesAndReadsBackSchedule() public {
        uint64 due = uint64(block.timestamp + 1 days);
        vm.expectEmit(true, true, true, true);
        emit PayrollScheduleRegistry.PayrollScheduleCreated(scheduleId, address(this), employee, 30 days, due);
        registry.createSchedule(scheduleId, employee, 30 days, due);

        (address employer, address recordedEmployee, uint64 interval, uint64 firstDue, bool exists) = registry.getSchedule(scheduleId);
        assertEq(employer, address(this));
        assertEq(recordedEmployee, employee);
        assertEq(interval, 30 days);
        assertEq(firstDue, due);
        assertTrue(exists);
    }

    function testDuplicateScheduleIdRejected() public {
        registry.createSchedule(scheduleId, employee, 30 days, uint64(block.timestamp + 1 days));
        vm.expectRevert(PayrollScheduleRegistry.DuplicateSchedule.selector);
        registry.createSchedule(scheduleId, employee, 30 days, uint64(block.timestamp + 2 days));
    }

    function testOnlyDeployerEmployerCanCreate() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(PayrollScheduleRegistry.UnauthorizedEmployer.selector);
        registry.createSchedule(scheduleId, employee, 30 days, uint64(block.timestamp + 1 days));
    }

    function testRejectInvalidScheduleFields() public {
        vm.expectRevert(PayrollScheduleRegistry.InvalidSchedule.selector);
        registry.createSchedule(bytes32(0), employee, 30 days, uint64(block.timestamp + 1 days));
        vm.expectRevert(PayrollScheduleRegistry.InvalidSchedule.selector);
        registry.createSchedule(scheduleId, address(0), 30 days, uint64(block.timestamp + 1 days));
        vm.expectRevert(PayrollScheduleRegistry.InvalidSchedule.selector);
        registry.createSchedule(scheduleId, employee, 0, uint64(block.timestamp + 1 days));
        vm.expectRevert(PayrollScheduleRegistry.InvalidSchedule.selector);
        registry.createSchedule(scheduleId, employee, 30 days, uint64(block.timestamp));
    }
}
