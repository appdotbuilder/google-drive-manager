import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, apiKeysTable } from '../db/schema';
import { type UserContext } from '../schema';
import { type CreateApiKeyInput, createApiKey } from '../handlers/create_api_key';
import { eq } from 'drizzle-orm';

// Test user context
const testUserContext: UserContext = {
    userId: 1,
    googleId: 'google_123',
    email: 'test@example.com'
};

// Test input
const testInput: CreateApiKeyInput = {
    keyName: 'Test API Key'
};

describe('createApiKey', () => {
    beforeEach(async () => {
        await createDB();
        
        // Create a test user first
        await db.insert(usersTable)
            .values({
                google_id: testUserContext.googleId,
                email: testUserContext.email,
                name: 'Test User',
                access_token: 'test_access_token',
                refresh_token: 'test_refresh_token',
                token_expiry: new Date(Date.now() + 3600000) // 1 hour from now
            })
            .execute();
    });
    
    afterEach(resetDB);

    it('should create an API key successfully', async () => {
        const result = await createApiKey(testInput, testUserContext);

        // Verify response structure
        expect(result.apiKey).toBeDefined();
        expect(result.keyName).toEqual('Test API Key');
        expect(result.createdAt).toBeInstanceOf(Date);
        
        // Verify API key format (should start with 'gd_' and be 66 chars total)
        expect(result.apiKey).toMatch(/^gd_[a-f0-9]{64}$/);
        expect(result.apiKey.length).toEqual(67); // 'gd_' (3) + 64 hex chars
    });

    it('should save API key to database correctly', async () => {
        const result = await createApiKey(testInput, testUserContext);

        // Query database to verify storage
        const apiKeys = await db.select()
            .from(apiKeysTable)
            .where(eq(apiKeysTable.api_key, result.apiKey))
            .execute();

        expect(apiKeys).toHaveLength(1);
        
        const savedApiKey = apiKeys[0];
        expect(savedApiKey.user_id).toEqual(testUserContext.userId);
        expect(savedApiKey.key_name).toEqual('Test API Key');
        expect(savedApiKey.api_key).toEqual(result.apiKey);
        expect(savedApiKey.is_active).toEqual(true);
        expect(savedApiKey.created_at).toBeInstanceOf(Date);
        expect(savedApiKey.last_used_at).toBeNull();
    });

    it('should create unique API keys for multiple requests', async () => {
        const result1 = await createApiKey(testInput, testUserContext);
        const result2 = await createApiKey({ keyName: 'Second API Key' }, testUserContext);

        // API keys should be different
        expect(result1.apiKey).not.toEqual(result2.apiKey);
        
        // Both should follow correct format
        expect(result1.apiKey).toMatch(/^gd_[a-f0-9]{64}$/);
        expect(result2.apiKey).toMatch(/^gd_[a-f0-9]{64}$/);

        // Both should be saved in database
        const apiKeys = await db.select()
            .from(apiKeysTable)
            .where(eq(apiKeysTable.user_id, testUserContext.userId))
            .execute();

        expect(apiKeys).toHaveLength(2);
        expect(apiKeys[0].api_key).not.toEqual(apiKeys[1].api_key);
    });

    it('should handle different key names correctly', async () => {
        const inputs = [
            { keyName: 'Production API' },
            { keyName: 'Development Key' },
            { keyName: 'Mobile App Access' }
        ];

        const results = [];
        for (const input of inputs) {
            const result = await createApiKey(input, testUserContext);
            results.push(result);
        }

        // All should have different API keys but correct names
        const apiKeySet = new Set(results.map(r => r.apiKey));
        expect(apiKeySet.size).toEqual(3); // All unique

        // Verify names are preserved
        expect(results[0].keyName).toEqual('Production API');
        expect(results[1].keyName).toEqual('Development Key');
        expect(results[2].keyName).toEqual('Mobile App Access');

        // Verify all are in database
        const savedApiKeys = await db.select()
            .from(apiKeysTable)
            .where(eq(apiKeysTable.user_id, testUserContext.userId))
            .execute();

        expect(savedApiKeys).toHaveLength(3);
        
        const savedNames = savedApiKeys.map(key => key.key_name).sort();
        expect(savedNames).toEqual(['Development Key', 'Mobile App Access', 'Production API']);
    });

    it('should associate API key with correct user', async () => {
        // Create second test user
        await db.insert(usersTable)
            .values({
                google_id: 'google_456',
                email: 'user2@example.com',
                name: 'Test User 2',
                access_token: 'test_access_token_2',
                refresh_token: 'test_refresh_token_2',
                token_expiry: new Date(Date.now() + 3600000)
            })
            .execute();

        const secondUserContext: UserContext = {
            userId: 2,
            googleId: 'google_456',
            email: 'user2@example.com'
        };

        // Create API keys for both users
        const result1 = await createApiKey({ keyName: 'User 1 Key' }, testUserContext);
        const result2 = await createApiKey({ keyName: 'User 2 Key' }, secondUserContext);

        // Verify user 1's API key
        const user1Keys = await db.select()
            .from(apiKeysTable)
            .where(eq(apiKeysTable.user_id, testUserContext.userId))
            .execute();

        expect(user1Keys).toHaveLength(1);
        expect(user1Keys[0].api_key).toEqual(result1.apiKey);
        expect(user1Keys[0].key_name).toEqual('User 1 Key');

        // Verify user 2's API key
        const user2Keys = await db.select()
            .from(apiKeysTable)
            .where(eq(apiKeysTable.user_id, secondUserContext.userId))
            .execute();

        expect(user2Keys).toHaveLength(1);
        expect(user2Keys[0].api_key).toEqual(result2.apiKey);
        expect(user2Keys[0].key_name).toEqual('User 2 Key');
    });

    it('should set default values correctly', async () => {
        const result = await createApiKey(testInput, testUserContext);

        const savedApiKey = await db.select()
            .from(apiKeysTable)
            .where(eq(apiKeysTable.api_key, result.apiKey))
            .execute();

        const apiKey = savedApiKey[0];
        
        // Verify default values
        expect(apiKey.is_active).toEqual(true);
        expect(apiKey.last_used_at).toBeNull();
        expect(apiKey.created_at).toBeInstanceOf(Date);
        
        // Created at should be recent (within last 5 seconds)
        const now = new Date();
        const timeDiff = now.getTime() - apiKey.created_at.getTime();
        expect(timeDiff).toBeLessThan(5000);
    });
});