export interface TransactionResponse {
    id: string;
}

export interface CreateTransactionApiResponse {
    data: TransactionResponse[];
}

export interface ArbitrumEventData {
    transactionHash: string;
    blockNumber: number;
    event: 'RoundCreated' | 'TokensBought' | 'TokensClaimed';
    args: any[];
}

export interface PurchaseEvent {
    buyer: string
    roundId: number
    tokensBought: bigint
    amountPaid: bigint
    timestamp: number
}

export interface ClaimEvent {
    caller: string
    tokenAmount: bigint
    timestamp: number
}
