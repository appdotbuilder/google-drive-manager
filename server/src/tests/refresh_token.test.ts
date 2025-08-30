import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable } from '../db/schema';
import { type UserContext } from '../schema';
import { refreshUserToken } from '../handlers/refresh_token';
import { eq } from 'drizzle-orm';

// Mock fetch for testing
const mockFetch = jest.fn() as any;
(global as any).fetch = mockFetch;

// Mock environment variables
process.env['GOOGLE_CLIENT_ID'] = 'test_client_id';
process.env['GOOGLE_CLIENT_SECRET'] = 'test_client_secret';

const testUserContext: UserContext = {
  userId: 1,
  googleId: 'google123',
  email: 'test@example.com'
};

const createTestUser = async (tokenExpiry: Date) => {
  await db.insert(usersTable)
    .values({
      google_id: 'google123',
      email: 'test@example.com',
      name: 'Test User',
      access_token: 'old_access_token',
      refresh_token: 'valid_refresh_token',
      token_expiry: tokenExpiry,
      created_at: new Date(),
      updated_at: new Date()
    })
    .execute();
};

describe('refreshUserToken', () => {
  beforeEach(async () => {
    await createDB();
    mockFetch.mockClear();
  });

  afterEach(resetDB);

  it('should skip refresh when token is still valid', async () => {
    // Create user with token expiring in 1 hour
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await createTestUser(futureExpiry);

    await refreshUserToken(testUserContext);

    // Verify no HTTP requests were made
    expect(mockFetch).not.toHaveBeenCalled();

    // Verify user data unchanged
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, 1))
      .execute();

    expect(users[0].access_token).toEqual('old_access_token');
    expect(users[0].refresh_token).toEqual('valid_refresh_token');
  });

  it('should refresh expired token successfully', async () => {
    // Create user with expired token
    const pastExpiry = new Date(Date.now() - 60 * 60 * 1000);
    await createTestUser(pastExpiry);

    // Mock successful token refresh response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new_access_token',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    });

    await refreshUserToken(testUserContext);

    // Verify correct API call was made
    expect(mockFetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: expect.stringContaining('refresh_token=valid_refresh_token')
      })
    );

    // Verify user data was updated
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, 1))
      .execute();

    expect(users[0].access_token).toEqual('new_access_token');
    expect(users[0].refresh_token).toEqual('valid_refresh_token'); // Should remain same
    expect(users[0].token_expiry).toBeInstanceOf(Date);
    expect(users[0].token_expiry.getTime()).toBeGreaterThan(Date.now());
    expect(users[0].updated_at).toBeInstanceOf(Date);
  });

  it('should handle refresh token rotation', async () => {
    // Create user with token expiring soon
    const soonExpiry = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes
    await createTestUser(soonExpiry);

    // Mock response with new refresh token
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new_access_token',
        expires_in: 3600,
        refresh_token: 'new_refresh_token',
        token_type: 'Bearer'
      })
    });

    await refreshUserToken(testUserContext);

    // Verify both tokens were updated
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, 1))
      .execute();

    expect(users[0].access_token).toEqual('new_access_token');
    expect(users[0].refresh_token).toEqual('new_refresh_token');
  });

  it('should refresh token when expiring within 5 minutes', async () => {
    // Create user with token expiring in 3 minutes
    const soonExpiry = new Date(Date.now() + 3 * 60 * 1000);
    await createTestUser(soonExpiry);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'refreshed_token',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    });

    await refreshUserToken(testUserContext);

    expect(mockFetch).toHaveBeenCalled();

    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, 1))
      .execute();

    expect(users[0].access_token).toEqual('refreshed_token');
  });

  it('should throw error when user not found', async () => {
    const nonExistentContext: UserContext = {
      userId: 999,
      googleId: 'nonexistent',
      email: 'nonexistent@example.com'
    };

    await expect(refreshUserToken(nonExistentContext)).rejects.toThrow(/user not found/i);
  });

  it('should throw error when token refresh fails', async () => {
    const pastExpiry = new Date(Date.now() - 60 * 60 * 1000);
    await createTestUser(pastExpiry);

    // Mock failed token refresh response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid refresh token'
    });

    await expect(refreshUserToken(testUserContext)).rejects.toThrow(/token refresh failed/i);
  });

  it('should include correct request parameters', async () => {
    const pastExpiry = new Date(Date.now() - 60 * 60 * 1000);
    await createTestUser(pastExpiry);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new_token',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    });

    await refreshUserToken(testUserContext);

    const callArgs = mockFetch.mock.calls[0];
    const requestBody = callArgs[1].body;

    // Verify all required parameters are included
    expect(requestBody).toContain('client_id=test_client_id');
    expect(requestBody).toContain('client_secret=test_client_secret');
    expect(requestBody).toContain('refresh_token=valid_refresh_token');
    expect(requestBody).toContain('grant_type=refresh_token');
  });

  it('should calculate expiry time correctly', async () => {
    const pastExpiry = new Date(Date.now() - 60 * 60 * 1000);
    await createTestUser(pastExpiry);

    const testStartTime = Date.now();
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new_token',
        expires_in: 7200, // 2 hours
        token_type: 'Bearer'
      })
    });

    await refreshUserToken(testUserContext);

    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, 1))
      .execute();

    const expectedExpiryTime = testStartTime + (7200 * 1000);
    const actualExpiryTime = users[0].token_expiry.getTime();
    
    // Allow for small timing differences (within 1 second)
    expect(Math.abs(actualExpiryTime - expectedExpiryTime)).toBeLessThan(1000);
  });
});