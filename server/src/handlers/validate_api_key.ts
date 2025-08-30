import { type UserContext } from '../schema';

export async function validateApiKey(apiKey: string): Promise<UserContext | null> {
    // This is a placeholder declaration! Real code should be implemented here.
    // The goal of this handler is to:
    // 1. Look up API key in database
    // 2. Check if key is active and not expired
    // 3. Update last_used_at timestamp
    // 4. Return associated user context or null if invalid
    // This is used for REST API authentication
    return {
        userId: 1,
        googleId: 'placeholder-google-id',
        email: 'user@example.com'
    };
}