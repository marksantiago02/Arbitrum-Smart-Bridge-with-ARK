import { ethers } from 'ethers';
import { Log, EventLog } from 'ethers';
import dotenv from 'dotenv';
import { processEvent } from './eventprocessor';
import { ArbitrumEventData } from './types';
const CONTRACT_ABI = require('./contract_abi/presale.json');

dotenv.config();

// Arbitrum RPC URLs
const ARBITRUM_RPC_URL = process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc';
const ARBITRUM_WS_URL = process.env.ARBITRUM_SEPOLIA_WSS_URL || 'wss://sepolia-rollup.arbitrum.io/ws';

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS_SEPOLIA!;

const httpProvider = new ethers.JsonRpcProvider(ARBITRUM_RPC_URL, undefined, {
  polling: true,
  pollingInterval: 4000,
  staticNetwork: true,
  batchStallTime: 50,
});

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

const processedEvents = new Set<string>();

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
      websocket.onclose = () => {
        console.warn('WebSocket connection closed');
        wsProvider = null;
        wsContract = null;

        if (!wsReconnectInterval) {
          console.log('Scheduling WebSocket reconnection...');
          wsReconnectInterval = setTimeout(() => {
            wsReconnectInterval = null;
            setupWebSocketProvider();
          }, 10000); 
        }
      };

      websocket.onerror = (error: any) => {
        console.error('WebSocket error:', error);
      };
    }

    wsContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wsProvider);

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
    const eventId = `${event.transactionHash}-${event.index || 0}`;

    if (processedEvents.has(eventId)) {
      return;
    }

    // Mark as processed
    processedEvents.add(eventId);

    console.log(`${source}: ${eventName || 'Unknown'} event detected at block ${event.blockNumber}`);

    const isEventLog = (log: Log | EventLog): log is EventLog => {
      return 'args' in log;
    };

    let actualEventName: 'RoundCreated' | 'TokensBought' | 'TokensClaimed';

    if (eventName) {
      actualEventName = eventName;
    } else if (isEventLog(event) && event.fragment && event.fragment.name) {
      actualEventName = event.fragment.name as 'RoundCreated' | 'TokensBought' | 'TokensClaimed';
    } else {
      console.warn('Could not determine event type, defaulting to RoundCreated');
      actualEventName = 'RoundCreated';
    }

    const eventArgs = args ? args : (isEventLog(event) ? Array.from(event.args || []) : []);

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
        const userAddress = eventArgs[0];

        if (userAddress) {
          const userRounds = await httpContract.getUserRounds(userAddress);

          const userPurchaseDetails: any = {};

          for (const roundId of userRounds) {
            const purchaseDetails = await httpContract.getUserRoundPurchase(userAddress, roundId);

            userPurchaseDetails[roundId] = {
              amountBought: purchaseDetails[0].toString(),
              amountClaimed: purchaseDetails[1].toString(),
              totalClaimable: purchaseDetails[2].toString(),
              cliffCompleted: purchaseDetails[3],
              lastClaimTime: purchaseDetails[4].toString()
            };
          }

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

    await processEvent(eventData)

    if (processedEvents.size > 1000) {
      const toRemove = Array.from(processedEvents).slice(0, 500);
      toRemove.forEach(id => processedEvents.delete(id));
    }
  } catch (error) {
    console.error(`Error processing ${source} event:`, error);
  }
}

export async function startEventListener() {
  console.log('Starting Arbitrum event listener...');

  try {
    const network = await httpProvider.getNetwork();
    console.log('Connected to network:', network.name);

    const code = await httpProvider.getCode(CONTRACT_ADDRESS);
    if (code === '0x') {
      console.error('Contract not deployed on network:', network.name);
      process.exit(1);
    }

    console.log(`Contract found at ${CONTRACT_ADDRESS}`);

    let lastCheckedBlock = await httpProvider.getBlockNumber();
    console.log(`Starting from block ${lastCheckedBlock}`);

    const wsSetupSuccess = setupWebSocketProvider();

    if (!wsSetupSuccess) {
      console.warn('WebSocket setup failed, continuing with HTTP polling only');
    }

    console.log('Setting up polling backup for events...');

    let consecutiveErrors = 0;

    async function pollForEvents() {
      let currentBlock;
      try {
        currentBlock = await httpProvider.getBlockNumber();

        if (currentBlock <= lastCheckedBlock) {
          return;
        }

        const batchSize = 2000;
        const fromBlock = lastCheckedBlock + 1;
        const toBlock = Math.min(currentBlock, fromBlock + batchSize - 1);

        const eventTypes = ['RoundCreated', 'TokensBought', 'TokensClaimed'];

        for (const eventType of eventTypes) {
          try {
            const filter = httpContract.filters[eventType]();

            const events = await httpContract.queryFilter(filter, fromBlock, toBlock);

            if (events.length > 0) {
              console.log(`Polling: Found ${events.length} ${eventType} events`);

              for (const event of events) {
                await catchEvent(event, 'Polling', undefined, eventType as any);
              }
            }
          } catch (eventError) {
            console.error(`Error querying for ${eventType} events:`, eventError);
          }
        }

        lastCheckedBlock = toBlock;

        if (toBlock < currentBlock) {
          console.log(`More blocks to process: ${toBlock + 1} to ${currentBlock}`);
          setTimeout(pollForEvents, 100);
        }
      } catch (error) {
        console.error('Error polling for events:', error);

        if (consecutiveErrors > 3) {
          console.warn(`Too many consecutive errors, skipping ahead from block ${lastCheckedBlock}`);
          if (currentBlock !== undefined) {
            lastCheckedBlock = Math.min(currentBlock, lastCheckedBlock + 100);
          } else {
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

    const currentBlock = await httpProvider.getBlockNumber();

    const fromBlock = Math.max(0, currentBlock - 10000);

    console.log(`Checking for events from block ${fromBlock} to ${currentBlock}`);

    const filter = httpContract.filters.RoundCreated();

    const events = await httpContract.queryFilter(filter, fromBlock, currentBlock);

    console.log(`Found ${events.length} past RoundCreated events`);

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


