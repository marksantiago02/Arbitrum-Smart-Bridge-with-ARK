import { ethers } from 'ethers';
import { Log, EventLog } from 'ethers';
import dotenv from 'dotenv';
import { saveEventToQueue } from './db';
import { ArbitrumEventData } from './types';
const CONTRACT_ABI = require('./contract_abi/presale.json');

// Initialize environment variables
dotenv.config();

// Arbitrum RPC URLs
const ARBITRUM_RPC_URL = process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
const ARBITRUM_WS_URL = process.env.ARBITRUM_SEPOLIA_WSS_URL || 'wss://sepolia-rollup.arbitrum.io/ws';

// Smart contract details
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS_SEPOLIA!;

// Set up HTTP provider with options
const httpProvider = new ethers.JsonRpcProvider(ARBITRUM_RPC_URL, undefined, {
  polling: true,
  pollingInterval: 4000,
  staticNetwork: true,
  batchStallTime: 50,
});

// Set up WebSocket provider
let wsProvider: ethers.WebSocketProvider | null = null;
let wsReconnectInterval: NodeJS.Timeout | null = null;

try {
  wsProvider = new ethers.WebSocketProvider(ARBITRUM_WS_URL);
} catch (error) {
  console.warn('Failed to initialize WebSocket provider:', error);
  console.warn('Falling back to HTTP polling only');
}

// Initialize contracts
const httpContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, httpProvider);
let wsContract: ethers.Contract | null = null;
if (wsProvider) {
  wsContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wsProvider);
}

// Set of processed event IDs to avoid duplicates
const processedEvents = new Set<string>();

// Main function to start the event listener
function setupWebSocketProvider() {
  try {
    if (wsProvider) {
      // Clean up existing provider if any
      try {
        wsProvider.destroy();
      } catch (e) {
        console.warn('Error destroying previous WebSocket provider:', e);
      }
    }

    console.log('Setting up WebSocket provider...');
    wsProvider = new ethers.WebSocketProvider(ARBITRUM_WS_URL);

    // Access the underlying WebSocket connection
    const websocket = (wsProvider as any)._websocket;

    if (websocket) {
      // Set up event handlers on the raw WebSocket
      websocket.onclose = () => {
        console.warn('WebSocket connection closed');
        wsProvider = null;
        wsContract = null;

        // Try to reconnect after a delay
        if (!wsReconnectInterval) {
          console.log('Scheduling WebSocket reconnection...');
          wsReconnectInterval = setTimeout(() => {
            wsReconnectInterval = null;
            setupWebSocketProvider();
          }, 10000); // Try to reconnect after 10 seconds
        }
      };

      websocket.onerror = (error: any) => {
        console.error('WebSocket error:', error);
      };
    }

    // Set up contract with WebSocket provider
    wsContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wsProvider);

    // Set up event listener
    wsContract.on('RoundCreated', async (...args: any[]) => {
      const event = args[args.length - 1];
      await catchEvent(event, 'WebSocket', args.slice(0, -1), 'RoundCreated');
    });

    wsContract.on('TokensBought', async (...args: any[]) => {
      const event = args[args.length - 1];
      await catchEvent(event, 'WebSocket', args.slice(0, -1), 'TokensBought');
    })

    wsContract.on('TokensClaimed', async (...args: any[]) => {
      const event = args[args.length - 1];
      await catchEvent(event, 'WebSocket', args.slice(0, -1), 'TokensClaimed');
    })

    console.log('WebSocket provider and contract set up successfully');
    return true;
  } catch (error) {
    console.error('Failed to set up WebSocket provider:', error);
    wsProvider = null;
    wsContract = null;
    return false;
  }
}


// Process an event regardless of source
async function catchEvent(event: any, source: string, args?: any[], eventName?: 'RoundCreated' | 'TokensBought' | 'TokensClaimed') {
  try {
    // Create a unique ID for this event to prevent duplicate processing
    const eventId = `${event.transactionHash}-${event.index || 0}`;

    // Skip if we've already processed this event
    if (processedEvents.has(eventId)) {
      return;
    }

    // Mark as processed
    processedEvents.add(eventId);

    console.log(`${source}: ${eventName || 'Unknown'} event detected at block ${event.blockNumber}`);

    // Type guard to check if this is an EventLog (for polling method)
    const isEventLog = (log: Log | EventLog): log is EventLog => {
      return 'args' in log;
    };

    let actualEventName: 'RoundCreated' | 'TokensBought' | 'TokensClaimed';

    if (eventName) {
      actualEventName = eventName;
    } else if (isEventLog(event) && event.fragment && event.fragment.name) {
      // Try to get from event fragment
      actualEventName = event.fragment.name as 'RoundCreated' | 'TokensBought' | 'TokensClaimed';
    } else {
      // Default to RoundCreated if we can't determine
      console.warn('Could not determine event type, defaulting to RoundCreated');
      actualEventName = 'RoundCreated';
    }

    const eventArgs = args ? args : (isEventLog(event) ? Array.from(event.args || []) : []);

    // Process the event data
    const eventData: ArbitrumEventData = {
      eventId: eventId,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      event: actualEventName,
      args: eventArgs,
      processed: false,
      createdAt: new Date(),
    };

    if (actualEventName === 'TokensBought' || actualEventName === 'TokensClaimed') {
      try {
        // Extract user address from event args
        const userAddress = eventArgs[0];

        if (userAddress) {
          // Get user rounds
          const userRounds = await httpContract.getUserRounds(userAddress);

          // Create an object to store user purchase details for each round
          const userPurchaseDetails: any = {};

          // For each round, get purchase details
          for (const roundId of userRounds) {
            const purchaseDetails = await httpContract.getUserRoundPurchase(userAddress, roundId);

            userPurchaseDetails[roundId] = {
              amountBought: purchaseDetails[0].toString(),
              amountClaimed: purchaseDetails[1].toString(),
              totalClaimable: purchaseDetails[2].toString(),
              cliffCompleted: purchaseDetails[3],
              lastClaimTime: purchaseDetails[4].toString()
              // unclaimedPeriodsPassed: purchaseDetails[5].toString()
            };
          }

          // Add user info to the event data
          eventData.userInfo = {
            address: userAddress,
            rounds: userRounds,
            purchaseDetails: userPurchaseDetails
          };
        }
      } catch (userInfoError) {
        console.error('Error fetching user information:', userInfoError);
      }
    }

    console.log(`${actualEventName} event data:`, eventData);

    // Relay to ARK chain
    // await relayToArk(eventData);
    await saveEventToQueue(eventData)

    // Limit the size of processedEvents to prevent memory leaks
    if (processedEvents.size > 1000) {
      const toRemove = Array.from(processedEvents).slice(0, 500);
      toRemove.forEach(id => processedEvents.delete(id));
    }
  } catch (error) {
    console.error(`Error processing ${source} event:`, error);
  }
}

// Main function to start the event listener
export async function startEventListener() {
  console.log('Starting Arbitrum event listener...');

  try {
    // Verify connection to network
    const network = await httpProvider.getNetwork();
    console.log('Connected to network:', network.name);

    // Verify contract exists
    const code = await httpProvider.getCode(CONTRACT_ADDRESS);
    if (code === '0x') {
      console.error('Contract not deployed on network:', network.name);
      process.exit(1);
    }

    console.log(`Contract found at ${CONTRACT_ADDRESS}`);

    // Get all event names from ABI to verify RoundCreated exists
    const eventNames = CONTRACT_ABI
      .filter((item: any) => item.type === 'event')
      .map((item: any) => item.name);

    console.log('Available events in contract:', eventNames);

    // Get current block to start polling from
    let lastCheckedBlock = await httpProvider.getBlockNumber();
    console.log(`Starting from block ${lastCheckedBlock}`);

    // APPROACH 1: WebSocket for real-time events
    const wsSetupSuccess = setupWebSocketProvider();

    if (!wsSetupSuccess) {
      console.warn('WebSocket setup failed, continuing with HTTP polling only');
    }

    // APPROACH 2: Polling as backup or primary if WebSocket is unavailable
    console.log('Setting up polling backup for events...');

    let consecutiveErrors = 0;

    // Extract the polling logic into a separate function
    async function pollForEvents() {
      let currentBlock;
      try {
        // Get current block number
        currentBlock = await httpProvider.getBlockNumber();

        // Skip if no new blocks
        if (currentBlock <= lastCheckedBlock) {
          return;
        }

        // Limit the number of blocks to process in one batch to avoid timeouts
        const batchSize = 2000;
        const fromBlock = lastCheckedBlock + 1;
        const toBlock = Math.min(currentBlock, fromBlock + batchSize - 1);

        console.log(`Polling: Checking blocks ${fromBlock} to ${toBlock} (current: ${currentBlock})`);

        // Process all relevant event types
        const eventTypes = ['RoundCreated', 'TokensBought', 'TokensClaimed'];

        for (const eventType of eventTypes) {
          try {
            // Create filter for the specific event type
            const filter = httpContract.filters[eventType]();

            // Query for events in the block range
            const events = await httpContract.queryFilter(filter, fromBlock, toBlock);

            if (events.length > 0) {
              console.log(`Polling: Found ${events.length} ${eventType} events`);

              // Process each event
              for (const event of events) {
                await catchEvent(event, 'Polling', undefined, eventType as any);
              }
            }
          } catch (eventError) {
            console.error(`Error querying for ${eventType} events:`, eventError);
          }
        }

        // Update last checked block - only update if we've successfully processed this batch
        lastCheckedBlock = toBlock;

        // If we limited the batch size and there are more blocks to process,
        // trigger another immediate check instead of waiting for the next interval
        if (toBlock < currentBlock) {
          console.log(`More blocks to process: ${toBlock + 1} to ${currentBlock}`);
          // Schedule an immediate check for the next batch
          setTimeout(pollForEvents, 100);
        }
      } catch (error) {
        console.error('Error polling for events:', error);

        // If there was an error, we might want to retry the same block range
        // But to avoid getting stuck, we'll move forward a bit if we keep failing
        if (consecutiveErrors > 3) {
          console.warn(`Too many consecutive errors, skipping ahead from block ${lastCheckedBlock}`);
          // Only use currentBlock if it was successfully fetched
          if (currentBlock !== undefined) {
            lastCheckedBlock = Math.min(currentBlock, lastCheckedBlock + 100);
          } else {
            // If we couldn't get currentBlock, just move ahead a fixed amount
            lastCheckedBlock += 100;
          }
          consecutiveErrors = 0;
        } else {
          consecutiveErrors++;
        }
      }
    }

    const pollingInterval = setInterval(pollForEvents, 10000);

    // Handle process termination
    process.on('SIGINT', () => {
      console.log('Shutting down event listener...');
      clearInterval(pollingInterval);

      if (wsReconnectInterval) {
        clearTimeout(wsReconnectInterval);
      }

      if (wsProvider) {
        try {
          wsProvider.destroy();
        } catch (e) {
          console.warn('Error destroying WebSocket provider:', e);
        }
      }

      process.exit(0);
    });

    console.log(`Listening for events on contract ${CONTRACT_ADDRESS}...`);
  } catch (error: any) {
    console.error('Error starting event listener:', error);
    process.exit(1);
  }
}

// Function to test for past events
export async function testPastEvents() {
  try {
    console.log('Testing for past RoundCreated events...');

    // Get current block
    const currentBlock = await httpProvider.getBlockNumber();

    // Look back 10000 blocks or to block 0
    const fromBlock = Math.max(0, currentBlock - 10000);

    console.log(`Checking for events from block ${fromBlock} to ${currentBlock}`);

    // Create filter for RoundCreated events
    const filter = httpContract.filters.RoundCreated();

    // Query for past events
    const events = await httpContract.queryFilter(filter, fromBlock, currentBlock);

    console.log(`Found ${events.length} past RoundCreated events`);

    // Log details of found events
    events.forEach((event, index) => {
      console.log(`Event ${index + 1}:`, {
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        args: 'args' in event ? Array.from(event.args || []) : []
      });
    });

    return events.length > 0;
  } catch (error) {
    console.error('Error testing for past events:', error);
    return false;
  }
}


