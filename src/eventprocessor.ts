import { createHmeshBridgeClient } from './hmesh-client';
import { initializeDatabase, saveEventToQueue, getUnprocessedEvents, getUserInfoByEthAddress, markEventAsProcessed } from './db';
import { ArbitrumEventData } from './types';
import { decrypt } from './utils';

export async function processEvent(eventData: ArbitrumEventData): Promise<void> {
    try {
        console.log("processing event data")
        await initializeDatabase();

        console.log("save events to queue")
        await saveEventToQueue(eventData);

        const unprocessedEvents = await getUnprocessedEvents();
        console.log(`Found ${unprocessedEvents.length} unprocessed events`);

        if (unprocessedEvents.length === 0) {
            console.log('No unprocessed events found.');
            return;
        }

        for (const event of unprocessedEvents) {
            await processEventData(event);

            if (event.eventId) {
                await markEventAsProcessed(event.eventId);
            }
        }
    } catch (error) {
        console.error('Error processing event:', error);
    }
}

// Function to process the event data
async function processEventData(event: ArbitrumEventData): Promise<void> {
    console.log("processing event data")
    try {
        if (!event.userInfo?.address) {
            console.error('No user address found in event:', event);
            return;
        }

        const userInfoRow = await getUserInfoByEthAddress(event.userInfo.address);

        if (!userInfoRow) {
            console.error(`User info not found for address: ${event.userInfo.address}`);
            return;
        }
        // Validate that we have the required HMESH info
        if (!userInfoRow.hmeshInfo || !userInfoRow.hmeshInfo.hmeshMnemonic) {
            console.error(`Missing HMESH mnemonic for user: ${event.userInfo.address}`);
            return;
        }

        if (!userInfoRow) {
            console.error(`User info not found for address: ${event.userInfo.address}`);
            return;
        }

        switch (event.event) {
            case 'RoundCreated':
                console.log('Processing RoundCreated event:', event);
                break;
            case 'TokensBought':
                if (!event.args || event.args.length === 0) {
                    console.error('Missing args for TokensBought event:', event);
                    return;
                }
                console.log('Processing TokensBought event:', event);
                console.log(`mintToken amount ---> ${BigInt(event.args[2])}`);

                await createHmeshBridgeClient().mintTokens(userInfoRow?.hmeshInfo.hmeshAddress!, BigInt(event.args[2]));
                break;
            case 'TokensClaimed':
                const decryptedHmeshMnemonic = decrypt(userInfoRow?.hmeshInfo.hmeshMnemonic!)
                await createHmeshBridgeClient().burnTokens(decryptedHmeshMnemonic, BigInt(event.args[2]));
                console.log('Processing TokensClaimed event:', event);
                break;
            default:
                console.error('Unknown event type:', event.event);
        }

        console.log('Processing event:', event);
    } catch (error) {
        console.error('Error processing event:', error);
    }
}