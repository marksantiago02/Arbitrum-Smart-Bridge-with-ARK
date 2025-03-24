import express from 'express';
import { createArkBridgeClient } from './ark-client';
import { ArbitrumEventData } from './types';
import dotenv from 'dotenv';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// Initialize environment variables
dotenv.config();

// Create Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting to prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// API key validation middleware
const validateApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    const validApiKey = process.env.RELAYER_API_KEY;

    if (!apiKey || apiKey !== validApiKey) {
        return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }

    next();
};

// Initialize ARK bridge client
const arkBridge = createArkBridgeClient();

// Queue for processing events
const eventQueue: ArbitrumEventData[] = [];
let isProcessing = false;

// Process events from the queue
async function processQueue() {
    if (isProcessing || eventQueue.length === 0) return;

    isProcessing = true;

    try {
        const event = eventQueue.shift()!;
        console.log(`Processing event from queue: ${event.event}`);

        await processArbitrumEvent(event);
    } catch (error) {
        console.error('Error processing event from queue:', error);
    } finally {
        isProcessing = false;

        // Continue processing if there are more events
        if (eventQueue.length > 0) {
            setTimeout(processQueue, 100);
        }
    }
}

// Process Arbitrum event and send to ARK
async function processArbitrumEvent(eventData: ArbitrumEventData) {
    try {
        console.log(`Processing ${eventData.event} event from tx ${eventData.transactionHash}`);

        // Extract relevant data from the event
        const { event, args } = eventData;

        // Process based on event type
        if (event === 'RoundCreated') {
            // Extract round data from args
            // Note: Adjust based on your actual event structure
            const roundId = args[0]?.toString();
            const startTime = args[1]?.toString();
            const endTime = args[2]?.toString();

            console.log(`Round ${roundId} created with start time ${startTime} and end time ${endTime}`);

            // Submit to ARK blockchain
            const txId = await arkBridge.createRound(roundId, startTime, endTime);
            console.log(`ARK transaction created: ${txId}`);

            return { success: true, txId };
        } else {
            console.log(`Unknown event type: ${event}`);
            return { success: false, error: 'Unknown event type' };
        }
    } catch (error) {
        console.error('Error processing Arbitrum event:', error);
        throw error;
    }
}

// Endpoint to receive events from the listener
app.post('/processEvent', validateApiKey, async (req, res) => {
    try {
        const eventData: ArbitrumEventData = req.body;

        // Validate event data
        if (!eventData.event || !eventData.transactionHash) {
            return res.status(400).json({ error: 'Invalid event data' });
        }

        console.log(`Received ${eventData.event} event from tx ${eventData.transactionHash}`);

        // Add to processing queue
        eventQueue.push(eventData);

        // Start processing if not already running
        if (!isProcessing) {
            processQueue();
        }

        // Respond immediately to the listener
        res.status(202).json({
            success: true,
            message: 'Event accepted for processing',
            queueLength: eventQueue.length
        });
    } catch (error: any) {
        console.error('Error handling event:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        queueLength: eventQueue.length,
        isProcessing
    });
});

// Start the server
const PORT = process.env.RELAYER_PORT || 3000;
app.listen(PORT, () => {
    console.log(`Relayer service running on port ${PORT}`);
});
