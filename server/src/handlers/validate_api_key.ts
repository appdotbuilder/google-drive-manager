import { db } from '../db';
import { apiKeysTable, usersTable } from '../db/schema';
import { type UserContext } from '../schema';
import { eq, and } from 'drizzle-orm';

export async function validateApiKey(apiKey: string): Promise<UserContext | null> {
  try {
    // Look up API key in database with associated user data
    const results = await db.select()
      .from(apiKeysTable)
      .innerJoin(usersTable, eq(apiKeysTable.user_id, usersTable.id))
      .where(
        and(
          eq(apiKeysTable.api_key, apiKey),
          eq(apiKeysTable.is_active, true)
        )
      )
      .execute();

    if (results.length === 0) {
      return null; // API key not found or inactive
    }

    const result = results[0];
    const apiKeyData = result.api_keys;
    const userData = result.users;

    // Update last_used_at timestamp
    await db.update(apiKeysTable)
      .set({
        last_used_at: new Date()
      })
      .where(eq(apiKeysTable.id, apiKeyData.id))
      .execute();

    // Return user context
    return {
      userId: userData.id,
      googleId: userData.google_id,
      email: userData.email
    };
  } catch (error) {
    console.error('API key validation failed:', error);
    throw error;
  }
}