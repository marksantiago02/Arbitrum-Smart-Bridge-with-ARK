export interface HmeshTransaction {
    id?: string;
    blockId?: string;
    version?: number;
    type?: number;
    typeGroup?: number;
    amount?: string;
    fee?: string;
    sender?: string;
    senderPublicKey?: string;
    recipient?: string;
    recipientId?: string;
    signature?: string;
    signatures?: string[];
    vendorField?: string;
    asset?: any;
    confirmations?: number;
    timestamp?: any;
    nonce?: string;
    [key: string]: any;
  }
 
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
    hmeshInfo: {
        hmeshMnemonic: string;
        hmeshPublicKey: string;
        hmeshPrivateKey: string;
        hmeshAddress: string;
    }
    rounds: string | any[];
    purchaseDetails: string | Record<string, any>;
    lastUpdated: Date;
    createdAt: Date;
}
