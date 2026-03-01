/**
 * Mutable server state shared across services.
 * Orderbook, candles, market metadata, Polymarket WS, and client connections.
 */
let polymarketWs = null;
let currentAssetIds = [];
let currentOutcomes = [];
/** Superbowl multi-outcome only: { seattle: [yesTokenId, noTokenId], ... } */
let clobTokenIdsByOutcome = null;
let currentMarketMetadata = { title: "", image: "", slug: "" };
let currentHour = null;
let orderBookState = {};
let candleState = {};
const candleSaveQueue = new Map();
const clients = new Set();
let isShuttingDown = false;

export function getPolymarketWs() {
  return polymarketWs;
}
export function setPolymarketWs(ws) {
  polymarketWs = ws;
}

export function getCurrentAssetIds() {
  return currentAssetIds;
}
export function setCurrentAssetIds(ids) {
  currentAssetIds = ids;
}

export function getCurrentOutcomes() {
  return currentOutcomes;
}
export function setCurrentOutcomes(outcomes) {
  currentOutcomes = outcomes;
}

export function getClobTokenIdsByOutcome() {
  return clobTokenIdsByOutcome;
}
export function setClobTokenIdsByOutcome(val) {
  clobTokenIdsByOutcome = val;
}

export function getCurrentMarketMetadata() {
  return currentMarketMetadata;
}
export function setCurrentMarketMetadata(meta) {
  currentMarketMetadata = meta;
}

export function getCurrentHour() {
  return currentHour;
}
export function setCurrentHour(h) {
  currentHour = h;
}

export function getOrderBookState() {
  return orderBookState;
}
export function setOrderBookState(state) {
  orderBookState = state;
}

export function getCandleState() {
  return candleState;
}
export function setCandleState(state) {
  candleState = state;
}

export function getCandleSaveQueue() {
  return candleSaveQueue;
}

export function getClients() {
  return clients;
}

export function getIsShuttingDown() {
  return isShuttingDown;
}
export function setIsShuttingDown(val) {
  isShuttingDown = val;
}
