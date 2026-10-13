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
    uint256 public constant MAX_MINT_PER_ADDRESS = 100_000 ether;
    address public immutable owner;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public mintedBy;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);

    constructor() { owner = msg.sender; }

    function mint(address to, uint256 amount) external {
        if (to == address(0)) revert InvalidAddress();
        if (mintedBy[to] + amount > MAX_MINT_PER_ADDRESS) revert Unauthorized();
        mintedBy[to] += amount;
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount || to == address(0) || balanceOf[from] < amount) revert InsufficientBalance();
        allowance[from][msg.sender] = approved - amount;
        unchecked { balanceOf[from] -= amount; }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
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
