import { db } from '../db';
import { usersTable, sessionsTable } from '../db/schema';
import { type GoogleAuthCallback, type AuthCallbackResponse } from '../schema';
import { eq } from 'drizzle-orm';

// Mock Google OAuth and JWT functions for this implementation
// In a real app, these would be actual API calls and JWT generation
const exchangeCodeForTokens = async (code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> => {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Mock token exchange - would be actual Google OAuth API call
  return {
    access_token: `access_token_${code}_${Date.now()}`,
    refresh_token: `refresh_token_${code}_${Date.now()}`,
    expires_in: 3600 // 1 hour
  };
};

const fetchGoogleUserProfile = async (accessToken: string): Promise<{
  id: string;
  email: string;
  name: string;
}> => {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Mock user profile - would be actual Google People API call
  // Extract code from access token to make profiles deterministic for same code
  const codeMatch = accessToken.match(/access_token_(.+?)_\d+/);
  const code = codeMatch ? codeMatch[1] : 'unknown';
  const userId = code.replace(/[^a-zA-Z0-9]/g, ''); // Remove special characters completely
  
  return {
    id: `google_user_${userId}`,
    email: `user_${userId}@example.com`,
    name: `Test User ${userId}`
  };
};

const generateJWT = (userId: number): string => {
  // Mock JWT generation - would use actual JWT library
  return `jwt_token_user_${userId}_${Date.now()}`;
};

export async function handleAuthCallback(input: GoogleAuthCallback): Promise<AuthCallbackResponse> {
  try {
    // 1. Exchange authorization code for access and refresh tokens
    const tokenResponse = await exchangeCodeForTokens(input.code);
    
    // 2. Fetch user profile from Google
    const userProfile = await fetchGoogleUserProfile(tokenResponse.access_token);
    
    // Calculate token expiry
    const tokenExpiry = new Date(Date.now() + tokenResponse.expires_in * 1000);
    
    // 3. Store or update user in database
    let user;
    
    // Check if user already exists
    const existingUsers = await db.select()
      .from(usersTable)
      .where(eq(usersTable.google_id, userProfile.id))
      .execute();
    
    if (existingUsers.length > 0) {
      // Update existing user
      const updateResult = await db.update(usersTable)
        .set({
          email: userProfile.email,
          name: userProfile.name,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          token_expiry: tokenExpiry,
          updated_at: new Date()
        })
        .where(eq(usersTable.google_id, userProfile.id))
        .returning()
        .execute();
      
      user = updateResult[0];
    } else {
      // Create new user
      const insertResult = await db.insert(usersTable)
        .values({
          google_id: userProfile.id,
          email: userProfile.email,
          name: userProfile.name,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          token_expiry: tokenExpiry
        })
        .returning()
        .execute();
      
      user = insertResult[0];
    }
    
    // 4. Generate JWT session token for API access
    const jwtToken = generateJWT(user.id);
    
    // Create session record
    const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await db.insert(sessionsTable)
      .values({
        user_id: user.id,
        session_token: jwtToken,
        expires_at: sessionExpiry
      })
      .execute();
    
    // 5. Return user data and session token
    return {
      user: {
        id: user.id,
        google_id: user.google_id,
        email: user.email,
        name: user.name,
        access_token: user.access_token,
        refresh_token: user.refresh_token,
        token_expiry: user.token_expiry,
        created_at: user.created_at,
        updated_at: user.updated_at
      },
      accessToken: jwtToken
    };
  } catch (error) {
    console.error('Auth callback failed:', error);
    throw error;
  }
}