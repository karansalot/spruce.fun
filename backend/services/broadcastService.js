import { WebSocket } from "ws";
import { getClients } from "./state.js";

/**
 * Broadcasts message to all connected clients
 */
export function broadcast(message) {
  const clients = getClients();
  const data = JSON.stringify(message);
  let sentCount = 0;

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
      sentCount++;
    }
  });

  // Only log if DEBUG mode is enabled
  if (process.env.DEBUG_BROADCAST === 'true') {
    if (message.type === "orderbook_update") {
      console.log(`📤 Broadcast: ${message.outcome.toUpperCase()} update to ${sentCount} clients`);
    } else if (message.type === "candle_update") {
      console.log(`🕯️ Broadcast: ${message.outcome.toUpperCase()} ${message.timeframe} candle to ${sentCount} clients`);
    }
  }
}
