# Arbitrum-Bridge-with-HMESH

A bridge implementation that enables asset transfers between Arbitrum and the ARK V3 based custom DPoS blockchain - HMESH.

## Overview

This project implements a cross-chain bridge that allows users to transfer tokens between Arbitrum (an Ethereum Layer 2 scaling solution) and HMESH blockchain. The bridge facilitates the minting and burning of tokens on the HMESH blockchain, which corresponds to locking and unlocking of tokens on the Arbitrum side.

## Features

- **Token Bridging**: Transfer tokens between Arbitrum and HMESH networks
- **Minting Operations**: Create new HMESH tokens when assets are locked on Arbitrum
- **Burning Operations**: Burn HMESH tokens to release assets on Arbitrum
- **Wallet Management**: Create and manage HMESH wallets
- **Transaction Handling**: Reliable transaction submission with retry mechanisms

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Access to Arbitrum and HMESH networks

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/BTC415/Arbitrum-Bridge-with-ARK.git
   cd Arbitrum-Bridge-with-ARK
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables by creating a `.env` file:
   ```
   HMESH_DEVNET_NODE_URL=https://your-hmesh-node-url
   HMESH_BRIDGE_MNEMONIC=your-bridge-wallet-mnemonic
   HMESH_NETWORK=devnet
   ```

## Usage

### Bridging Tokens

First it catches the event of a new transaction on the Arbitrum network when user buys or claims ERC20 token on presale using RPC node and then it sends the transaction to HMESH network.

```typescript
async function catchEvent(event: any, source: string, args?: any[], eventName?: 'RoundCreated' | 'TokensBought' | 'TokensClaimed') {
  try {
    // Create a unique ID for this event to prevent duplicate processing
    const eventId = `${event.transactionHash}-${event.index || 0}`;

    // Skip if we've already processed this event
    if (processedEvents.has(eventId)) {
      return;
    }

    // Mark as processed
    processedEvents.add(eventId);

    console.log(`${source}: ${eventName || 'Unknown'} event detected at block ${event.blockNumber}`);

    // Type guard to check if this is an EventLog (for polling method)
    const isEventLog = (log: Log | EventLog): log is EventLog => {
      return 'args' in log;
    };

    let actualEventName: 'RoundCreated' | 'TokensBought' | 'TokensClaimed';

    if (eventName) {
      actualEventName = eventName;
    } else if (isEventLog(event) && event.fragment && event.fragment.name) {
      // Try to get from event fragment
      actualEventName = event.fragment.name as 'RoundCreated' | 'TokensBought' | 'TokensClaimed';
    } else {
      // Default to RoundCreated if we can't determine
      console.warn('Could not determine event type, defaulting to RoundCreated');
      actualEventName = 'RoundCreated';
    }

    const eventArgs = args ? args : (isEventLog(event) ? Array.from(event.args || []) : []);

    // Process the event data
    const eventData: ArbitrumEventData = {
      eventId: eventId,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      event: actualEventName,
      args: eventArgs,
      processed: false,
      createdAt: new Date(),
    };

    if (actualEventName === 'TokensBought' || actualEventName === 'TokensClaimed') {
      try {
        // Extract user address from event args
        const userAddress = eventArgs[0];

        if (userAddress) {
          // Get user rounds
          const userRounds = await httpContract.getUserRounds(userAddress);

          // Create an object to store user purchase details for each round
          const userPurchaseDetails: any = {};

          // For each round, get purchase details
          for (const roundId of userRounds) {
            const purchaseDetails = await httpContract.getUserRoundPurchase(userAddress, roundId);

            userPurchaseDetails[roundId] = {
              amountBought: purchaseDetails[0].toString(),
              amountClaimed: purchaseDetails[1].toString(),
              totalClaimable: purchaseDetails[2].toString(),
              cliffCompleted: purchaseDetails[3],
              lastClaimTime: purchaseDetails[4].toString()
              // unclaimedPeriodsPassed: purchaseDetails[5].toString()
            };
          }

          // Add user info to the event data
          eventData.userInfo = {
            address: userAddress,
            rounds: userRounds,
            purchaseDetails: userPurchaseDetails
          };
        }
      } catch (userInfoError) {
        console.error('Error fetching user information:', userInfoError);
      }
    }

    console.log(`${actualEventName} event data:`, eventData);

    await processEvent(eventData)

    // Limit the size of processedEvents to prevent memory leaks
    if (processedEvents.size > 1000) {
      const toRemove = Array.from(processedEvents).slice(0, 500);
      toRemove.forEach(id => processedEvents.delete(id));
    }
  } catch (error) {
    console.error(`Error processing ${source} event:`, error);
  }
}
```

### Creating a HMESH Wallet

```typescript
export function createHMESHWallet() {
    const mnemonic: string = generateMnemonic(256);

    const publicKey = Identities.PublicKey.fromPassphrase(mnemonic);
    const privateKey = Identities.PrivateKey.fromPassphrase(mnemonic);
    const address = Identities.Address.fromPassphrase(mnemonic);

    return { mnemonic, publicKey, privateKey, address }
}

```

### Minting Tokens on HMESH

```typescript
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
```

### Burning Tokens on HMESH

```typescript
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
```

## Technical Details

- The HMESH blockchain uses 8 decimal places for its native token
- Transactions on HMESH include metadata in the `vendorField` to specify actions (mint/burn)
- The bridge uses a dedicated wallet (specified by `HMESH_BRIDGE_MNEMONIC`) to handle token minting
- Transaction submission includes retry logic to handle network issues

## Security Considerations

- The bridge wallet mnemonic should be kept secure and not exposed
- Consider implementing multi-signature requirements for bridge operations
- Implement proper monitoring and alerting for bridge activities
- Regular audits of the bridge code and operations are recommended

## Development

### Running Tests

```bash
npm test
```

### Building the Project

```bash
npm run build
```

## License

[MIT License](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
