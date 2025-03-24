export interface TransactionResponse {
    id: string;
}

export interface CreateTransactionApiResponse {
    data: TransactionResponse[];
}

export interface ArbitrumEventData {
    eventId: string;           // Unique identifier for the event
    transactionHash: string;
    blockNumber: number;
    event: 'RoundCreated' | 'TokensBought' | 'TokensClaimed';
    args: any[];
    userInfo?: {
        address: string;
        rounds: number[];
        purchaseDetails: {
            [roundId: string]: {
                amountBought: string;
                amountClaimed: string;
                totalClaimable: string;
                cliffCompleted: boolean;
                lastClaimTime: string;
                unclaimedPeriodsPassed: string;
            }
        }
    };
    processed: boolean;        // Flag to track processing status
    createdAt: Date;           // When the event was captured
    processedAt?: Date;        // When the event was processed
}

export interface EventQueueRow {
    eventId: string;
    transactionHash: string;
    blockNumber: string | number;
    event: 'TokensBought' | 'TokensClaimed';
    args: string;
    userInfo: string;
    userAddress: string | null;
    processed: boolean;
    createdAt: Date;
    processedAt: Date | null;
}

// Interface for user info row
export interface UserInfoRow {
    ethAddress: string;
    arkAddress: string;
    rounds: string | any[]; // Add this field
    purchaseDetails: string | Record<string, any>; // Add this field
    lastUpdated: Date;
    createdAt: Date;
}
