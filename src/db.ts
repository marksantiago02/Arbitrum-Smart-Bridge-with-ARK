import { Pool } from 'pg';
import dotenv from 'dotenv';
import { createHMESHWallet } from './hmesh-client';
import { ArbitrumEventData, UserInfoRow, EventQueueRow } from './types';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DB_URL,
});

/**
 * Create database tables if they don't exist
 */
export async function initializeDatabase(): Promise<void> {
    const client = await pool.connect();
    try {
        // Create the event_queue table
        await client.query(`
        CREATE TABLE IF NOT EXISTS event_queue (
          event_id VARCHAR(255) PRIMARY KEY,
          transaction_hash VARCHAR(255) NOT NULL,
          block_number BIGINT NOT NULL,
          event_type VARCHAR(50) NOT NULL,
          args JSONB NOT NULL,
          user_info JSONB,
          user_address VARCHAR(255),
          processed BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          processed_at TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_event_queue_processed ON event_queue(processed);
        CREATE INDEX IF NOT EXISTS idx_event_queue_created_at ON event_queue(created_at);
        CREATE INDEX IF NOT EXISTS idx_event_queue_user_address ON event_queue(user_address);
      `);

        // Create the user_info table with JSONB fields to store pre-fetched data
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_info (
              eth_address VARCHAR(255) PRIMARY KEY,
              hmesh_info JSONB NOT NULL,
              rounds JSONB NOT NULL DEFAULT '[]'::jsonb,
              purchase_details JSONB NOT NULL DEFAULT '{}'::jsonb,
              last_updated TIMESTAMP NOT NULL,
              created_at TIMESTAMP NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_user_info_hmesh_address ON user_info((hmesh_info->>'hmeshAddress'));
          `);

        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Error initializing database tables:', error);
        throw error;
    } finally {
        client.release();
    }
}

export async function saveEventToQueue(eventData: ArbitrumEventData): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let userAddress = eventData.userInfo?.address || (eventData.args && eventData.args.length > 0 ? eventData.args[0] : null);

        const processedArgs = replaceBigInts(eventData.args);
        const processedUserInfo = replaceBigInts(eventData.userInfo || {});

        const insertEventQuery = `
            INSERT INTO event_queue (
                event_id, 
                transaction_hash, 
                block_number, 
                event_type, 
                args, 
                user_info,
                user_address,
                processed,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW())
            ON CONFLICT (event_id) DO NOTHING
        `;

        const eventResult = await client.query(insertEventQuery, [
            eventData.eventId,
            eventData.transactionHash,
            eventData.blockNumber,
            eventData.event,
            JSON.stringify(processedArgs),
            JSON.stringify(processedUserInfo),
            userAddress
        ]);

        if (eventResult.rowCount! > 0 && userAddress) {
            const userCheckQuery = `SELECT * FROM user_info WHERE eth_address = $1`;
            const userResult = await client.query<UserInfoRow>(userCheckQuery, [userAddress]);

            if (userResult.rowCount === 0) {
                const hmeshWallet = createHMESHWallet();
                const hmeshInfo = {
                    hmeshMnemonic: hmeshWallet.mnemonic,
                    hmeshPublicKey: hmeshWallet.publicKey,
                    hmeshPrivateKey: hmeshWallet.privateKey,
                    hmeshAddress: hmeshWallet.address
                };

                const insertUserQuery = `
                    INSERT INTO user_info (
                        eth_address,
                        hmesh_info,
                        rounds,
                        purchase_details,
                        last_updated,
                        created_at
                    ) VALUES ($1, $2, $3, $4, NOW(), NOW())
                `;

                await client.query(insertUserQuery, [
                    userAddress,
                    JSON.stringify(hmeshInfo),
                    JSON.stringify(replaceBigInts(eventData.userInfo!.rounds || [])),
                    JSON.stringify(replaceBigInts(eventData.userInfo!.purchaseDetails || {}))
                ]);

                console.log(`Created new user with ETH address ${userAddress} and HMESH address ${hmeshWallet.address}`);
            } else {
                const updateUserQuery = `
                    UPDATE user_info
                    SET 
                        rounds = $2,
                        purchase_details = $3,
                        last_updated = NOW()
                    WHERE eth_address = $1
                `;

                await client.query(updateUserQuery, [
                    userAddress,
                    JSON.stringify(replaceBigInts(eventData.userInfo!.rounds || [])),
                    JSON.stringify(replaceBigInts(eventData.userInfo!.purchaseDetails || {}))
                ]);

                console.log(`Updated user info for ETH address ${userAddress}`);
            }
        }

        await client.query('COMMIT');
        console.log(`Event ${eventData.eventId} saved to queue`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error saving event to queue:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * mark event as processed 
 */
export async function markEventAsProcessed(eventId: string): Promise<void> {
    const client = await pool.connect();
    try {
        const updateQuery = `
      UPDATE event_queue 
      SET processed = true, processed_at = NOW() 
      WHERE event_id = $1
    `;

        await client.query(updateQuery, [eventId]);
        console.log(`Event ${eventId} marked as processed`);
    } catch (error) {
        console.error('Error marking event as processed:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get unprocessed events from the queue
 */
export async function getUnprocessedEvents(limit: number = 10): Promise<ArbitrumEventData[]> {
    const client = await pool.connect();
    try {
        const query = `
        SELECT 
          event_id as "eventId", 
          transaction_hash as "transactionHash", 
          block_number as "blockNumber", 
          event_type as "event", 
          args, 
          user_info as "userInfo",
          user_address as "userAddress",
          processed,
          created_at as "createdAt"
        FROM event_queue 
        WHERE processed = false 
        ORDER BY created_at ASC 
        LIMIT $1
      `;

        const result = await client.query<EventQueueRow>(query, [limit]);

        return result.rows.map(row => {
            let parsedArgs = [];
            let parsedUserInfo: any = {
                address: row.userAddress || '',
                rounds: [],
                purchaseDetails: {}
            };

            try {
                parsedArgs = typeof row.args === 'string' ? JSON.parse(row.args) : row.args;
            } catch (e: any) {
                console.warn(`Failed to parse args for event ${row.eventId}: ${e.message}`);
                parsedArgs = typeof row.args === 'object' ? row.args : [];
            }

            try {
                const tempUserInfo = typeof row.userInfo === 'string' ? JSON.parse(row.userInfo) : row.userInfo;

                parsedUserInfo = {
                    address: tempUserInfo.address || row.userAddress || '',
                    rounds: tempUserInfo.rounds || [],
                    purchaseDetails: tempUserInfo.purchaseDetails || {}
                };
            } catch (e: any) {
                console.warn(`Failed to parse userInfo for event ${row.eventId}: ${e.message}`);
            }

            return {
                eventId: row.eventId,
                transactionHash: row.transactionHash,
                blockNumber: typeof row.blockNumber === 'string' ? parseInt(row.blockNumber, 10) : row.blockNumber,
                event: row.event as 'RoundCreated' | 'TokensBought' | 'TokensClaimed',
                args: parsedArgs,
                userInfo: parsedUserInfo,
                processed: row.processed,
                createdAt: row.createdAt
            };
        });
    } catch (error) {
        console.error('Error getting unprocessed events:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get user information by ETH address
 */
export async function getUserInfoByEthAddress(ethAddress: string): Promise<UserInfoRow | null> {
    const client = await pool.connect();
    try {
        const query = `
        SELECT 
          eth_address as "ethAddress",
          hmesh_info as "hmeshInfo",
          rounds,
          purchase_details as "purchaseDetails",
          last_updated as "lastUpdated",
          created_at as "createdAt"
        FROM user_info 
        WHERE eth_address = $1
      `;

        const result = await client.query<UserInfoRow>(query, [ethAddress]);

        if (result.rowCount === 0) {
            return null;
        }

        const user = result.rows[0];

        let hmeshInfo: any = {
            hmeshMnemonic: '',
            hmeshPublicKey: '',
            hmeshPrivateKey: '',
            hmeshAddress: ''
        };

        let rounds = [];
        let purchaseDetails = {};

        try {
            const parsedHmeshInfo = typeof user.hmeshInfo === 'string' ? JSON.parse(user.hmeshInfo) : user.hmeshInfo;
            hmeshInfo = {
                hmeshMnemonic: parsedHmeshInfo.hmeshMnemonic || '',
                hmeshPublicKey: parsedHmeshInfo.hmeshPublicKey || '',
                hmeshPrivateKey: parsedHmeshInfo.hmeshPrivateKey || '',
                hmeshAddress: parsedHmeshInfo.hmeshAddress || ''
            };
        } catch (e: any) {
            console.warn(`Failed to parse hmeshInfo for user ${ethAddress}: ${e.message}`);
        }

        try {
            rounds = typeof user.rounds === 'string' ? JSON.parse(user.rounds) : user.rounds;
        } catch (e: any) {
            console.warn(`Failed to parse rounds for user ${ethAddress}: ${e.message}`);
            rounds = typeof user.rounds === 'object' ? user.rounds : [];
        }

        try {
            purchaseDetails = typeof user.purchaseDetails === 'string'
                ? JSON.parse(user.purchaseDetails)
                : user.purchaseDetails;
        } catch (e: any) {
            console.warn(`Failed to parse purchaseDetails for user ${ethAddress}: ${e.message}`);
            purchaseDetails = typeof user.purchaseDetails === 'object' ? user.purchaseDetails : {};
        }

        return {
            ...user,
            hmeshInfo,
            rounds,
            purchaseDetails
        };
    } catch (error) {
        console.error(`Error getting user info for ${ethAddress}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get user information by HMESH address
 */
export async function getUserInfoByHmeshAddress(hmeshAddress: string): Promise<UserInfoRow | null> {
    const client = await pool.connect();
    try {
        const query = `
        SELECT 
          eth_address as "ethAddress",
          hmesh_info as "hmeshInfo",
          rounds,
          purchase_details as "purchaseDetails",
          last_updated as "lastUpdated",
          created_at as "createdAt"
        FROM user_info 
        WHERE (hmesh_info->>'hmeshAddress') = $1
      `;

        const result = await client.query<UserInfoRow>(query, [hmeshAddress]);

        if (result.rowCount === 0) {
            return null;
        }

        const user = result.rows[0];

        let hmeshInfo: any = {
            hmeshMnemonic: '',
            hmeshPublicKey: '',
            hmeshPrivateKey: '',
            hmeshAddress: hmeshAddress || ''
        };

        let rounds = [];
        let purchaseDetails = {};

        try {
            const parsedHmeshInfo = typeof user.hmeshInfo === 'string' ? JSON.parse(user.hmeshInfo) : user.hmeshInfo;
            hmeshInfo = {
                hmeshMnemonic: parsedHmeshInfo.hmeshMnemonic || '',
                hmeshPublicKey: parsedHmeshInfo.hmeshPublicKey || '',
                hmeshPrivateKey: parsedHmeshInfo.hmeshPrivateKey || '',
                hmeshAddress: parsedHmeshInfo.hmeshAddress || hmeshAddress || ''
            };
        } catch (e: any) {
            console.warn(`Failed to parse hmeshInfo for HMESH address ${hmeshAddress}: ${e.message}`);
        }

        try {
            rounds = typeof user.rounds === 'string' ? JSON.parse(user.rounds) : user.rounds;
        } catch (e: any) {
            console.warn(`Failed to parse rounds for HMESH address ${hmeshAddress}: ${e.message}`);
            rounds = typeof user.rounds === 'object' ? user.rounds : [];
        }

        try {
            purchaseDetails = typeof user.purchaseDetails === 'string'
                ? JSON.parse(user.purchaseDetails)
                : user.purchaseDetails;
        } catch (e: any) {
            console.warn(`Failed to parse purchaseDetails for HMESH address ${hmeshAddress}: ${e.message}`);
            purchaseDetails = typeof user.purchaseDetails === 'object' ? user.purchaseDetails : {};
        }

        return {
            ...user,
            hmeshInfo,
            rounds,
            purchaseDetails
        };
    } catch (error) {
        console.error(`Error getting user info for HMESH address ${hmeshAddress}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get events for a specific user by ETH address
 */
export async function getEventsByUserAddress(
    userAddress: string,
    limit: number = 100
): Promise<ArbitrumEventData[]> {
    const client = await pool.connect();
    try {
        const query = `
        SELECT 
          event_id as "eventId", 
          transaction_hash as "transactionHash", 
          block_number as "blockNumber", 
          event_type as "event", 
          args, 
          user_info as "userInfo",
          user_address as "userAddress",
          processed,
          created_at as "createdAt",
          processed_at as "processedAt"
        FROM event_queue 
        WHERE user_address = $1
        ORDER BY created_at DESC 
        LIMIT $2
      `;

        const result = await client.query<EventQueueRow>(query, [userAddress, limit]);

        return result.rows.map(row => {
            let parsedArgs = [];
            let parsedUserInfo: any = {
                address: row.userAddress || '',
                rounds: [],
                purchaseDetails: {}
            };

            try {
                parsedArgs = typeof row.args === 'string' ? JSON.parse(row.args) : row.args;
            } catch (e: any) {
                console.warn(`Failed to parse args for event ${row.eventId}: ${e.message}`);
                parsedArgs = typeof row.args === 'object' ? row.args : [];
            }

            try {
                const tempUserInfo = typeof row.userInfo === 'string' ? JSON.parse(row.userInfo) : row.userInfo;

                parsedUserInfo = {
                    address: tempUserInfo.address || row.userAddress || '',
                    rounds: tempUserInfo.rounds || [],
                    purchaseDetails: tempUserInfo.purchaseDetails || {}
                };
            } catch (e: any) {
                console.warn(`Failed to parse userInfo for event ${row.eventId}: ${e.message}`);
            }

            return {
                eventId: row.eventId,
                transactionHash: row.transactionHash,
                blockNumber: typeof row.blockNumber === 'string' ? parseInt(row.blockNumber, 10) : row.blockNumber,
                event: row.event as 'RoundCreated' | 'TokensBought' | 'TokensClaimed',
                args: parsedArgs,
                userInfo: parsedUserInfo,
                processed: row.processed,
                createdAt: row.createdAt,
                processedAt: row.processedAt!
            };
        });
    } catch (error) {
        console.error(`Error getting events for user ${userAddress}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

function replaceBigInts(obj: any): any {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj === 'bigint') {
        return obj.toString();
    }

    if (Array.isArray(obj)) {
        return obj.map(replaceBigInts);
    }

    if (typeof obj === 'object') {
        const result: any = {};
        for (const key in obj) {
            result[key] = replaceBigInts(obj[key]);
        }
        return result;
    }

    return obj;
}
