const WebSocket = require('ws');
const { getMarketId } = require('./fetchPolymarketMarket');

// Try to load dotenv if available (optional)
try {
    require('dotenv').config();
} catch (e) {
    // dotenv not installed, using process.env directly
}

const MARKET_CHANNEL = "market";

class WebSocketOrderBook {
    constructor(channelType, url, data, auth, messageCallback, verbose) {
        this.channelType = channelType;
        this.url = url;
        this.data = data;
        this.auth = auth;
        this.messageCallback = messageCallback;
        this.verbose = verbose;
        
        const furl = `${url}/ws/${channelType}`;
        this.ws = new WebSocket(furl);
        
        this.ws.on('open', () => this.onOpen());
        this.ws.on('message', (message) => this.onMessage(message));
        this.ws.on('error', (error) => this.onError(error));
        this.ws.on('close', (code, reason) => this.onClose(code, reason));
        
        this.orderbooks = {};
        this.reconnectOnClose = true;
    }

    updateSubscription(newData) {
        return new Promise((resolve, reject) => {
            // Check if data actually changed (compare as strings to handle array comparison)
            const oldDataStr = JSON.stringify([...this.data].sort());
            const newDataStr = JSON.stringify([...newData].sort());
            
            if (oldDataStr === newDataStr) {
                console.log(`\nℹ️  Token IDs unchanged, skipping update`);
                resolve(newData);
                return;
            }
            
            // Clear old orderbook data when switching to new tokens
            this.orderbooks = {};
            
            if (this.ws.readyState === WebSocket.OPEN) {
                console.log(`\n🔄 Updating subscription with new token IDs...`);
                
                // Store old data for comparison
                const oldData = [...this.data];
                this.data = newData;
                
                if (this.channelType === MARKET_CHANNEL) {
                    console.log(`📡 Old asset IDs:`, oldData);
                    console.log(`📡 New asset IDs (${newData.length}):`);
                    newData.forEach((assetId, idx) => {
                        console.log(`  ${idx + 1}. ${assetId}`);
                    });
                    
                    // Send new subscription message - this will replace the old subscription
                    const subscriptionMessage = {
                        assets_ids: newData,
                        type: MARKET_CHANNEL
                    };
                    
                    console.log(`📤 Sending subscription update...`);
                    this.ws.send(JSON.stringify(subscriptionMessage));
                    
                    // Wait a moment to ensure message was sent
                    setTimeout(() => {
                        console.log(`✅ Subscription update sent successfully`);
                        console.log(`📊 Listening for updates on new token IDs...\n`);
                        resolve(newData);
                    }, 500);
                } else {
                    reject(new Error('Invalid channel type'));
                }
            } else if (this.ws.readyState === WebSocket.CONNECTING) {
                // Wait for connection to open, then update
                console.log('⏳ WebSocket connecting, waiting to update subscription...');
                this.data = newData;
                
                const checkConnection = setInterval(() => {
                    if (this.ws.readyState === WebSocket.OPEN) {
                        clearInterval(checkConnection);
                        this.updateSubscription(newData).then(resolve).catch(reject);
                    } else if (this.ws.readyState === WebSocket.CLOSED) {
                        clearInterval(checkConnection);
                        this.reconnect();
                        setTimeout(() => {
                            this.updateSubscription(newData).then(resolve).catch(reject);
                        }, 2000);
                    }
                }, 100);
            } else {
                // WebSocket is closed, update data and reconnect
                console.log('⚠️  WebSocket not open, reconnecting with new token IDs...');
                this.data = newData;
                
                // Reconnect - onOpen will use the updated this.data
                this.reconnect();
                
                // Wait for connection to open, then resolve
                const checkOpen = setInterval(() => {
                    if (this.ws.readyState === WebSocket.OPEN) {
                        clearInterval(checkOpen);
                        console.log('✅ Reconnected with new token IDs');
                        resolve(newData);
                    } else if (this.ws.readyState === WebSocket.CLOSED && !this.reconnectOnClose) {
                        clearInterval(checkOpen);
                        reject(new Error('Failed to reconnect'));
                    }
                }, 100);
            }
        });
    }

    reconnect() {
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
        }
        
        const furl = `${this.url}/ws/${this.channelType}`;
        this.ws = new WebSocket(furl);
        
        this.ws.on('open', () => this.onOpen());
        this.ws.on('message', (message) => this.onMessage(message));
        this.ws.on('error', (error) => this.onError(error));
        this.ws.on('close', (code, reason) => {
            if (this.reconnectOnClose) {
                console.log('🔄 Attempting to reconnect...');
                setTimeout(() => this.reconnect(), 5000);
            } else {
                this.onClose(code, reason);
            }
        });
    }

    onMessage(message) {
        const messageStr = message.toString();
        
        // Handle PONG responses
        if (messageStr === 'PONG') {
            if (this.verbose) {
                console.log('✓ PONG received');
            }
            return;
        }
        
        try {
            const data = JSON.parse(messageStr);
            this.formatMessage(data);
        } catch (error) {
            // If not JSON, log as-is
            console.log(`[${new Date().toISOString()}] Raw message:`, messageStr);
        }
    }

    formatMessage(data) {
        const timestamp = new Date().toISOString();
        const separator = '='.repeat(80);
        
        console.log(`\n${separator}`);
        console.log(`[${timestamp}] WebSocket Message`);
        console.log(separator);
        
        // Get all keys from the data object to ensure nothing is skipped
        const allKeys = Object.keys(data);
        const displayedKeys = new Set();
        
        // Helper function to format nested objects/arrays
        const formatValue = (key, value, indent = 2) => {
            const indentStr = ' '.repeat(indent);
            
            if (value === null) {
                return `${indentStr}${key}: null`;
            } else if (value === undefined) {
                return `${indentStr}${key}: undefined`;
            } else if (Array.isArray(value)) {
                if (value.length === 0) {
                    return `${indentStr}${key}: []`;
                }
                let output = `${indentStr}${key} [${value.length} items]:\n`;
                value.forEach((item, idx) => {
                    if (typeof item === 'object' && item !== null) {
                        output += `${indentStr}  [${idx}]:\n`;
                        output += formatObject(item, indent + 4);
                    } else {
                        output += `${indentStr}  [${idx}]: ${item}\n`;
                    }
                });
                return output;
            } else if (typeof value === 'object') {
                return `${indentStr}${key}:\n${formatObject(value, indent + 2)}`;
            } else {
                return `${indentStr}${key}: ${value}`;
            }
        };
        
        const formatObject = (obj, indent = 2) => {
            const indentStr = ' '.repeat(indent);
            let output = '';
            Object.keys(obj).forEach(key => {
                const value = obj[key];
                output += formatValue(key, value, indent) + '\n';
            });
            return output;
        };
        
        // Display type and event first if present
        if (data.type !== undefined) {
            console.log(`Type: ${data.type}`);
            displayedKeys.add('type');
        }
        
        if (data.event !== undefined) {
            console.log(`Event: ${data.event}`);
            displayedKeys.add('event');
        }
        
        // Display asset_id with subscription status
        if (data.asset_id !== undefined) {
            const isSubscribed = this.data && this.data.includes(data.asset_id);
            const status = isSubscribed ? '✅' : '⚠️';
            console.log(`${status} Asset ID: ${data.asset_id} ${isSubscribed ? '(subscribed)' : '(not in current subscription)'}`);
            displayedKeys.add('asset_id');
        }
        
        // Display bids - ALL bids, not truncated
        if (data.bids !== undefined) {
            if (Array.isArray(data.bids)) {
                console.log(`\n📊 Bids (${data.bids.length} total):`);
                if (data.bids.length === 0) {
                    console.log(`  (empty)`);
                } else {
                    data.bids.forEach((bid, idx) => {
                        if (typeof bid === 'object' && bid !== null) {
                            // Handle object format {price, size, ...}
                            const price = bid.price !== undefined ? bid.price : (Array.isArray(bid) ? bid[0] : 'N/A');
                            const size = bid.size !== undefined ? bid.size : (Array.isArray(bid) ? bid[1] : 'N/A');
                            const otherProps = Object.keys(bid).filter(k => !['price', 'size'].includes(k));
                            if (otherProps.length > 0) {
                                const other = otherProps.map(k => `${k}=${bid[k]}`).join(', ');
                                console.log(`  ${idx + 1}. Price: ${price}, Size: ${size}, ${other}`);
                            } else {
                                console.log(`  ${idx + 1}. Price: ${price}, Size: ${size}`);
                            }
                        } else if (Array.isArray(bid)) {
                            // Handle array format [price, size, ...]
                            console.log(`  ${idx + 1}. Price: ${bid[0]}, Size: ${bid[1]}${bid.length > 2 ? `, Extra: [${bid.slice(2).join(', ')}]` : ''}`);
                        } else {
                            console.log(`  ${idx + 1}. ${bid}`);
                        }
                    });
                }
            } else {
                console.log(`\n📊 Bids: ${data.bids}`);
            }
            displayedKeys.add('bids');
        }
        
        // Display asks - ALL asks, not truncated
        if (data.asks !== undefined) {
            if (Array.isArray(data.asks)) {
                console.log(`\n📊 Asks (${data.asks.length} total):`);
                if (data.asks.length === 0) {
                    console.log(`  (empty)`);
                } else {
                    data.asks.forEach((ask, idx) => {
                        if (typeof ask === 'object' && ask !== null) {
                            // Handle object format {price, size, ...}
                            const price = ask.price !== undefined ? ask.price : (Array.isArray(ask) ? ask[0] : 'N/A');
                            const size = ask.size !== undefined ? ask.size : (Array.isArray(ask) ? ask[1] : 'N/A');
                            const otherProps = Object.keys(ask).filter(k => !['price', 'size'].includes(k));
                            if (otherProps.length > 0) {
                                const other = otherProps.map(k => `${k}=${ask[k]}`).join(', ');
                                console.log(`  ${idx + 1}. Price: ${price}, Size: ${size}, ${other}`);
                            } else {
                                console.log(`  ${idx + 1}. Price: ${price}, Size: ${size}`);
                            }
                        } else if (Array.isArray(ask)) {
                            // Handle array format [price, size, ...]
                            console.log(`  ${idx + 1}. Price: ${ask[0]}, Size: ${ask[1]}${ask.length > 2 ? `, Extra: [${ask.slice(2).join(', ')}]` : ''}`);
                        } else {
                            console.log(`  ${idx + 1}. ${ask}`);
                        }
                    });
                }
            } else {
                console.log(`\n📊 Asks: ${data.asks}`);
            }
            displayedKeys.add('asks');
        }
        
        // Display trades - ALL trades with full details
        if (data.trades !== undefined) {
            if (Array.isArray(data.trades)) {
                console.log(`\n💱 Trades (${data.trades.length} total):`);
                if (data.trades.length === 0) {
                    console.log(`  (empty)`);
                } else {
                    data.trades.forEach((trade, idx) => {
                        if (typeof trade === 'object' && trade !== null) {
                            const price = trade.price !== undefined ? trade.price : (Array.isArray(trade) ? trade[0] : 'N/A');
                            const size = trade.size !== undefined ? trade.size : (Array.isArray(trade) ? trade[1] : 'N/A');
                            const side = trade.side !== undefined ? trade.side : 'N/A';
                            const otherProps = Object.keys(trade).filter(k => !['price', 'size', 'side'].includes(k));
                            if (otherProps.length > 0) {
                                const other = otherProps.map(k => `${k}=${trade[k]}`).join(', ');
                                console.log(`  ${idx + 1}. Price: ${price}, Size: ${size}, Side: ${side}, ${other}`);
                            } else {
                                console.log(`  ${idx + 1}. Price: ${price}, Size: ${size}, Side: ${side}`);
                            }
                        } else if (Array.isArray(trade)) {
                            console.log(`  ${idx + 1}. Price: ${trade[0]}, Size: ${trade[1]}${trade.length > 2 ? `, Side: ${trade[2]}${trade.length > 3 ? `, Extra: [${trade.slice(3).join(', ')}]` : ''}` : ''}`);
                        } else {
                            console.log(`  ${idx + 1}. ${trade}`);
                        }
                    });
                }
            } else {
                console.log(`\n💱 Trades: ${data.trades}`);
            }
            displayedKeys.add('trades');
        }
        
        // Display ALL remaining fields - nothing skipped
        const remainingKeys = allKeys.filter(key => !displayedKeys.has(key));
        if (remainingKeys.length > 0) {
            console.log(`\n📋 Additional Fields (${remainingKeys.length}):`);
            remainingKeys.forEach(key => {
                const value = data[key];
                if (value === null) {
                    console.log(`  ${key}: null`);
                } else if (value === undefined) {
                    console.log(`  ${key}: undefined`);
                } else if (Array.isArray(value)) {
                    if (value.length === 0) {
                        console.log(`  ${key}: []`);
                    } else {
                        console.log(`  ${key} [${value.length} items]:`);
                        value.forEach((item, idx) => {
                            if (typeof item === 'object' && item !== null) {
                                console.log(`    [${idx}]:`);
                                console.log(formatObject(item, 6));
                            } else {
                                console.log(`    [${idx}]: ${item}`);
                            }
                        });
                    }
                } else if (typeof value === 'object') {
                    console.log(`  ${key}:`);
                    console.log(formatObject(value, 4));
                } else {
                    console.log(`  ${key}: ${value}`);
                }
            });
        }
        
        // Always show full JSON for complete reference
        console.log(`\n📄 Complete JSON (all fields):`);
        console.log(JSON.stringify(data, null, 2));
        
        // Verify no fields were skipped
        const totalFields = allKeys.length;
        const displayedFields = displayedKeys.size + remainingKeys.length;
        if (totalFields !== displayedFields) {
            console.log(`\n⚠️  Field count mismatch: Total=${totalFields}, Displayed=${displayedFields}`);
        }
        
        console.log(separator);
    }

    onError(error) {
        const timestamp = new Date().toISOString();
        console.error(`\n${'='.repeat(80)}`);
        console.error(`[${timestamp}] ❌ WebSocket Error`);
        console.error(`${'='.repeat(80)}`);
        console.error('Error details:', error);
        console.error(`${'='.repeat(80)}\n`);
        process.exit(1);
    }

    onClose(code, reason) {
        const timestamp = new Date().toISOString();
        console.log(`\n${'='.repeat(80)}`);
        console.log(`[${timestamp}] 🔌 WebSocket Closed`);
        console.log(`Code: ${code}`);
        if (reason) {
            console.log(`Reason: ${reason.toString()}`);
        }
        console.log(`${'='.repeat(80)}\n`);
        
        if (!this.reconnectOnClose) {
            process.exit(0);
        }
    }

    onOpen() {
        const timestamp = new Date().toISOString();
        console.log(`\n${'='.repeat(80)}`);
        console.log(`[${timestamp}] ✅ WebSocket Connected`);
        console.log(`Channel: ${this.channelType.toUpperCase()}`);
        console.log(`${'='.repeat(80)}\n`);
        
        if (this.channelType === MARKET_CHANNEL) {
            console.log(`📡 Subscribing to ${this.data.length} asset(s):`);
            this.data.forEach((assetId, idx) => {
                console.log(`  ${idx + 1}. ${assetId}`);
            });
            console.log('');
            
            this.ws.send(JSON.stringify({
                assets_ids: this.data,
                type: MARKET_CHANNEL
            }));
        } else {
            console.error('❌ Invalid channel configuration');
            process.exit(1);
        }

        this.startPing();
    }

    startPing() {
        setInterval(() => {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send("PING");
            }
        }, 10000);
    }

    close() {
        this.reconnectOnClose = false;
        if (this.ws) {
            this.ws.close();
        }
    }
}

/**
 * Gets the current hour in ET timezone
 * @returns {number} Current hour (0-23)
 */
function getCurrentETHour() {
    const etDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    return etDate.getHours();
}

/**
 * Fetches new market data and updates WebSocket subscriptions
 * @param {WebSocketOrderBook} marketConnection - Market channel connection
 * @returns {Promise<Array>} New asset IDs
 */
async function updateMarketData(marketConnection) {
    try {
        console.log('\n⏰ Hour changed! Fetching new market data...');
        const marketData = await getMarketId();
        
        if (marketData.clobTokenIds) {
            const newAssetIds = JSON.parse(marketData.clobTokenIds);
            console.log(`✅ Fetched new asset IDs:`, newAssetIds);
            
            // Update the market connection with new asset IDs and wait for confirmation
            await marketConnection.updateSubscription(newAssetIds);
            
            console.log(`\n✅ Successfully updated WebSocket subscription to new token IDs`);
            console.log(`📊 Now receiving updates for:`, newAssetIds);
            
            return newAssetIds;
        } else {
            throw new Error('clobTokenIds not found in market data');
        }
    } catch (error) {
        console.error('❌ Error updating market data:', error.message);
        throw error;
    }
}

// Main execution function
async function main() {
    try {
        // Fetch market data and extract asset IDs
        console.log('Fetching market data from Polymarket API...');
        const marketData = await getMarketId();
        
        // Parse clobTokenIds string to get array of asset IDs
        let assetIds = [];
        if (marketData.clobTokenIds) {
            try {
                assetIds = JSON.parse(marketData.clobTokenIds);
                console.log(`Fetched ${assetIds.length} asset IDs:`, assetIds);
            } catch (error) {
                console.error('Failed to parse clobTokenIds:', error);
                throw new Error('Invalid clobTokenIds format');
            }
        } else {
            throw new Error('clobTokenIds not found in market data');
        }

        // Load API credentials from environment variables
        const url = process.env.POLYMARKET_WS_URL || "wss://ws-subscriptions-clob.polymarket.com";

        // Create WebSocket connection with dynamically fetched asset IDs
        console.log('Connecting to Polymarket WebSocket...');
        const marketConnection = new WebSocketOrderBook(
            MARKET_CHANNEL, url, assetIds, null, null, true
        );

        // Monitor for hour changes and update market data
        let currentHour = getCurrentETHour();
        console.log(`\n🕐 Current ET hour: ${currentHour}:00`);
        console.log('⏰ Monitoring for hour changes...\n');

        // Check every minute for hour changes
        const hourCheckInterval = setInterval(async () => {
            const newHour = getCurrentETHour();
            
            if (newHour !== currentHour) {
                console.log(`\n${'='.repeat(80)}`);
                console.log(`🔄 Hour changed from ${currentHour}:00 to ${newHour}:00 ET`);
                console.log(`${'='.repeat(80)}`);
                
                const previousHour = currentHour;
                currentHour = newHour;
                
                try {
                    // Fetch and update with new token IDs
                    const newAssetIds = await updateMarketData(marketConnection);
                    
                    // Verify the update was successful
                    if (newAssetIds && newAssetIds.length > 0) {
                        console.log(`\n✅ Successfully transitioned from ${previousHour}:00 to ${newHour}:00 ET market`);
                        console.log(`📊 Active token IDs:`, newAssetIds);
                    } else {
                        throw new Error('No asset IDs received');
                    }
                } catch (error) {
                    console.error(`\n❌ Failed to update market data for hour ${newHour}:00:`, error.message);
                    console.log(`🔄 Will retry in 30 seconds...`);
                    
                    // Retry after 30 seconds
                    setTimeout(async () => {
                        try {
                            console.log(`\n🔄 Retrying market data update...`);
                            const retryAssetIds = await updateMarketData(marketConnection);
                            if (retryAssetIds && retryAssetIds.length > 0) {
                                console.log(`✅ Retry successful! Active token IDs:`, retryAssetIds);
                            }
                        } catch (retryError) {
                            console.error(`❌ Retry failed:`, retryError.message);
                            console.error(`⚠️  WebSocket may still be subscribed to old token IDs`);
                        }
                    }, 30000);
                }
            }
        }, 60000); // Check every minute

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n\n🛑 Shutting down gracefully...');
            clearInterval(hourCheckInterval);
            marketConnection.close();
            setTimeout(() => process.exit(0), 1000);
        });

        process.on('SIGTERM', () => {
            console.log('\n\n🛑 Shutting down gracefully...');
            clearInterval(hourCheckInterval);
            marketConnection.close();
            setTimeout(() => process.exit(0), 1000);
        });

    } catch (error) {
        console.error('Error initializing Polymarket connection:', error);
        process.exit(1);
    }
}

// Run main function
main();