import { createArkBridgeClient } from './ark-client';
import { initializeDatabase, saveEventToQueue, getUnprocessedEvents, getUserInfoByEthAddress, markEventAsProcessed } from './db';
import { ArbitrumEventData } from './types';

export async function processEvent(eventData: ArbitrumEventData): Promise<void> {
    try {
        // Initialize the database connection
        await initializeDatabase();

        // Save the event to the database
        await saveEventToQueue(eventData);

        // Get unprocessed events from the database
        const unprocessedEvents = await getUnprocessedEvents();
        if (unprocessedEvents.length === 0) {
            console.log('No unprocessed events found.');
            return;
        }
        // Process each unprocessed event
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
    try {
        if (!event.userInfo?.address) {
            console.error('No user address found in event:', event);
            return;
        }

        const userInfoRow = await getUserInfoByEthAddress(event.userInfo?.address!);

        if (!userInfoRow) {
            console.error(`User info not found for address: ${event.userInfo.address}`);
            return;
        }

        // Process the event data
        switch (event.event) {
            case 'RoundCreated':
                // Handle RoundCreated event
                console.log('Processing RoundCreated event:', event);
                break;
            case 'TokensBought':
                if (!event.args || event.args.length === 0) {
                    console.error('Missing args for TokensBought event:', event);
                    return;
                }
                await createArkBridgeClient().mintTokens(userInfoRow?.arkInfo.arkAddress!, event.args[0]);

                console.log('Processing TokensBought event:', event);
                break;
            case 'TokensClaimed':
                // Handle TokensClaimed event
                await createArkBridgeClient().burnTokens(userInfoRow?.arkInfo.arkMnemonic!, event.args[0]);
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