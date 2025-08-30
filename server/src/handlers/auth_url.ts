import { type AuthUrlResponse } from '../schema';

export async function getAuthUrl(): Promise<AuthUrlResponse> {
    try {
        // Google OAuth2 configuration
        const clientId = process.env['GOOGLE_CLIENT_ID'];
        const redirectUri = process.env['GOOGLE_REDIRECT_URI'];
        
        if (!clientId || !redirectUri) {
            throw new Error('Missing required Google OAuth2 configuration');
        }

        // Required scopes for Google Drive and user profile access
        const scopes = [
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ];

        // Build authorization URL with proper parameters
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', scopes.join(' '));
        authUrl.searchParams.set('access_type', 'offline'); // Required for refresh tokens
        authUrl.searchParams.set('prompt', 'consent'); // Forces consent screen to get refresh token
        authUrl.searchParams.set('state', generateSecureState()); // CSRF protection

        return {
            authUrl: authUrl.toString()
        };
    } catch (error) {
        console.error('Auth URL generation failed:', error);
        throw error;
    }
}

// Generate a secure random state parameter for CSRF protection
function generateSecureState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}