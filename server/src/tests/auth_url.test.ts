import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { getAuthUrl } from '../handlers/auth_url';

// Test environment variables
const testClientId = 'test_client_id_12345';
const testRedirectUri = 'http://localhost:3000/auth/callback';

describe('getAuthUrl', () => {
    beforeEach(async () => {
        await createDB();
        // Set up test environment variables
        process.env['GOOGLE_CLIENT_ID'] = testClientId;
        process.env['GOOGLE_REDIRECT_URI'] = testRedirectUri;
    });

    afterEach(async () => {
        await resetDB();
        // Clean up environment variables
        delete process.env['GOOGLE_CLIENT_ID'];
        delete process.env['GOOGLE_REDIRECT_URI'];
    });

    it('should generate a valid Google OAuth2 authorization URL', async () => {
        const result = await getAuthUrl();
        
        expect(result.authUrl).toBeDefined();
        expect(typeof result.authUrl).toBe('string');
        
        const url = new URL(result.authUrl);
        expect(url.hostname).toBe('accounts.google.com');
        expect(url.pathname).toBe('/o/oauth2/v2/auth');
    });

    it('should include all required OAuth2 parameters', async () => {
        const result = await getAuthUrl();
        const url = new URL(result.authUrl);
        
        expect(url.searchParams.get('client_id')).toBe(testClientId);
        expect(url.searchParams.get('redirect_uri')).toBe(testRedirectUri);
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('prompt')).toBe('consent');
        expect(url.searchParams.get('state')).toBeDefined();
    });

    it('should include all required Google Drive scopes', async () => {
        const result = await getAuthUrl();
        const url = new URL(result.authUrl);
        
        const scopes = url.searchParams.get('scope')?.split(' ') || [];
        
        expect(scopes).toContain('https://www.googleapis.com/auth/drive');
        expect(scopes).toContain('https://www.googleapis.com/auth/drive.file');
        expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.email');
        expect(scopes).toContain('https://www.googleapis.com/auth/userinfo.profile');
        expect(scopes).toHaveLength(4);
    });

    it('should generate unique state parameters for CSRF protection', async () => {
        const result1 = await getAuthUrl();
        const result2 = await getAuthUrl();
        
        const url1 = new URL(result1.authUrl);
        const url2 = new URL(result2.authUrl);
        
        const state1 = url1.searchParams.get('state');
        const state2 = url2.searchParams.get('state');
        
        expect(state1).toBeDefined();
        expect(state2).toBeDefined();
        expect(state1).not.toBe(state2);
        
        // State should be a hex string of appropriate length (64 chars for 32 bytes)
        expect(state1).toMatch(/^[a-f0-9]{64}$/);
        expect(state2).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should throw error when GOOGLE_CLIENT_ID is missing', async () => {
        delete process.env['GOOGLE_CLIENT_ID'];
        
        await expect(getAuthUrl()).rejects.toThrow(/Missing required Google OAuth2 configuration/i);
    });

    it('should throw error when GOOGLE_REDIRECT_URI is missing', async () => {
        delete process.env['GOOGLE_REDIRECT_URI'];
        
        await expect(getAuthUrl()).rejects.toThrow(/Missing required Google OAuth2 configuration/i);
    });

    it('should generate URL with proper encoding', async () => {
        // Test with special characters in redirect URI
        process.env['GOOGLE_REDIRECT_URI'] = 'http://localhost:3000/auth/callback?test=value&other=123';
        
        const result = await getAuthUrl();
        const url = new URL(result.authUrl);
        
        // URL should be properly encoded
        expect(result.authUrl).toContain(encodeURIComponent('http://localhost:3000/auth/callback?test=value&other=123'));
        expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback?test=value&other=123');
    });

    it('should handle different client ID formats', async () => {
        const complexClientId = '1234567890-abcdefghijklmnop.apps.googleusercontent.com';
        process.env['GOOGLE_CLIENT_ID'] = complexClientId;
        
        const result = await getAuthUrl();
        const url = new URL(result.authUrl);
        
        expect(url.searchParams.get('client_id')).toBe(complexClientId);
    });
});