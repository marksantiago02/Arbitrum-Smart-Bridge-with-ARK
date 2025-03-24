import { Pool } from 'pg';
import dotenv from 'dotenv';
import { createARKWallet } from './ark-client';
import { ArbitrumEventData, UserInfoRow, EventQueueRow } from './types';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
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
              ark_info JSONB NOT NULL,
              rounds JSONB NOT NULL DEFAULT '[]'::jsonb,
              purchase_details JSONB NOT NULL DEFAULT '{}'::jsonb,
              last_updated TIMESTAMP NOT NULL,
              created_at TIMESTAMP NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_user_info_ark_address ON user_info((ark_info->>'arkAddress'));
          `);

        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Error initializing database tables:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * save event to the queue
 */
export async function saveEventToQueue(eventData: ArbitrumEventData): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let userAddress = eventData.userInfo?.address || (eventData.args && eventData.args.length > 0 ? eventData.args[0] : null);

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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (event_id) DO NOTHING
    `;

        const eventResult = await client.query(insertEventQuery, [
            eventData.eventId,
            eventData.transactionHash,
            eventData.blockNumber,
            eventData.event,
            JSON.stringify(eventData.args),
            JSON.stringify(eventData.userInfo || {}),
            userAddress,
            false
        ]);

        if (eventResult.rowCount! > 0 && userAddress) {
            const userCheckQuery = `
            SELECT * FROM user_info WHERE eth_address = $1
            `;
            const userResult = await client.query<UserInfoRow>(userCheckQuery, [userAddress]);
            if (userResult.rowCount === 0) {
                const arkWallet = createARKWallet();

                const arkInfo = {
                    arkMnemonic: arkWallet.mnemonic,
                    arkPublicKey: arkWallet.publicKey,
                    arkPrivateKey: arkWallet.privateKey,
                    arkAddress: arkWallet.address
                }

                const insertUserQuery = `
                INSERT INTO user_info (
                  eth_address,
                  ark_info,
                  rounds,
                  purchase_details,
                  last_updated,
                  created_at
                ) VALUES ($1, $2, $3, $4, NOW(), NOW())
              `;

                await client.query(insertUserQuery, [
                    userAddress,
                    JSON.stringify(arkInfo),
                    JSON.stringify(eventData.userInfo!.rounds || []),
                    JSON.stringify(eventData.userInfo!.purchaseDetails || {})
                ]);

                console.log(`Created new user with ETH address ${userAddress} and ARK address ${arkWallet.address}`);
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
                    JSON.stringify(eventData.userInfo!.rounds || []),
                    JSON.stringify(eventData.userInfo!.purchaseDetails || {})
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

        return result.rows.map(row => ({
            eventId: row.eventId,
            transactionHash: row.transactionHash,
            blockNumber: typeof row.blockNumber === 'string' ? parseInt(row.blockNumber, 10) : row.blockNumber,
            event: row.event,
            args: JSON.parse(row.args),
            userInfo: JSON.parse(row.userInfo),
            userAddress: row.userAddress,
            processed: row.processed,
            createdAt: row.createdAt
        }));
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
          ark_info as "arkInfo",
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

        return {
            ...user,
            arkInfo: typeof user.arkInfo === 'string' ? JSON.parse(user.arkInfo) : user.arkInfo,
            rounds: typeof user.rounds === 'string' ? JSON.parse(user.rounds) : user.rounds,
            purchaseDetails: typeof user.purchaseDetails === 'string'
                ? JSON.parse(user.purchaseDetails)
                : user.purchaseDetails
        };
    } catch (error) {
        console.error(`Error getting user info for ${ethAddress}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get user information by ARK address
 */
export async function getUserInfoByArkAddress(arkAddress: string): Promise<UserInfoRow | null> {
    const client = await pool.connect();
    try {
        const query = `
        SELECT 
          eth_address as "ethAddress",
          ark_info as "arkInfo",
          rounds,
          purchase_details as "purchaseDetails",
          last_updated as "lastUpdated",
          created_at as "createdAt"
        FROM user_info 
        WHERE ark_address = $1
      `;

        const result = await client.query<UserInfoRow>(query, [arkAddress]);

        if (result.rowCount === 0) {
            return null;
        }

        const user = result.rows[0];

        return {
            ...user,
            arkInfo: typeof user.arkInfo === 'string' ? JSON.parse(user.arkInfo) : user.arkInfo,
            rounds: typeof user.rounds === 'string' ? JSON.parse(user.rounds) : user.rounds,
            purchaseDetails: typeof user.purchaseDetails === 'string'
                ? JSON.parse(user.purchaseDetails)
                : user.purchaseDetails
        };
    } catch (error) {
        console.error(`Error getting user info for ARK address ${arkAddress}:`, error);
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

        return result.rows.map(row => ({
            eventId: row.eventId,
            transactionHash: row.transactionHash,
            blockNumber: typeof row.blockNumber === 'string' ? parseInt(row.blockNumber, 10) : row.blockNumber,
            event: row.event,
            args: JSON.parse(row.args),
            userInfo: JSON.parse(row.userInfo),
            userAddress: row.userAddress,
            processed: row.processed,
            createdAt: row.createdAt,
            processedAt: row.processedAt!
        }));
    } catch (error) {
        console.error(`Error getting events for user ${userAddress}:`, error);
        throw error;
    } finally {
        client.release();
    }
}