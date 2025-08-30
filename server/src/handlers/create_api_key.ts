import { db } from '../db';
import { apiKeysTable } from '../db/schema';
import { type UserContext } from '../schema';
import crypto from 'crypto';

export interface CreateApiKeyInput {
    keyName: string;
}

export interface CreateApiKeyResponse {
    apiKey: string;
    keyName: string;
    createdAt: Date;
}

export async function createApiKey(input: CreateApiKeyInput, userContext: UserContext): Promise<CreateApiKeyResponse> {
    try {
        // Generate a secure random API key with prefix
        const randomBytes = crypto.randomBytes(32);
        const apiKey = `gd_${randomBytes.toString('hex')}`;

        // Insert API key record into database
        const result = await db.insert(apiKeysTable)
            .values({
                user_id: userContext.userId,
                key_name: input.keyName,
                api_key: apiKey,
                is_active: true
            })
            .returning()
            .execute();

        const createdApiKey = result[0];

        return {
            apiKey: createdApiKey.api_key,
            keyName: createdApiKey.key_name,
            createdAt: createdApiKey.created_at
        };
    } catch (error) {
        console.error('API key creation failed:', error);
        throw error;
    }
}