import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, sessionsTable } from '../db/schema';
import { type GoogleAuthCallback } from '../schema';
import { handleAuthCallback } from '../handlers/auth_callback';
import { eq } from 'drizzle-orm';

// Test input
const testInput: GoogleAuthCallback = {
  code: 'test_auth_code_12345',
  state: 'optional_state_parameter'
};

describe('handleAuthCallback', () => {
  beforeEach(createDB);
  afterEach(resetDB);

  it('should create new user and return auth response', async () => {
    const result = await handleAuthCallback(testInput);

    // Validate response structure
    expect(result.user).toBeDefined();
    expect(result.accessToken).toBeDefined();

    // Validate user fields
    expect(result.user.id).toBeDefined();
    expect(result.user.google_id).toEqual('google_user_testauthcode');
    expect(result.user.email).toEqual('user_testauthcode@example.com');
    expect(result.user.name).toEqual('Test User testauthcode');
    expect(result.user.access_token).toMatch(/^access_token_test_auth_code_12345_\d+$/);
    expect(result.user.refresh_token).toMatch(/^refresh_token_test_auth_code_12345_\d+$/);
    expect(result.user.token_expiry).toBeInstanceOf(Date);
    expect(result.user.created_at).toBeInstanceOf(Date);
    expect(result.user.updated_at).toBeInstanceOf(Date);
    expect(result.accessToken).toMatch(/^jwt_token_user_\d+_\d+$/);
  });

  it('should save new user to database', async () => {
    const result = await handleAuthCallback(testInput);

    // Query user from database
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, result.user.id))
      .execute();

    expect(users).toHaveLength(1);
    const savedUser = users[0];

    expect(savedUser.google_id).toEqual(result.user.google_id);
    expect(savedUser.email).toEqual(result.user.email);
    expect(savedUser.name).toEqual(result.user.name);
    expect(savedUser.access_token).toEqual(result.user.access_token);
    expect(savedUser.refresh_token).toEqual(result.user.refresh_token);
    expect(savedUser.token_expiry).toBeInstanceOf(Date);
    expect(savedUser.created_at).toBeInstanceOf(Date);
    expect(savedUser.updated_at).toBeInstanceOf(Date);
  });

  it('should create session record in database', async () => {
    const result = await handleAuthCallback(testInput);

    // Query session from database
    const sessions = await db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.user_id, result.user.id))
      .execute();

    expect(sessions).toHaveLength(1);
    const session = sessions[0];

    expect(session.user_id).toEqual(result.user.id);
    expect(session.session_token).toEqual(result.accessToken);
    expect(session.expires_at).toBeInstanceOf(Date);
    expect(session.expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(session.is_active).toBe(true);
    expect(session.created_at).toBeInstanceOf(Date);
  });

  it('should update existing user instead of creating duplicate', async () => {
    // First callback - creates user
    const firstResult = await handleAuthCallback(testInput);
    
    // Second callback with same code (simulating same Google ID)
    const secondResult = await handleAuthCallback(testInput);

    // Should return the same user ID (updated, not created)
    expect(secondResult.user.id).toEqual(firstResult.user.id);
    expect(secondResult.user.google_id).toEqual(firstResult.user.google_id);

    // Verify only one user exists in database
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.google_id, firstResult.user.google_id))
      .execute();

    expect(users).toHaveLength(1);

    // Verify tokens were updated
    const updatedUser = users[0];
    expect(updatedUser.access_token).toEqual(secondResult.user.access_token);
    expect(updatedUser.refresh_token).toEqual(secondResult.user.refresh_token);
    expect(updatedUser.updated_at.getTime()).toBeGreaterThan(firstResult.user.updated_at.getTime());
  });

  it('should handle different authorization codes', async () => {
    const firstInput: GoogleAuthCallback = {
      code: 'first_auth_code_123',
      state: 'state1'
    };

    const secondInput: GoogleAuthCallback = {
      code: 'second_auth_code_456',
      state: 'state2'
    };

    const firstResult = await handleAuthCallback(firstInput);
    const secondResult = await handleAuthCallback(secondInput);

    // Should create two different users
    expect(firstResult.user.id).not.toEqual(secondResult.user.id);
    expect(firstResult.user.google_id).not.toEqual(secondResult.user.google_id);
    expect(firstResult.user.email).not.toEqual(secondResult.user.email);

    // Verify both users exist in database
    const allUsers = await db.select().from(usersTable).execute();
    expect(allUsers).toHaveLength(2);

    // Verify both sessions exist
    const allSessions = await db.select().from(sessionsTable).execute();
    expect(allSessions).toHaveLength(2);
  });

  it('should handle callback without optional state parameter', async () => {
    const inputWithoutState: GoogleAuthCallback = {
      code: 'test_code_no_state'
    };

    const result = await handleAuthCallback(inputWithoutState);

    expect(result.user).toBeDefined();
    expect(result.accessToken).toBeDefined();
    expect(result.user.access_token).toMatch(/^access_token_test_code_no_state_\d+$/);
  });

  it('should set appropriate token expiry times', async () => {
    const beforeCall = Date.now();
    const result = await handleAuthCallback(testInput);
    const afterCall = Date.now();

    // Token expiry should be approximately 1 hour from now (3600 seconds)
    const expectedExpiry = beforeCall + 3600 * 1000;
    const tokenExpiryTime = result.user.token_expiry.getTime();

    expect(tokenExpiryTime).toBeGreaterThanOrEqual(expectedExpiry);
    expect(tokenExpiryTime).toBeLessThanOrEqual(afterCall + 3600 * 1000);

    // Session expiry should be approximately 24 hours from now
    const sessions = await db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.user_id, result.user.id))
      .execute();

    const sessionExpiry = sessions[0].expires_at.getTime();
    const expectedSessionExpiry = beforeCall + 24 * 60 * 60 * 1000;

    expect(sessionExpiry).toBeGreaterThanOrEqual(expectedSessionExpiry);
    expect(sessionExpiry).toBeLessThanOrEqual(afterCall + 24 * 60 * 60 * 1000);
  });

  it('should generate unique tokens for different calls', async () => {
    const result1 = await handleAuthCallback({ code: 'code1' });
    const result2 = await handleAuthCallback({ code: 'code2' });

    expect(result1.user.access_token).not.toEqual(result2.user.access_token);
    expect(result1.user.refresh_token).not.toEqual(result2.user.refresh_token);
    expect(result1.accessToken).not.toEqual(result2.accessToken);
  });
});