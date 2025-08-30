import { db } from '../db';
import { sessionsTable, usersTable } from '../db/schema';
import { type UserContext } from '../schema';
import { eq, and } from 'drizzle-orm';

export async function validateSession(sessionToken: string): Promise<UserContext | null> {
  try {
    // Basic token validation
    if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.trim() === '') {
      return null;
    }

    // Query session with user data
    const results = await db.select()
      .from(sessionsTable)
      .innerJoin(usersTable, eq(sessionsTable.user_id, usersTable.id))
      .where(
        and(
          eq(sessionsTable.session_token, sessionToken.trim()),
          eq(sessionsTable.is_active, true)
        )
      )
      .execute();

    if (results.length === 0) {
      return null;
    }

    const { sessions, users } = results[0];

    // Check if session has expired
    const now = new Date();
    if (sessions.expires_at <= now) {
      // Deactivate expired session
      await db.update(sessionsTable)
        .set({ is_active: false })
        .where(eq(sessionsTable.id, sessions.id))
        .execute();
      
      return null;
    }

    // Return user context
    return {
      userId: users.id,
      googleId: users.google_id,
      email: users.email,
    };
  } catch (error) {
    console.error('Session validation failed:', error);
    return null;
  }
}