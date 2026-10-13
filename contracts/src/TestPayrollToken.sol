// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Sepolia-only demo token with no monetary value. The deployer can mint test units.
contract TestPayrollToken {
    error Unauthorized();
    error InvalidAddress();
    error InsufficientBalance();

    string public constant name = "Temproll Test Payroll Token";
    string public constant symbol = "TROLL";
    uint8 public constant decimals = 18;
    address public immutable owner;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor() { owner = msg.sender; }

    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert Unauthorized();
        if (to == address(0)) revert InvalidAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == address(0)) revert InvalidAddress();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        unchecked { balanceOf[msg.sender] -= amount; }
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}
