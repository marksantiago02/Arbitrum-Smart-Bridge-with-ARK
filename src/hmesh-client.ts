import { Transactions, Managers, Interfaces, Identities } from '@arkecosystem/crypto';
import { generateMnemonic } from 'bip39';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import dotenv from 'dotenv';
import { encrypt } from './utils';
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
            
            if (response.data.data && response.data.data.accept && response.data.data.accept.length > 0) {
                const txId = response.data.data.accept[0];
                console.log(`Transaction ${txId} accepted by the network`);
                return txId;
              }

            const txId = transaction.id!;
            console.log(`Transaction ${txId} sent successfully`);
            return txId;
        } catch (error:any) {
            console.error('Error sending transaction:', error);

            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
              }
            throw error;
        }
    }

    // Mint tokens on HMESH blockchain
    async function mintTokens(hmeshClientAddress: string, amount: bigint): Promise<string> {
        try {
            console.log(`Minting ${amount} tokens for ${hmeshClientAddress}`);
            const nonce = await getNextNonce(bridgeAddress);

            const amountWithDecimals = (amount / BigInt(10000000000)).toString();
            console.log(`Converted native HMESH coinst with 8 decimals: ${amountWithDecimals}`);

            const transaction:HmeshTransaction = Transactions.BuilderFactory
                .transfer()
                .version(2)
                .nonce(nonce)
                .recipientId(hmeshClientAddress)
                .amount(amountWithDecimals)
                // .amount("100000000")
                .vendorField(JSON.stringify({
                    action: 'mint',
                    token: 'HMESH'
                }))
                .fee('10000000')
                .typeGroup(1)
                .sign(HMESH_BRIDGE_MNEMONIC)
                .build();

            console.log('Transaction details:', transaction.data);

            const txId = await sendTransaction(transaction.data);
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
            const hmeshClientAddress = Identities.Address.fromPassphrase(HMESH_CLIENT_MNEMONIC);
            console.log(`Burning ${amount} tokens for ${hmeshClientAddress}`);

            const nonce = await getNextNonce(hmeshClientAddress);

            const amountWithDecimals = (amount / BigInt(10000000000)).toString();
            console.log(`Converted native HMESH coinst with 8 decimals: ${amountWithDecimals}`);

            const transaction: HmeshTransaction = Transactions.BuilderFactory
                .transfer()
                .version(2)
                .nonce(nonce)
                .recipientId(bridgeAddress)
                .amount(amountWithDecimals.toString())
                .vendorField(JSON.stringify({
                    action: 'burn',
                    token: 'HMESH',
                }))
                .fee('10000000')
                .typeGroup(1)
                .sign(HMESH_CLIENT_MNEMONIC)
                .build();

            console.log('Transaction details:', transaction.data);

            const txId = await sendTransaction(transaction.data);
            console.log(`Successfully burned ${amount} HMESH tokens. Transaction ID: ${txId}`)
            return txId;
        } catch (error) {
            console.error('Error burning tokens:', error);
            throw error;
        }
    }

    return {
        mintTokens,
        burnTokens
        };
}

export function createHMESHWallet() {
    const mnemonic: string = generateMnemonic(256);

    const publicKey = Identities.PublicKey.fromPassphrase(mnemonic);
    const privateKey = Identities.PrivateKey.fromPassphrase(mnemonic);
    const address = Identities.Address.fromPassphrase(mnemonic);

    const encryptedMnemonic = encrypt(mnemonic);
    const encryptedPrivateKey = encrypt(privateKey);

    return { encryptedMnemonic, publicKey, encryptedPrivateKey, address }
}
