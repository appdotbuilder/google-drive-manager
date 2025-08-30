import { db } from '../db';
import { usersTable } from '../db/schema';
import { type UserContext } from '../schema';
import { eq } from 'drizzle-orm';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string; // Optional - Google may rotate refresh tokens
  token_type: string;
}

export async function refreshUserToken(userContext: UserContext): Promise<void> {
  try {
    // Get current user data from database
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userContext.userId))
      .execute();

    if (users.length === 0) {
      throw new Error('User not found');
    }

    const user = users[0];

    // Check if token is expired or will expire within 5 minutes
    const now = new Date();
    const expiryBuffer = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
    
    if (user.token_expiry > expiryBuffer) {
      // Token is still valid, no refresh needed
      return;
    }

    // Refresh the access token using Google OAuth2 API
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    
    const refreshParams = new URLSearchParams({
      client_id: process.env['GOOGLE_CLIENT_ID']!,
      client_secret: process.env['GOOGLE_CLIENT_SECRET']!,
      refresh_token: user.refresh_token,
      grant_type: 'refresh_token'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: refreshParams.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json() as GoogleTokenResponse;

    // Calculate new expiry time
    const newExpiryTime = new Date(now.getTime() + (tokenData.expires_in * 1000));

    // Update user's tokens in database
    const updateData: any = {
      access_token: tokenData.access_token,
      token_expiry: newExpiryTime,
      updated_at: now
    };

    // Handle refresh token rotation if Google provided a new one
    if (tokenData.refresh_token) {
      updateData.refresh_token = tokenData.refresh_token;
    }

    await db.update(usersTable)
      .set(updateData)
      .where(eq(usersTable.id, userContext.userId))
      .execute();

  } catch (error) {
    console.error('Token refresh failed:', error);
    throw error;
  }
}