import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { sessionsTable, usersTable } from '../db/schema';
import { validateSession } from '../handlers/validate_session';
import { eq } from 'drizzle-orm';

// Test data setup
const testUser = {
  google_id: 'test-google-id-123',
  email: 'test@example.com',
  name: 'Test User',
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_expiry: new Date(Date.now() + 3600000), // 1 hour from now
};

const validSessionToken = 'valid-session-token-123';
const expiredSessionToken = 'expired-session-token-456';
const inactiveSessionToken = 'inactive-session-token-789';

describe('validateSession', () => {
  beforeEach(createDB);
  afterEach(resetDB);

  it('should return null for empty or invalid tokens', async () => {
    expect(await validateSession('')).toBeNull();
    expect(await validateSession('   ')).toBeNull();
    expect(await validateSession('nonexistent-token')).toBeNull();
  });

  it('should return null for non-string tokens', async () => {
    // @ts-ignore - Testing runtime behavior with invalid input
    expect(await validateSession(null)).toBeNull();
    // @ts-ignore - Testing runtime behavior with invalid input
    expect(await validateSession(undefined)).toBeNull();
  });

  it('should return user context for valid active session', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();
    
    const userId = userResult[0].id;

    // Create active session
    await db.insert(sessionsTable)
      .values({
        user_id: userId,
        session_token: validSessionToken,
        expires_at: new Date(Date.now() + 3600000), // 1 hour from now
        is_active: true,
      })
      .execute();

    const result = await validateSession(validSessionToken);

    expect(result).not.toBeNull();
    expect(result?.userId).toEqual(userId);
    expect(result?.googleId).toEqual('test-google-id-123');
    expect(result?.email).toEqual('test@example.com');
  });

  it('should handle whitespace in session tokens', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();
    
    const userId = userResult[0].id;

    // Create active session
    await db.insert(sessionsTable)
      .values({
        user_id: userId,
        session_token: validSessionToken,
        expires_at: new Date(Date.now() + 3600000),
        is_active: true,
      })
      .execute();

    // Test with leading/trailing whitespace
    const result = await validateSession(`  ${validSessionToken}  `);

    expect(result).not.toBeNull();
    expect(result?.userId).toEqual(userId);
  });

  it('should return null for expired session and deactivate it', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();
    
    const userId = userResult[0].id;

    // Create expired session
    const sessionResult = await db.insert(sessionsTable)
      .values({
        user_id: userId,
        session_token: expiredSessionToken,
        expires_at: new Date(Date.now() - 3600000), // 1 hour ago (expired)
        is_active: true,
      })
      .returning()
      .execute();

    const sessionId = sessionResult[0].id;

    const result = await validateSession(expiredSessionToken);

    // Should return null for expired session
    expect(result).toBeNull();

    // Should deactivate the expired session
    const updatedSessions = await db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .execute();

    expect(updatedSessions).toHaveLength(1);
    expect(updatedSessions[0].is_active).toBe(false);
  });

  it('should return null for inactive session', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();
    
    const userId = userResult[0].id;

    // Create inactive session
    await db.insert(sessionsTable)
      .values({
        user_id: userId,
        session_token: inactiveSessionToken,
        expires_at: new Date(Date.now() + 3600000), // Valid expiry time
        is_active: false, // But inactive
      })
      .execute();

    const result = await validateSession(inactiveSessionToken);

    expect(result).toBeNull();
  });

  it('should return null for session with deleted user', async () => {
    // Create test user first
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();
    
    const userId = userResult[0].id;

    // Create session
    await db.insert(sessionsTable)
      .values({
        user_id: userId,
        session_token: 'orphaned-session-token',
        expires_at: new Date(Date.now() + 3600000),
        is_active: true,
      })
      .execute();

    // Delete the session first, then the user (respecting foreign key constraint)
    await db.delete(sessionsTable)
      .where(eq(sessionsTable.user_id, userId))
      .execute();
    
    await db.delete(usersTable)
      .where(eq(usersTable.id, userId))
      .execute();

    const result = await validateSession('orphaned-session-token');

    expect(result).toBeNull();
  });

  it('should handle multiple valid sessions for same user', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();
    
    const userId = userResult[0].id;

    // Create multiple sessions for same user
    await db.insert(sessionsTable)
      .values([
        {
          user_id: userId,
          session_token: 'session-token-1',
          expires_at: new Date(Date.now() + 3600000),
          is_active: true,
        },
        {
          user_id: userId,
          session_token: 'session-token-2',
          expires_at: new Date(Date.now() + 3600000),
          is_active: true,
        },
      ])
      .execute();

    // Both sessions should work independently
    const result1 = await validateSession('session-token-1');
    const result2 = await validateSession('session-token-2');

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1?.userId).toEqual(userId);
    expect(result2?.userId).toEqual(userId);
    expect(result1!.googleId).toEqual(result2!.googleId);
  });

  it('should validate session with future expiry time correctly', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();
    
    const userId = userResult[0].id;

    // Create session expiring in exactly 1 second
    const nearFutureExpiry = new Date(Date.now() + 1000);
    await db.insert(sessionsTable)
      .values({
        user_id: userId,
        session_token: 'near-expiry-token',
        expires_at: nearFutureExpiry,
        is_active: true,
      })
      .execute();

    const result = await validateSession('near-expiry-token');

    // Should still be valid since it hasn't expired yet
    expect(result).not.toBeNull();
    expect(result?.userId).toEqual(userId);
  });
});