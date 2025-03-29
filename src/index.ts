import express from 'express';
import cors from 'cors';
import { testPastEvents, startEventListener } from "./eventlistener";
import { resetDatabase } from "./db";

import walletAccessRouter from './api/wallet-access';
import votingRouter from './api/voting';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api/wallet', walletAccessRouter);
app.use('/api/voting', votingRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

async function main() {
    try {
        const foundPastEvents = await testPastEvents();

        if (!foundPastEvents) {
            console.warn('No past RoundCreated events found. This could be normal if no events have been emitted,');
            console.warn('but could also indicate an issue with the contract address, ABI, or event name.');
        }

        await startEventListener();
        // await resetDatabase();
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
