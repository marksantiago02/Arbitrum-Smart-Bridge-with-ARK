import { Transactions, Managers, Interfaces, Identities } from '@arkecosystem/crypto';
import { generateMnemonic } from 'bip39';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import dotenv from 'dotenv';
import { HmeshTransaction } from './types'

dotenv.config();

// HMESH node details
const HMESH_DEVNET_NODE_URL = process.env.HMESH_DEVNET_NODE_URL!;
const HMESH_BRIDGE_MNEMONIC = process.env.HMESH_BRIDGE_MNEMONIC!;
const HMESH_NETWORK = process.env.HMESH_NETWORK || 'devnet';

// Configure the network
Managers.configManager.setFromPreset(HMESH_NETWORK as any);
Managers.configManager.setHeight(2);

const hmeshClient = axios.create({
    timeout:30000
});

axiosRetry(hmeshClient, {
    retries: 3,
    retryDelay: (retryCount) => {
        console.log(`Retry attempt ${retryCount}`);
        return retryCount * 2000;
    },
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || 
        (error.response && error.response.status >= 500) || false;    
    },
});

export function createHmeshBridgeClient() {
    // Create wallet from passphrase
    const bridgeAddress = Identities.Address.fromPassphrase(HMESH_BRIDGE_MNEMONIC);

    console.log(`HMESH Bridge wallet address: ${bridgeAddress}`);

    // Get the next nonce for the wallet
    async function getNextNonce(address: string): Promise<string> {
        try {
            const response = await axios.get(`${HMESH_DEVNET_NODE_URL}/api/wallets/${address}`);
            return (parseInt(response.data.data.nonce) + 1).toString();
        } catch (error) {
            console.error('Error fetching nonce:', error);
            throw new Error('Failed to get nonce');
        }
    }

    // Send a transaction to the HMESH network
    async function sendTransaction(transaction: HmeshTransaction): Promise<string> {
        try {
            console.log('Sending transaction...')
            const response = await hmeshClient.post(`${HMESH_DEVNET_NODE_URL}/api/transactions`, {
                transactions: [transaction],
            });

            if (response.data.errors) {
                console.error('Transaction errors:', response.data.errors);
                throw new Error(`Transaction failed: ${JSON.stringify(response.data.errors)}`);
            }

            const txId = transaction.id!;
            console.log(`Transaction ${txId} sent successfully`);
            return txId;
        } catch (error) {
            console.error('Error sending transaction:', error);
            throw error;
        }
    }

    // Mint tokens on HMESH blockchain
    async function mintTokens(hmeshClientAddress: string, amount: bigint): Promise<string> {
        try {
            console.log(`Minting ${amount} tokens for ${hmeshClientAddress}`);
            console.log(`nonce of the bridge address: ${await getNextNonce(bridgeAddress)}`)

            const transaction:HmeshTransaction = Transactions.BuilderFactory
                .transfer()
                .version(2)
                .nonce(await getNextNonce(bridgeAddress))
                .recipientId(hmeshClientAddress)
                // .amount(amount.toString())
                .amount("100000000")
                .vendorField(JSON.stringify({
                    action: 'mint',
                    token: 'HMESH'
                }))
                .fee('10000000')
                .typeGroup(1)
                .sign(HMESH_BRIDGE_MNEMONIC)
                .build();

            console.log('Transaction details:', transaction);

            const txId = await sendTransaction(transaction);
            console.log(`Successfully minted ${amount} HMESH tokens. Transaction ID: ${txId}`);
            return txId;
        } catch (error:any) {
            if (error.message?.includes('nonce')) {
                console.error('Nonce error detected, retrying with updated nonce...');
              }
              console.error('Error minting tokens:', error);
              throw new Error(`Failed to mint tokens: ${error.message}`);
        }
    }

    // Burn tokens on HMESH blockchain
    async function burnTokens(HMESH_CLIENT_MNEMONIC: string, amount: bigint): Promise<string> {
        try {
            const hmeshAddress = Identities.PublicKey.fromPassphrase(HMESH_CLIENT_MNEMONIC);
            console.log(`Burning ${amount} tokens for ${hmeshAddress}`);

            const transaction: HmeshTransaction = Transactions.BuilderFactory
                .transfer()
                .recipientId(bridgeAddress)
                .amount(amount.toString())
                .vendorField(JSON.stringify({
                    action: 'burn',
                    token: 'HMESH',
                }))
                .nonce(await getNextNonce(bridgeAddress))
                .fee('10000000')
                .sign(HMESH_CLIENT_MNEMONIC)
                .build();

            const txId = await sendTransaction(transaction);
            console.log(`Successfully burned ${amount} HMESH tokens. Transaction ID: ${txId}`)
            return txId;
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

export function createHMESHWallet() {
    const mnemonic: string = generateMnemonic(256);

    const publicKey = Identities.PublicKey.fromPassphrase(mnemonic);
    const privateKey = Identities.PrivateKey.fromPassphrase(mnemonic);
    const address = Identities.Address.fromPassphrase(mnemonic);

    return { mnemonic, publicKey, privateKey, address }
}
