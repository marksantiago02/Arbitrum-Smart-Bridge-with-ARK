import { Transactions, Managers, Utils, Identities } from '@arkecosystem/crypto';
import axios from 'axios';
import dotenv from 'dotenv';
import { ArbitrumEventData } from './types'

dotenv.config();

// ARK node details
const ARK_NODE_URL = process.env.ARK_NODE_DEVNET_URL!;
const ARK_BRIDGE_PASSPHRASE = process.env.ARK_BRIDGE_PASSPHRASE!;
const ARK_NETWORK = process.env.ARK_NETWORK || 'devnet';
const RELAYER_API_URL = process.env.RELAYER_API_URL || 'http://localhost:3000';

// Configure the network
Managers.configManager.setFromPreset(ARK_NETWORK as any);
Managers.configManager.setHeight(2); // Set appropriate height for your network

export function createArkBridgeClient() {
    // Create wallet from passphrase
    const bridgeAddress = Identities.Address.fromPassphrase(ARK_BRIDGE_PASSPHRASE);

    console.log(`ARK Bridge wallet address: ${bridgeAddress}`);

    // Get the next nonce for the wallet
    async function getNextNonce(address: string): Promise<string> {
        try {
            const response = await axios.get(`${ARK_NODE_URL}/api/wallets/${address}`);
            return (parseInt(response.data.data.nonce) + 1).toString();
        } catch (error) {
            console.error('Error fetching nonce:', error);
            throw new Error('Failed to get nonce');
        }
    }

    // Send a transaction to the ARK network
    async function sendTransaction(transaction: any): Promise<string> {
        try {
            const response = await axios.post(`${ARK_NODE_URL}/api/transactions`, {
                transactions: [transaction],
            });

            if (response.data.errors) {
                console.error('Transaction errors:', response.data.errors);
                throw new Error(`Transaction failed: ${JSON.stringify(response.data.errors)}`);
            }

            const txId = transaction.id;
            console.log(`Transaction ${txId} sent successfully`);
            return txId;
        } catch (error) {
            console.error('Error sending transaction:', error);
            throw error;
        }
    }

    // Create a round on ARK blockchain
    // async function createRound(roundId: string, startTime: string, endTime: string): Promise<string> {
    //     try {
    //         console.log(`Creating round ${roundId} on ARK blockchain`);

    //         const transaction = Transactions.BuilderFactory
    //             .transfer()
    //             .vendorField(JSON.stringify({
    //                 action: 'createRound',
    //                 roundId,
    //                 startTime,
    //                 endTime
    //             }))
    //             .nonce(await getNextNonce(bridgeAddress))
    //             .sign(ARK_BRIDGE_PASSPHRASE)
    //             .build();

    //         return await sendTransaction(transaction);
    //     } catch (error) {
    //         console.error('Error creating round:', error);
    //         throw error;
    //     }
    // }

    // Mint tokens on ARK blockchain
    async function mintTokens(arkAddress: string, amount: bigint): Promise<string> {
        try {
            console.log(`Minting ${amount} tokens for ${arkAddress}`);

            const transaction = Transactions.BuilderFactory
                .transfer()
                .recipientId(arkAddress)
                .amount(amount.toString())
                .vendorField(JSON.stringify({
                    action: 'mint',
                    token: 'HMESH'
                }))
                .nonce(await getNextNonce(bridgeAddress))
                .fee('10000000') // Fixed fee
                .sign(ARK_BRIDGE_PASSPHRASE)
                .build();

            return await sendTransaction(transaction);
        } catch (error) {
            console.error('Error minting tokens:', error);
            throw error;
        }
    }

    // Burn tokens on ARK blockchain
    async function burnTokens(CLIENT_ARK_PASSPHRASE: string, amount: bigint): Promise<string> {
        try {
            console.log(`Burning ${amount} tokens for ${CLIENT_ARK_PASSPHRASE}`);

            const transaction = Transactions.BuilderFactory
                .transfer()
                .recipientId(bridgeAddress) // Send to bridge address for burning
                .amount(amount.toString())
                .vendorField(JSON.stringify({
                    action: 'burn',
                    token: 'HMESH',
                }))
                .nonce(await getNextNonce(bridgeAddress))
                .fee('10000000') // Fixed fee
                .sign(CLIENT_ARK_PASSPHRASE)
                .build();

            return await sendTransaction(transaction);
        } catch (error) {
            console.error('Error burning tokens:', error);
            throw error;
        }
    }

    // Return the client interface
    return {
        mintTokens,
        burnTokens,
        getNextNonce
    };
}


export async function relayToOffChainService(eventData: ArbitrumEventData) {
    try {
        console.log('Sending event to off-chain relayer:', eventData);

        // Send data to the relayer service
        const response = await axios.post(`${RELAYER_API_URL}/processEvent`, eventData, {
            headers: {
                'Content-Type': 'application/json',
                // Add any authentication headers if needed
                'X-API-Key': process.env.RELAYER_API_KEY
            }
        });

        console.log('Event sent to relayer service:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error sending to relayer service:', error);
        // Implement retry logic here if needed
        throw error;
    }
}


// import { Connection } from '@arkecosystem/client'
// import { Transactions, Identities } from '@arkecosystem/crypto'
// import dotenv from 'dotenv'
// import axios from 'axios'

// import { CreateTransactionApiResponse, ArbitrumEventData } from './types'

// dotenv.config()

// const EVENT_ACTIONS = {
//     'RoundCreated': 'log',
//     'TokensBought': 'mint', // Mint tokens on ARK
//     'TokensClaimed': 'burn', // Burn tokens on ARK
// };
// const RELAYER_API_URL = process.env.RELAYER_API_URL || 'http://localhost:3000';

// // Connect to ARK node
// const connection: Connection = new Connection(process.env.ARK_NODE_URL!)

// // Generate bridge wallet credentials
// const bridgePassphrase = process.env.BRIDGE_WALLET_PASSPHRASE!
// const bridgeKeys = Identities.Keys.fromPassphrase(bridgePassphrase)
// const bridgeAddress = Identities.Address.fromPassphrase(bridgePassphrase)

// const createTransaction = async (arkAddress: string, amount: bigint, action: 'mint' | 'burn') => {
//     const transaction = Transactions.BuilderFactory
//         .transfer()
//         .vendorField(JSON.stringify({
//             action,
//             token: 'HMESH',
//             amount: amount.toString()
//         }))
//         .recipientId(arkAddress)
//         .nonce(await getNextNonce(bridgeAddress))
//         .fee(process.env.ARK_TRANSACTION_FEE!)
//         .amount(amount.toString())
//         .senderPublicKey(bridgeKeys.publicKey)
//         .sign(bridgeKeys.privateKey)
//         .build()

//     return Transactions.Serializer.serialize(transaction).toString('hex')
// }

// export const createArkBridgeClient = () => {

//     const mintTokens = async (arkAddress: string, amount: bigint): Promise<string> => {
//         const serializedTx = createTransaction(arkAddress, amount, 'mint')
//         const response = await connection.api('transactions').create({
//             transactions: [{ id: serializedTx }]
//         }) as unknown as { body: CreateTransactionApiResponse }
//         console.log(response.body.data[0].id)
//         return response.body.data[0].id
//     }

//     const burnTokens = async (arkAddress: string, amount: bigint): Promise<string> => {
//         const serializedTx = createTransaction(arkAddress, amount, 'burn')
//         const response = await connection.api('transactions').create({
//             transactions: [{ id: serializedTx }]
//         }) as unknown as { body: CreateTransactionApiResponse }
//         console.log(response.body.data[0].id)
//         return response.body.data[0].id
//     }

//     return {
//         mintTokens,
//         burnTokens,
//         bridgeAddress
//     }
// }

// const getNextNonce = async (walletAddress: string) => {
//     const nonce = (await connection.api('wallets').get(walletAddress)).body.data.nonce
//     return (parseInt(nonce, 10) + 1).toString()
// }

// export async function relayToArk(eventData: ArbitrumEventData) {
//     try {
//         console.log(`Relaying ${eventData.event} event to ARK chain:`, eventData);

//         const arkBridge = createArkBridgeClient();
//         // Get the action for this event type
//         const action = EVENT_ACTIONS[eventData.event as keyof typeof EVENT_ACTIONS] || 'log';

//         // Extract relevant data from event args
//         // Note: You'll need to adjust this based on your actual event structure
//         let arkAddress = '';
//         let amount = BigInt(0);

//         if (eventData.args && eventData.args.length >= 2) {
//             // This is a simplified example - adjust based on your actual event structure
//             arkAddress = eventData.args[0].toString(); // Assuming first arg is address
//             amount = BigInt(eventData.args[1].toString()); // Assuming second arg is amount
//         } else {
//             console.warn(`Insufficient arguments in ${eventData.event} event:`, eventData.args);
//             return;
//         }

//         // Perform the appropriate action based on event type
//         switch (action) {
//             case 'mint':
//                 console.log(`Minting ${amount} tokens to ${arkAddress} on ARK`);
//                 const mintTxId = await arkBridge.mintTokens(arkAddress, amount);
//                 console.log(`Mint transaction created: ${mintTxId}`);
//                 break;

//             case 'burn':
//                 console.log(`Burning ${amount} tokens from ${arkAddress} on ARK`);
//                 const burnTxId = await arkBridge.burnTokens(arkAddress, amount);
//                 console.log(`Burn transaction created: ${burnTxId}`);
//                 break;

//             case 'log':
//             default:
//                 console.log(`Logging ${eventData.event} event (no action taken)`);
//                 break;
//         }
//     } catch (error) {
//         console.error(`Error relaying ${eventData.event} to ARK:`, error);
//     }
// }