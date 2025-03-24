import { Transactions, Managers, Utils, Identities } from '@arkecosystem/crypto';
import { generateMnemonic } from 'bip39';
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

export function createARKWallet() {
    const mnemonic: string = generateMnemonic(256);

    const publicKey = Identities.PublicKey.fromPassphrase(mnemonic);
    const privateKey = Identities.PrivateKey.fromPassphrase(mnemonic);
    const address = Identities.Address.fromPassphrase(mnemonic);

    return { mnemonic, publicKey, privateKey, address }
}


export async function relayToOffChainService(eventData: ArbitrumEventData) {
    try {
        console.log('Sending event to off-chain relayer:', eventData);

        // Send data to the relayer service
        const response = await axios.post(`${RELAYER_API_URL}/processEvent`, eventData, {
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.RELAYER_API_KEY
            }
        });

        console.log('Event sent to relayer service:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error sending to relayer service:', error);
        throw error;
    }
}
