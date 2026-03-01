// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/OnChainOrderBook.sol";

contract DeployOrderBook is Script {
    // Monad Testnet USDC
    address constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        OnChainOrderBook book = new OnChainOrderBook(USDC, "BTC/USD");
        console.log("OnChainOrderBook deployed at:", address(book));

        vm.stopBroadcast();
    }
}
