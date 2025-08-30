import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type OpenWorkspaceDocInput, type UserContext } from '../schema';
import { openWorkspaceDoc } from '../handlers/open_workspace_doc';
import { eq } from 'drizzle-orm';

// Mock fetch globally
const mockFetch = mock();
global.fetch = mockFetch as any;

// Test data
const testUserContext: UserContext = {
  userId: 1,
  googleId: 'google_123',
  email: 'test@example.com'
};

const testInput: OpenWorkspaceDocInput = {
  fileId: 'test-file-id-123'
};

const testUser = {
  google_id: 'google_123',
  email: 'test@example.com',
  name: 'Test User',
  access_token: 'valid_access_token',
  refresh_token: 'valid_refresh_token',
  token_expiry: new Date(Date.now() + 3600000) // 1 hour from now
};

const expiredUser = {
  ...testUser,
  access_token: 'expired_access_token',
  token_expiry: new Date(Date.now() - 3600000) // 1 hour ago
};

describe('openWorkspaceDoc', () => {
  beforeEach(async () => {
    await createDB();
    mockFetch.mockClear();
    
    // Set up environment variables for tests
    process.env['GOOGLE_CLIENT_ID'] = 'test_client_id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'test_client_secret';
  });

  afterEach(resetDB);

  it('should generate URLs for Google Docs document', async () => {
    // Insert test user
    await db.insert(usersTable).values(testUser).execute();

    // Mock Google Drive API response for Docs
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-file-id-123',
        name: 'Test Document',
        mimeType: 'application/vnd.google-apps.document'
      })
    });

    const result = await openWorkspaceDoc(testInput, testUserContext);

    expect(result.editUrl).toEqual('https://docs.google.com/document/d/test-file-id-123/edit');
    expect(result.viewUrl).toEqual('https://docs.google.com/document/d/test-file-id-123/view');

    // Verify API call
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/test-file-id-123?fields=id,name,mimeType',
      {
        headers: {
          'Authorization': 'Bearer valid_access_token',
        },
      }
    );
  });

  it('should generate URLs for Google Sheets spreadsheet', async () => {
    await db.insert(usersTable).values(testUser).execute();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-file-id-123',
        name: 'Test Spreadsheet',
        mimeType: 'application/vnd.google-apps.spreadsheet'
      })
    });

    const result = await openWorkspaceDoc(testInput, testUserContext);

    expect(result.editUrl).toEqual('https://docs.google.com/spreadsheets/d/test-file-id-123/edit');
    expect(result.viewUrl).toEqual('https://docs.google.com/spreadsheets/d/test-file-id-123/view');
  });

  it('should generate URLs for Google Slides presentation', async () => {
    await db.insert(usersTable).values(testUser).execute();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-file-id-123',
        name: 'Test Presentation',
        mimeType: 'application/vnd.google-apps.presentation'
      })
    });

    const result = await openWorkspaceDoc(testInput, testUserContext);

    expect(result.editUrl).toEqual('https://docs.google.com/presentation/d/test-file-id-123/edit');
    expect(result.viewUrl).toEqual('https://docs.google.com/presentation/d/test-file-id-123/view');
  });

  it('should refresh expired access token before making API call', async () => {
    // Insert user with expired token
    await db.insert(usersTable).values(expiredUser).execute();

    // Mock token refresh response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new_access_token',
        expires_in: 3600
      })
    });

    // Mock Google Drive API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-file-id-123',
        name: 'Test Document',
        mimeType: 'application/vnd.google-apps.document'
      })
    });

    const result = await openWorkspaceDoc(testInput, testUserContext);

    // Verify token refresh was called
    expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: expect.any(URLSearchParams),
    });

    // Verify Drive API was called with new token
    expect(mockFetch).toHaveBeenNthCalledWith(2, 
      'https://www.googleapis.com/drive/v3/files/test-file-id-123?fields=id,name,mimeType',
      {
        headers: {
          'Authorization': 'Bearer new_access_token',
        },
      }
    );

    expect(result.editUrl).toEqual('https://docs.google.com/document/d/test-file-id-123/edit');
  });

  it('should log operation in audit logs', async () => {
    await db.insert(usersTable).values(testUser).execute();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-file-id-123',
        name: 'Test Document',
        mimeType: 'application/vnd.google-apps.document'
      })
    });

    await openWorkspaceDoc(testInput, testUserContext);

    // Verify audit log was created
    const auditLogs = await db.select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.user_id, testUserContext.userId))
      .execute();

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toEqual('open');
    expect(auditLogs[0].file_id).toEqual('test-file-id-123');
    expect(auditLogs[0].file_name).toEqual('Test Document');

    const metadata = JSON.parse(auditLogs[0].metadata!);
    expect(metadata.mimeType).toEqual('application/vnd.google-apps.document');
    expect(metadata.workspaceType).toEqual('document');
    expect(metadata.editUrl).toEqual('https://docs.google.com/document/d/test-file-id-123/edit');
  });

  it('should throw error when user not found', async () => {
    // Don't insert user into database

    await expect(openWorkspaceDoc(testInput, testUserContext))
      .rejects.toThrow(/user not found/i);
  });

  it('should throw error when file is not a Workspace document', async () => {
    await db.insert(usersTable).values(testUser).execute();

    // Mock API response with non-Workspace MIME type
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-file-id-123',
        name: 'Regular File',
        mimeType: 'application/pdf'
      })
    });

    await expect(openWorkspaceDoc(testInput, testUserContext))
      .rejects.toThrow(/not a Google Workspace document/i);
  });

  it('should throw error when file not found', async () => {
    await db.insert(usersTable).values(testUser).execute();

    // Mock 404 response from Google Drive API
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });

    await expect(openWorkspaceDoc(testInput, testUserContext))
      .rejects.toThrow(/file with id test-file-id-123 not found/i);
  });

  it('should throw error when access denied to file', async () => {
    await db.insert(usersTable).values(testUser).execute();

    // Mock 403 response from Google Drive API
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden'
    });

    await expect(openWorkspaceDoc(testInput, testUserContext))
      .rejects.toThrow(/access denied to file test-file-id-123/i);
  });

  it('should throw error when token refresh fails', async () => {
    await db.insert(usersTable).values(expiredUser).execute();

    // Mock failed token refresh
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request'
    });

    await expect(openWorkspaceDoc(testInput, testUserContext))
      .rejects.toThrow(/failed to refresh access token/i);
  });

  it('should handle all supported Workspace document types', async () => {
    await db.insert(usersTable).values(testUser).execute();

    const workspaceTypes = [
      { mimeType: 'application/vnd.google-apps.document', expectedType: 'document' },
      { mimeType: 'application/vnd.google-apps.spreadsheet', expectedType: 'spreadsheets' },
      { mimeType: 'application/vnd.google-apps.presentation', expectedType: 'presentation' },
      { mimeType: 'application/vnd.google-apps.form', expectedType: 'forms' },
      { mimeType: 'application/vnd.google-apps.drawing', expectedType: 'drawings' },
      { mimeType: 'application/vnd.google-apps.site', expectedType: 'sites' },
      { mimeType: 'application/vnd.google-apps.jam', expectedType: 'jamboard' },
    ];

    for (const { mimeType, expectedType } of workspaceTypes) {
      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'test-file-id-123',
          name: `Test ${expectedType}`,
          mimeType: mimeType
        })
      });

      const result = await openWorkspaceDoc(testInput, testUserContext);

      expect(result.editUrl).toEqual(`https://docs.google.com/${expectedType}/d/test-file-id-123/edit`);
      expect(result.viewUrl).toEqual(`https://docs.google.com/${expectedType}/d/test-file-id-123/view`);
    }
  });

  it('should update user token in database after refresh', async () => {
    await db.insert(usersTable).values(expiredUser).execute();

    // Mock token refresh response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'refreshed_access_token',
        expires_in: 7200 // 2 hours
      })
    });

    // Mock Google Drive API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'test-file-id-123',
        name: 'Test Document',
        mimeType: 'application/vnd.google-apps.document'
      })
    });

    await openWorkspaceDoc(testInput, testUserContext);

    // Verify user token was updated in database
    const updatedUsers = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, testUserContext.userId))
      .execute();

    expect(updatedUsers).toHaveLength(1);
    expect(updatedUsers[0].access_token).toEqual('refreshed_access_token');
    expect(updatedUsers[0].token_expiry.getTime()).toBeGreaterThan(Date.now());
    expect(updatedUsers[0].updated_at).toBeInstanceOf(Date);
  });
});