// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/RecurringPayments.sol";

contract TestToken {
    mapping(address => uint256) public balanceOf;
    bool public fail;
    function mint(address who, uint256 amount) external { balanceOf[who] += amount; }
    function burn(address who, uint256 amount) external { balanceOf[who] -= amount; }
    function setFail(bool value) external { fail = value; }
    function transfer(address to, uint256 amount) external returns (bool) {
        if (fail || balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract RecurringPaymentsTest is Test {
    RecurringPayments payments;
    TestToken token;
    address executor = address(0xE1);
    address vendor = address(0xB0B);
    function setUp() public {
        payments = new RecurringPayments(executor);
        token = new TestToken();
        payments.setTokenPolicy(address(token), 1000, 2000, 0, 1 days);
        payments.setRecipientAllowed(vendor, true);
        token.mint(address(payments), 1000);
    }
    function createDue(uint128 amount) internal returns (uint256) {
        return payments.createSchedule(vendor, address(token), amount, amount, uint64(block.timestamp + 1), 30 days, 0);
    }
    function testOnlyAuthorizedEmployersCanCreateSchedules() public {
        address employer = address(0xE2);
        vm.prank(employer);
        vm.expectRevert(RecurringPayments.Unauthorized.selector);
        payments.createSchedule(vendor, address(token), 10, 10, uint64(block.timestamp + 1), 30 days, 0);
        assertEq(payments.nextScheduleId(), 1);
        assertEq(token.balanceOf(vendor), 0);

        payments.setEmployerAuthorized(employer, true);
        assertTrue(payments.authorizedEmployers(employer));
        vm.prank(employer);
        uint256 id = payments.createSchedule(vendor, address(token), 10, 10, uint64(block.timestamp + 1), 30 days, 0);
        (address scheduleOwner,,,,,,,,,) = payments.schedules(id);
        assertEq(scheduleOwner, employer);
    }

    function testOnlyOwnerCanAuthorizeEmployers() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(RecurringPayments.Unauthorized.selector);
        payments.setEmployerAuthorized(address(0xE2), true);
        assertFalse(payments.authorizedEmployers(address(0xE2)));
    }

    function testOnlyScheduleEmployerCanApproveItsInstallment() public {
        address employer = address(0xE2);
        payments.setEmployerAuthorized(employer, true);
        payments.setTokenPolicy(address(token), 1000, 2000, 20, 1 days);
        vm.prank(employer);
        uint256 id = payments.createSchedule(vendor, address(token), 25, 25, uint64(block.timestamp + 1), 30 days, 0);

        vm.expectRevert(RecurringPayments.Unauthorized.selector);
        payments.approvePayment(id);
        vm.prank(address(0xBAD));
        vm.expectRevert(RecurringPayments.Unauthorized.selector);
        payments.approvePayment(id);
        vm.prank(employer);
        payments.approvePayment(id);
        assertNotEq(payments.paymentApprovals(id, 0), bytes32(0));
    }

    function testExecuteDueAndAdvance() public {
        uint256 id = createDue(50);
        vm.warp(block.timestamp + 1);
        vm.prank(executor); payments.execute(id);
        assertEq(token.balanceOf(vendor), 50);
        (,,,,,,,, uint32 count, bool active) = payments.schedules(id);
        assertEq(count, 1); assertTrue(active);
    }
    function testRejectUnauthorizedExecutor() public {
        uint256 id = createDue(10);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(RecurringPayments.Unauthorized.selector); payments.execute(id);
    }
    function testRejectEarlyAndFailedTransferDoesNotConsume() public {
        uint256 id = createDue(10);
        vm.prank(executor); vm.expectRevert(RecurringPayments.NotDue.selector); payments.execute(id);
        vm.warp(block.timestamp + 1); token.setFail(true);
        vm.prank(executor); vm.expectRevert(RecurringPayments.TransferFailed.selector); payments.execute(id);
        (,,,,,,,, uint32 count,) = payments.schedules(id); assertEq(count, 0);
    }
    function testOwnerCanCancelAndThirdPartyCannot() public {
        uint256 id = createDue(10);
        vm.prank(address(0xBAD)); vm.expectRevert(RecurringPayments.Unauthorized.selector); payments.cancelSchedule(id);
        payments.cancelSchedule(id);
        vm.warp(block.timestamp + 1); vm.prank(executor);
        vm.expectRevert(RecurringPayments.Inactive.selector); payments.execute(id);
    }
    function testPauseBlocksExecution() public {
        uint256 id = createDue(10); payments.pause(); vm.warp(block.timestamp + 1); vm.prank(executor);
        vm.expectRevert(RecurringPayments.Inactive.selector); payments.execute(id);
    }

    function testInsufficientBalanceDoesNotConsumeInstallmentAndCanRetry() public {
        token.burn(address(payments), 1000);
        uint256 id = createDue(25);
        vm.warp(block.timestamp + 1);
        vm.prank(executor); vm.expectRevert(RecurringPayments.InsufficientTokenBalance.selector); payments.execute(id);
        (,,,,,,,, uint32 count,) = payments.schedules(id);
        assertEq(count, 0);
        token.mint(address(payments), 25);
        vm.prank(executor); payments.execute(id);
        assertEq(token.balanceOf(vendor), 25);
    }

    function testSecondExecutionForPeriodIsRejectedAsNotDue() public {
        uint256 id = createDue(25);
        vm.warp(block.timestamp + 1);
        vm.prank(executor); payments.execute(id);
        vm.prank(executor); vm.expectRevert(RecurringPayments.NotDue.selector); payments.execute(id);
        (,,,,,,,, uint32 count,) = payments.schedules(id);
        assertEq(count, 1);
    }

    function testOnlyOwnerCanChangeExecutor() public {
        vm.prank(address(0xBAD)); vm.expectRevert(RecurringPayments.Unauthorized.selector); payments.setExecutor(address(0xE2));
        payments.setExecutor(address(0xE2));
        uint256 id = createDue(1);
        vm.warp(block.timestamp + 1);
        vm.prank(executor); vm.expectRevert(RecurringPayments.Unauthorized.selector); payments.execute(id);
        vm.prank(address(0xE2)); payments.execute(id);
    }

    function testScheduleCannotBeCreatedWithInvalidLimitOrTiming() public {
        vm.expectRevert(RecurringPayments.InvalidSchedule.selector);
        payments.createSchedule(vendor, address(token), 2, 1, uint64(block.timestamp + 1), 30 days, 0);
        vm.expectRevert(RecurringPayments.InvalidSchedule.selector);
        payments.createSchedule(vendor, address(token), 1, 1, uint64(block.timestamp), 30 days, 0);
    }

    function testFalseReturningTokenLeavesInstallmentAvailable() public {
        uint256 id = createDue(10);
        vm.warp(block.timestamp + 1);
        token.setFail(true);
        vm.prank(executor); vm.expectRevert(RecurringPayments.TransferFailed.selector); payments.execute(id);
        (,,,,,,,, uint32 count,) = payments.schedules(id);
        assertEq(count, 0);
    }

    function testOnlyScheduleOwnerCanChangeTerms() public {
        uint256 id = createDue(10);
        payments.setRecipientAllowed(address(0xCAFE), true);
        vm.prank(address(0xBAD)); vm.expectRevert(RecurringPayments.Unauthorized.selector);
        payments.updateSchedule(id, address(0xCAFE), address(token), 20, 20, uint64(block.timestamp + 2), 60, 0);
        payments.updateSchedule(id, address(0xCAFE), address(token), 20, 25, uint64(block.timestamp + 2), 60, 0);
        (, address recipient, address selectedToken, uint128 amount, uint128 limit,,,,,) = payments.schedules(id);
        assertEq(recipient, vendor);
        assertEq(payments.pendingRecipients(id), address(0xCAFE));
        vm.warp(block.timestamp + 1 days);
        payments.activateRecipientChange(id);
        (, recipient,,,,,,,,) = payments.schedules(id);
        assertEq(recipient, address(0xCAFE));
        assertEq(selectedToken, address(token));
        assertEq(amount, 20);
        assertEq(limit, 25);
    }

    function testScheduleCannotBeChangedWithInvalidLimit() public {
        uint256 id = createDue(10);
        vm.expectRevert(RecurringPayments.InvalidSchedule.selector);
        payments.updateSchedule(id, vendor, address(token), 20, 19, uint64(block.timestamp + 2), 60, 0);
    }

    function testUnapprovedRecipientCannotBeScheduledOrPaid() public {
        vm.expectRevert(RecurringPayments.RecipientNotAllowed.selector);
        payments.createSchedule(address(0xBAD), address(token), 10, 10, uint64(block.timestamp + 1), 60, 0);
        uint256 id = createDue(10);
        payments.setRecipientAllowed(vendor, false);
        vm.warp(block.timestamp + 1);
        (uint16 flags, uint8 score, uint8 action,,,,) = payments.preflight(id);
        assertTrue(flags & payments.FLAG_RECIPIENT_NOT_ALLOWED() != 0);
        assertEq(score, 100);
        assertEq(action, 2);
        vm.prank(executor); vm.expectRevert(RecurringPayments.RecipientNotAllowed.selector); payments.execute(id);
        assertEq(token.balanceOf(vendor), 0);
    }

    function testUpdatedPolicyCapBlocksExistingSchedule() public {
        uint256 id = createDue(50);
        payments.setTokenPolicy(address(token), 20, 100, 0, 0);
        vm.warp(block.timestamp + 1);
        (uint16 flags, uint8 score, uint8 action,,,,) = payments.preflight(id);
        assertTrue(flags & payments.FLAG_PAYMENT_CAP() != 0);
        assertEq(score, 100);
        assertEq(action, 2);
        vm.prank(executor); vm.expectRevert(RecurringPayments.LimitExceeded.selector); payments.execute(id);
        assertEq(token.balanceOf(vendor), 0);
    }

    function testDailyLimitAppliesAcrossSchedules() public {
        payments.setTokenPolicy(address(token), 40, 60, 0, 0);
        uint256 first = createDue(40);
        payments.setRecipientAllowed(address(0xCAFE), true);
        uint256 second = payments.createSchedule(address(0xCAFE), address(token), 40, 40, uint64(block.timestamp + 1), 30 days, 0);
        vm.warp(block.timestamp + 1);
        vm.prank(executor); payments.execute(first);
        (uint16 flags, uint8 score, uint8 action,,,, uint256 spent) = payments.preflight(second);
        assertTrue(flags & payments.FLAG_DAILY_LIMIT() != 0);
        assertEq(score, 100);
        assertEq(action, 2);
        assertEq(spent, 40);
        vm.prank(executor); vm.expectRevert(RecurringPayments.DailyLimitExceeded.selector); payments.execute(second);
        assertEq(token.balanceOf(address(0xCAFE)), 0);
    }

    function testNearDailyLimitIsExplainedAsMediumRiskButStillAllowed() public {
        payments.setTokenPolicy(address(token), 60, 60, 0, 0);
        uint256 id = createDue(50);
        vm.warp(block.timestamp + 1);
        (uint16 flags, uint8 score, uint8 action,,,,) = payments.preflight(id);
        assertTrue(flags & payments.FLAG_NEAR_DAILY_LIMIT() != 0);
        assertEq(score, 45);
        assertEq(action, 0);
        vm.prank(executor); payments.execute(id);
        assertEq(token.balanceOf(vendor), 50);
    }

    function testHighRiskPaymentRequiresExactSingleUseEmployerApproval() public {
        payments.setTokenPolicy(address(token), 1000, 2000, 20, 0);
        uint256 id = createDue(25);
        vm.warp(block.timestamp + 1);
        (uint16 flags, uint8 score, uint8 action,,,,) = payments.preflight(id);
        assertTrue(flags & payments.FLAG_APPROVAL_REQUIRED() != 0);
        assertEq(score, 70);
        assertEq(action, 1);
        vm.prank(executor); vm.expectRevert(RecurringPayments.ApprovalRequired.selector); payments.execute(id);
        vm.prank(address(0xBAD)); vm.expectRevert(RecurringPayments.Unauthorized.selector); payments.approvePayment(id);
        payments.approvePayment(id);
        vm.prank(executor); payments.execute(id);
        assertEq(token.balanceOf(vendor), 25);
        vm.warp(block.timestamp + 30 days);
        (flags, score, action,,,,) = payments.preflight(id);
        assertTrue(flags & payments.FLAG_APPROVAL_REQUIRED() != 0);
        assertEq(score, 70);
        vm.prank(executor); vm.expectRevert(RecurringPayments.ApprovalRequired.selector); payments.execute(id);
        assertEq(token.balanceOf(vendor), 25);
    }

    function testChangedRecipientIsBlockedDuringCooldownThenCanExecute() public {
        address nextRecipient = address(0xCAFE);
        payments.setRecipientAllowed(nextRecipient, true);
        uint64 due = uint64(block.timestamp + 1);
        uint256 id = payments.createSchedule(vendor, address(token), 10, 10, due, 30 days, 0);
        payments.updateSchedule(id, nextRecipient, address(token), 10, 10, uint64(block.timestamp + 1), 30 days, 0);
        vm.warp(due);
        (uint16 flags,,,,,,) = payments.preflight(id);
        assertTrue(flags & payments.FLAG_RECIPIENT_CHANGE_PENDING() != 0);
        vm.prank(executor); vm.expectRevert(RecurringPayments.RecipientChangePending.selector); payments.execute(id);
        assertEq(token.balanceOf(vendor), 0);
        assertEq(token.balanceOf(nextRecipient), 0);
        vm.warp(block.timestamp + 1 days);
        payments.activateRecipientChange(id);
        vm.prank(executor); payments.execute(id);
        assertEq(token.balanceOf(vendor), 0);
        assertEq(token.balanceOf(nextRecipient), 10);
    }

    function testPreflightReportsInsufficientTokenBalanceAndExecutionDoesNotPay() public {
        token.burn(address(payments), 1000);
        uint256 id = createDue(10);
        vm.warp(block.timestamp + 1);
        (uint16 flags, uint8 score, uint8 action,,, uint256 balance,) = payments.preflight(id);
        assertTrue(flags & payments.FLAG_INSUFFICIENT_BALANCE() != 0);
        assertEq(score, 100);
        assertEq(action, 2);
        assertEq(balance, 0);
        vm.prank(executor); vm.expectRevert(RecurringPayments.InsufficientTokenBalance.selector); payments.execute(id);
        assertEq(token.balanceOf(vendor), 0);
    }
}
