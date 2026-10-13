// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/TestPayrollToken.sol";

contract TestPayrollTokenTest is Test {
    TestPayrollToken token;
    address recipient = address(0xBEEF);

    function setUp() public { token = new TestPayrollToken(); }

    function testOwnerCanMintAndTransferDemoTokens() public {
        token.mint(address(this), 100 ether);
        assertEq(token.totalSupply(), 100 ether);
        assertTrue(token.transfer(recipient, 25 ether));
        assertEq(token.balanceOf(recipient), 25 ether);
        assertEq(token.balanceOf(address(this)), 75 ether);
    }

    function testNonOwnerCannotMint() public {
        vm.prank(recipient);
        vm.expectRevert(TestPayrollToken.Unauthorized.selector);
        token.mint(recipient, 1 ether);
    }

    function testInsufficientBalanceReverts() public {
        vm.expectRevert(TestPayrollToken.InsufficientBalance.selector);
        token.transfer(recipient, 1 ether);
    }
}
