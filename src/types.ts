import { Interfaces } from "@arkecosystem/crypto";

export type ArkTransaction = Interfaces.ITransaction;

export interface TransactionResponse {
    id: string;
}

export interface CreateTransactionApiResponse {
    data: TransactionResponse[];
}

export interface ArbitrumEventData {
    eventId: string;
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
    
    processed: boolean;
    createdAt: Date;
    processedAt?: Date;
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

export interface UserInfoRow {
    ethAddress: string;
    arkInfo: {
        arkMnemonic: string;
        arkPublicKey: string;
        arkPrivateKey: string;
        arkAddress: string;
    }
    rounds: string | any[];
    purchaseDetails: string | Record<string, any>;
    lastUpdated: Date;
    createdAt: Date;
}
