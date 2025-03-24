import { testPastEvents, startEventListener } from "./eventlistener";

// Main execution
async function main() {
    try {
        // First test for past events to verify everything is working
        const foundPastEvents = await testPastEvents();

        if (!foundPastEvents) {
            console.warn('No past RoundCreated events found. This could be normal if no events have been emitted,');
            console.warn('but could also indicate an issue with the contract address, ABI, or event name.');
        }

        // Start the event listener
        await startEventListener();
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Start the application
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
