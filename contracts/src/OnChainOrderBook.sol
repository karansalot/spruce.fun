// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title OnChainOrderBook
/// @notice Fully on-chain CLOB with ERC-1155 position tokens on Monad.
///         Prices are in basis points (1–9999 where 10 000 = 1 USDC).
///         Both sides post collateral; on match both receive ERC-1155 tokens
///         equal to the matched quantity.
contract OnChainOrderBook is ERC1155 {
    using SafeERC20 for IERC20;

    // ──────── Constants ────────
    IERC20 public immutable usdc;
    string public symbol;
    uint256 public constant PRICE_PRECISION = 10_000;
    uint256 public constant USDC_UNIT = 1e6; // 6 decimals

    uint256 public constant LONG_TOKEN  = 1;
    uint256 public constant SHORT_TOKEN = 2;

    // ──────── Structs ────────
    struct Order {
        uint256 id;
        address trader;
        bool    isBuy;
        uint256 price;        // basis points
        uint256 quantity;     // shares
        uint256 filled;       // shares filled so far
        uint256 lockedUsdc;   // remaining USDC locked
        uint256 timestamp;
        bool    active;
    }

    struct Trade {
        uint256 buyOrderId;
        uint256 sellOrderId;
        address buyer;
        address seller;
        uint256 price;
        uint256 quantity;
        uint256 timestamp;
    }

    struct OrderView {
        uint256 id;
        address trader;
        bool    isBuy;
        uint256 price;
        uint256 remainingQty;
        uint256 timestamp;
    }

    // ──────── Storage ────────
    mapping(uint256 => Order) public orders;
    uint256 public nextOrderId = 1;

    uint256[] public activeBuyOrderIds;
    uint256[] public activeSellOrderIds;

    Trade[] public tradeHistory;

    mapping(address => uint256[]) public userOrderIds;

    // ──────── Events ────────
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed trader,
        bool    isBuy,
        uint256 price,
        uint256 quantity,
        uint256 timestamp
    );

    event OrderCancelled(
        uint256 indexed orderId,
        address indexed trader,
        uint256 refundAmount
    );

    event OrderMatched(
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        address buyer,
        address seller,
        uint256 price,
        uint256 quantity,
        uint256 timestamp
    );

    // ──────── Constructor ────────
    constructor(address _usdc, string memory _symbol) ERC1155("") {
        usdc   = IERC20(_usdc);
        symbol = _symbol;
    }

    // ──────── Collateral math ────────
    function collateral(bool isBuy, uint256 price, uint256 qty) public pure returns (uint256) {
        if (isBuy) {
            return (price * qty * USDC_UNIT) / PRICE_PRECISION;
        } else {
            return ((PRICE_PRECISION - price) * qty * USDC_UNIT) / PRICE_PRECISION;
        }
    }

    // ══════════════════════════════════════════════════════════
    //                     ORDER ENTRY
    // ══════════════════════════════════════════════════════════

    /// @notice Place a resting limit order. Automatically matches if possible.
    function placeLimitOrder(bool isBuy, uint256 price, uint256 qty) external returns (uint256) {
        require(price > 0 && price < PRICE_PRECISION, "price out of range");
        require(qty > 0, "qty must be > 0");

        uint256 col = collateral(isBuy, price, qty);
        require(col > 0, "collateral too small");
        usdc.safeTransferFrom(msg.sender, address(this), col);

        uint256 id = nextOrderId++;
        orders[id] = Order(id, msg.sender, isBuy, price, qty, 0, col, block.timestamp, true);
        userOrderIds[msg.sender].push(id);

        emit OrderPlaced(id, msg.sender, isBuy, price, qty, block.timestamp);

        _matchOrder(id);

        // Rest on the book if not fully filled
        if (orders[id].active) {
            if (isBuy) activeBuyOrderIds.push(id);
            else       activeSellOrderIds.push(id);
        }
        return id;
    }

    /// @notice IOC market order – matches immediately, unfilled part is refunded.
    function placeMarketOrder(bool isBuy, uint256 qty) external returns (uint256) {
        require(qty > 0, "qty must be > 0");

        uint256 worstPrice = isBuy ? PRICE_PRECISION - 1 : 1;
        uint256 col = collateral(isBuy, worstPrice, qty);
        usdc.safeTransferFrom(msg.sender, address(this), col);

        uint256 id = nextOrderId++;
        orders[id] = Order(id, msg.sender, isBuy, worstPrice, qty, 0, col, block.timestamp, true);
        userOrderIds[msg.sender].push(id);

        emit OrderPlaced(id, msg.sender, isBuy, worstPrice, qty, block.timestamp);

        _matchOrder(id);

        // Refund unfilled portion (IOC – doesn't rest)
        Order storage o = orders[id];
        if (o.filled < o.quantity) {
            uint256 unfilled  = o.quantity - o.filled;
            uint256 refundAmt = collateral(isBuy, worstPrice, unfilled);
            if (refundAmt > o.lockedUsdc) refundAmt = o.lockedUsdc;
            o.lockedUsdc -= refundAmt;
            o.active = false;
            if (refundAmt > 0) usdc.safeTransfer(msg.sender, refundAmt);
        }
        return id;
    }

    /// @notice Cancel a resting order and reclaim collateral.
    function cancelOrder(uint256 orderId) external {
        Order storage o = orders[orderId];
        require(o.active, "not active");
        require(o.trader == msg.sender, "not owner");

        o.active = false;

        uint256 unfilled = o.quantity - o.filled;
        uint256 refundAmt;
        if (unfilled > 0) {
            refundAmt = collateral(o.isBuy, o.price, unfilled);
            if (refundAmt > o.lockedUsdc) refundAmt = o.lockedUsdc;
            o.lockedUsdc -= refundAmt;
            if (refundAmt > 0) usdc.safeTransfer(msg.sender, refundAmt);
        }

        if (o.isBuy) _removeFromArr(activeBuyOrderIds, orderId);
        else         _removeFromArr(activeSellOrderIds, orderId);

        emit OrderCancelled(orderId, msg.sender, refundAmt);
    }

    // ══════════════════════════════════════════════════════════
    //                     MATCHING ENGINE
    // ══════════════════════════════════════════════════════════

    function _matchOrder(uint256 id) internal {
        if (orders[id].isBuy) _matchBuy(id);
        else                  _matchSell(id);
    }

    function _matchBuy(uint256 buyId) internal {
        Order storage buy = orders[buyId];

        while (buy.active && buy.filled < buy.quantity && activeSellOrderIds.length > 0) {
            (uint256 idx, uint256 sellId) = _bestSell(buy.price);
            if (sellId == 0) break;

            Order storage sell = orders[sellId];
            uint256 matchQty = _min(buy.quantity - buy.filled, sell.quantity - sell.filled);
            _execute(buyId, sellId, sell.price, matchQty);

            if (sell.filled >= sell.quantity) {
                sell.active = false;
                _removeByIdx(activeSellOrderIds, idx);
            }
        }
        if (buy.filled >= buy.quantity) buy.active = false;
    }

    function _matchSell(uint256 sellId) internal {
        Order storage sell = orders[sellId];

        while (sell.active && sell.filled < sell.quantity && activeBuyOrderIds.length > 0) {
            (uint256 idx, uint256 buyId) = _bestBuy(sell.price);
            if (buyId == 0) break;

            Order storage buy = orders[buyId];
            uint256 matchQty = _min(sell.quantity - sell.filled, buy.quantity - buy.filled);
            _execute(buyId, sellId, buy.price, matchQty);

            if (buy.filled >= buy.quantity) {
                buy.active = false;
                _removeByIdx(activeBuyOrderIds, idx);
            }
        }
        if (sell.filled >= sell.quantity) sell.active = false;
    }

    function _execute(uint256 buyId, uint256 sellId, uint256 execPrice, uint256 matchQty) internal {
        Order storage buy  = orders[buyId];
        Order storage sell = orders[sellId];

        buy.filled  += matchQty;
        sell.filled += matchQty;

        // Buyer reserved at their limit price; match happens at execPrice
        uint256 buyReserved  = (buy.price * matchQty * USDC_UNIT) / PRICE_PRECISION;
        uint256 buyActual    = (execPrice * matchQty * USDC_UNIT) / PRICE_PRECISION;
        uint256 buyRefund    = buyReserved - buyActual;

        uint256 sellReserved = ((PRICE_PRECISION - sell.price) * matchQty * USDC_UNIT) / PRICE_PRECISION;
        uint256 sellActual   = ((PRICE_PRECISION - execPrice) * matchQty * USDC_UNIT) / PRICE_PRECISION;
        uint256 sellRefund   = sellReserved - sellActual;

        buy.lockedUsdc  -= buyReserved;
        sell.lockedUsdc -= sellReserved;

        if (buyRefund  > 0) usdc.safeTransfer(buy.trader,  buyRefund);
        if (sellRefund > 0) usdc.safeTransfer(sell.trader, sellRefund);

        // Mint position tokens
        _mint(buy.trader,  LONG_TOKEN,  matchQty, "");
        _mint(sell.trader, SHORT_TOKEN, matchQty, "");

        tradeHistory.push(Trade(buyId, sellId, buy.trader, sell.trader, execPrice, matchQty, block.timestamp));

        emit OrderMatched(buyId, sellId, buy.trader, sell.trader, execPrice, matchQty, block.timestamp);
    }

    // ──────── Best-price finders (O(n) – fine for testnet) ────────

    function _bestSell(uint256 maxPrice) internal view returns (uint256 idx, uint256 id) {
        uint256 best = type(uint256).max;
        uint256 bestTs = type(uint256).max;
        for (uint256 i; i < activeSellOrderIds.length; i++) {
            Order storage o = orders[activeSellOrderIds[i]];
            if (o.active && o.filled < o.quantity && o.price <= maxPrice) {
                if (o.price < best || (o.price == best && o.timestamp < bestTs)) {
                    best   = o.price;
                    bestTs = o.timestamp;
                    idx    = i;
                    id     = activeSellOrderIds[i];
                }
            }
        }
    }

    function _bestBuy(uint256 minPrice) internal view returns (uint256 idx, uint256 id) {
        uint256 best;
        uint256 bestTs = type(uint256).max;
        for (uint256 i; i < activeBuyOrderIds.length; i++) {
            Order storage o = orders[activeBuyOrderIds[i]];
            if (o.active && o.filled < o.quantity && o.price >= minPrice) {
                if (o.price > best || (o.price == best && o.timestamp < bestTs)) {
                    best   = o.price;
                    bestTs = o.timestamp;
                    idx    = i;
                    id     = activeBuyOrderIds[i];
                }
            }
        }
    }

    // ──────── Array helpers ────────

    function _removeFromArr(uint256[] storage arr, uint256 val) internal {
        for (uint256 i; i < arr.length; i++) {
            if (arr[i] == val) { _removeByIdx(arr, i); return; }
        }
    }

    function _removeByIdx(uint256[] storage arr, uint256 i) internal {
        arr[i] = arr[arr.length - 1];
        arr.pop();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    // ══════════════════════════════════════════════════════════
    //                     VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════

    function getActiveBuyOrders() external view returns (OrderView[] memory out) {
        uint256 n;
        for (uint256 i; i < activeBuyOrderIds.length; i++) {
            if (orders[activeBuyOrderIds[i]].active) n++;
        }
        out = new OrderView[](n);
        uint256 j;
        for (uint256 i; i < activeBuyOrderIds.length; i++) {
            Order storage o = orders[activeBuyOrderIds[i]];
            if (o.active) {
                out[j++] = OrderView(o.id, o.trader, true, o.price, o.quantity - o.filled, o.timestamp);
            }
        }
    }

    function getActiveSellOrders() external view returns (OrderView[] memory out) {
        uint256 n;
        for (uint256 i; i < activeSellOrderIds.length; i++) {
            if (orders[activeSellOrderIds[i]].active) n++;
        }
        out = new OrderView[](n);
        uint256 j;
        for (uint256 i; i < activeSellOrderIds.length; i++) {
            Order storage o = orders[activeSellOrderIds[i]];
            if (o.active) {
                out[j++] = OrderView(o.id, o.trader, false, o.price, o.quantity - o.filled, o.timestamp);
            }
        }
    }

    function getTradeCount() external view returns (uint256) {
        return tradeHistory.length;
    }

    function getRecentTrades(uint256 count) external view returns (Trade[] memory out) {
        uint256 total = tradeHistory.length;
        uint256 start = total > count ? total - count : 0;
        uint256 len   = total - start;
        out = new Trade[](len);
        for (uint256 i; i < len; i++) {
            out[i] = tradeHistory[start + i];
        }
    }

    function getUserOrders(address user) external view returns (Order[] memory out) {
        uint256[] storage ids = userOrderIds[user];
        out = new Order[](ids.length);
        for (uint256 i; i < ids.length; i++) {
            out[i] = orders[ids[i]];
        }
    }

    function getUserActiveOrders(address user) external view returns (OrderView[] memory out) {
        uint256[] storage ids = userOrderIds[user];
        uint256 n;
        for (uint256 i; i < ids.length; i++) {
            if (orders[ids[i]].active) n++;
        }
        out = new OrderView[](n);
        uint256 j;
        for (uint256 i; i < ids.length; i++) {
            Order storage o = orders[ids[i]];
            if (o.active) {
                out[j++] = OrderView(o.id, o.trader, o.isBuy, o.price, o.quantity - o.filled, o.timestamp);
            }
        }
    }
}
