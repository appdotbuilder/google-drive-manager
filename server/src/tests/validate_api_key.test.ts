import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, apiKeysTable } from '../db/schema';
import { validateApiKey } from '../handlers/validate_api_key';
import { eq } from 'drizzle-orm';

describe('validateApiKey', () => {
  beforeEach(createDB);
  afterEach(resetDB);

  it('should return user context for valid active API key', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values({
        google_id: 'test-google-id',
        email: 'test@example.com',
        name: 'Test User',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expiry: new Date(Date.now() + 3600 * 1000), // 1 hour from now
      })
      .returning()
      .execute();

    const user = userResult[0];

    // Create test API key
    await db.insert(apiKeysTable)
      .values({
        user_id: user.id,
        key_name: 'Test API Key',
        api_key: 'valid-api-key-123',
        is_active: true,
      })
      .execute();

    // Test validation
    const result = await validateApiKey('valid-api-key-123');

    expect(result).not.toBeNull();
    expect(result!.userId).toEqual(user.id);
    expect(result!.googleId).toEqual('test-google-id');
    expect(result!.email).toEqual('test@example.com');
  });

  it('should return null for non-existent API key', async () => {
    const result = await validateApiKey('non-existent-key');
    expect(result).toBeNull();
  });

  it('should return null for inactive API key', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values({
        google_id: 'test-google-id',
        email: 'test@example.com',
        name: 'Test User',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expiry: new Date(Date.now() + 3600 * 1000),
      })
      .returning()
      .execute();

    const user = userResult[0];

    // Create inactive API key
    await db.insert(apiKeysTable)
      .values({
        user_id: user.id,
        key_name: 'Inactive API Key',
        api_key: 'inactive-api-key-123',
        is_active: false,
      })
      .execute();

    // Test validation
    const result = await validateApiKey('inactive-api-key-123');
    expect(result).toBeNull();
  });

  it('should update last_used_at timestamp when validating key', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values({
        google_id: 'test-google-id',
        email: 'test@example.com',
        name: 'Test User',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expiry: new Date(Date.now() + 3600 * 1000),
      })
      .returning()
      .execute();

    const user = userResult[0];

    // Create API key with initial timestamp
    const initialTime = new Date('2023-01-01T00:00:00Z');
    const apiKeyResult = await db.insert(apiKeysTable)
      .values({
        user_id: user.id,
        key_name: 'Test API Key',
        api_key: 'timestamp-test-key',
        is_active: true,
        last_used_at: initialTime,
      })
      .returning()
      .execute();

    const apiKey = apiKeyResult[0];

    // Validate the API key
    await validateApiKey('timestamp-test-key');

    // Check that last_used_at was updated
    const updatedApiKeys = await db.select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, apiKey.id))
      .execute();

    const updatedApiKey = updatedApiKeys[0];
    expect(updatedApiKey.last_used_at).not.toBeNull();
    expect(updatedApiKey.last_used_at!.getTime()).toBeGreaterThan(initialTime.getTime());
  });

  it('should handle multiple API keys for same user correctly', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values({
        google_id: 'test-google-id',
        email: 'test@example.com',
        name: 'Test User',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expiry: new Date(Date.now() + 3600 * 1000),
      })
      .returning()
      .execute();

    const user = userResult[0];

    // Create multiple API keys for the same user
    await db.insert(apiKeysTable)
      .values([
        {
          user_id: user.id,
          key_name: 'Key 1',
          api_key: 'key-1',
          is_active: true,
        },
        {
          user_id: user.id,
          key_name: 'Key 2',
          api_key: 'key-2',
          is_active: true,
        },
        {
          user_id: user.id,
          key_name: 'Key 3',
          api_key: 'key-3',
          is_active: false,
        },
      ])
      .execute();

    // Test that each key returns the same user context
    const result1 = await validateApiKey('key-1');
    const result2 = await validateApiKey('key-2');
    const result3 = await validateApiKey('key-3'); // inactive

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result3).toBeNull();

    expect(result1!.userId).toEqual(user.id);
    expect(result2!.userId).toEqual(user.id);
    expect(result1!.email).toEqual(result2!.email);
    expect(result1!.googleId).toEqual(result2!.googleId);
  });

  it('should handle empty string API key', async () => {
    const result = await validateApiKey('');
    expect(result).toBeNull();
  });

  it('should handle whitespace-only API key', async () => {
    const result = await validateApiKey('   ');
    expect(result).toBeNull();
  });
});