import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type UploadFileInput, type UserContext } from '../schema';
import { uploadFile } from '../handlers/upload_file';
import { eq } from 'drizzle-orm';

// Mock Google Drive API responses
const mockSuccessfulUploadResponse = {
  id: 'test-file-id-123',
  name: 'test-document.txt',
  mimeType: 'text/plain',
  size: '1024',
  createdTime: '2024-01-15T10:30:00.000Z',
  modifiedTime: '2024-01-15T10:30:00.000Z',
  webViewLink: 'https://drive.google.com/file/d/test-file-id-123/view',
  webContentLink: 'https://drive.google.com/uc?id=test-file-id-123',
  parents: ['parent-folder-id'],
  trashed: false,
  kind: 'drive#file',
};

const mockTokenRefreshResponse = {
  access_token: 'new-access-token-12345',
  expires_in: 3600,
};

// Test data
const testUser = {
  google_id: 'google-user-123',
  email: 'test@example.com',
  name: 'Test User',
  access_token: 'valid-access-token',
  refresh_token: 'refresh-token-123',
  token_expiry: new Date(Date.now() + 3600000), // Valid for 1 hour
};

const expiredTokenUser = {
  google_id: 'google-user-456',
  email: 'expired@example.com',
  name: 'Expired User',
  access_token: 'expired-access-token',
  refresh_token: 'refresh-token-456',
  token_expiry: new Date(Date.now() - 3600000), // Expired 1 hour ago
};

const testInput: UploadFileInput = {
  name: 'test-document.txt',
  mimeType: 'text/plain',
  parentId: 'parent-folder-id',
  content: Buffer.from('Hello, this is test content!').toString('base64'),
};

const testInputWithoutParent: UploadFileInput = {
  name: 'root-file.txt',
  mimeType: 'text/plain',
  content: Buffer.from('Content in root folder').toString('base64'),
};

describe('uploadFile', () => {
  beforeEach(createDB);
  afterEach(resetDB);

  it('should upload file with valid access token', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();

    const userId = userResult[0].id;
    const userContext: UserContext = {
      userId,
      googleId: testUser.google_id,
      email: testUser.email,
    };

    // Mock successful Google Drive upload
    const fetchMock = mock(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockSuccessfulUploadResponse),
      } as any)
    );
    (globalThis as any).fetch = fetchMock;

    const result = await uploadFile(testInput, userContext);

    // Verify response structure
    expect(result.file.id).toBe('test-file-id-123');
    expect(result.file.name).toBe('test-document.txt');
    expect(result.file.mimeType).toBe('text/plain');
    expect(result.file.size).toBe('1024');
    expect(result.file.createdTime).toBeInstanceOf(Date);
    expect(result.file.modifiedTime).toBeInstanceOf(Date);
    expect(result.file.webViewLink).toBe('https://drive.google.com/file/d/test-file-id-123/view');
    expect(result.file.parents).toEqual(['parent-folder-id']);
    expect(result.file.trashed).toBe(false);

    // Verify Google Drive API was called correctly
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBe(1);
    if (calls.length > 0) {
      const [url, options] = calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
      expect(options.method).toBe('POST');
      expect((options.headers as any)['Authorization']).toBe('Bearer valid-access-token');
      expect((options.headers as any)['Content-Type']).toMatch(/multipart\/related; boundary=/);
    }

    // Verify audit log was created
    const auditLogs = await db.select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.user_id, userId))
      .execute();

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe('upload');
    expect(auditLogs[0].file_id).toBe('test-file-id-123');
    expect(auditLogs[0].file_name).toBe('test-document.txt');
    
    const metadata = JSON.parse(auditLogs[0].metadata!);
    expect(metadata.mimeType).toBe('text/plain');
    expect(metadata.size).toBe('1024');
    expect(metadata.parentId).toBe('parent-folder-id');
  });

  it('should upload file without parent folder', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();

    const userId = userResult[0].id;
    const userContext: UserContext = {
      userId,
      googleId: testUser.google_id,
      email: testUser.email,
    };

    // Mock response without parents
    const responseWithoutParents = {
      ...mockSuccessfulUploadResponse,
      parents: undefined,
    };

    const fetchMock = mock(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(responseWithoutParents),
      } as any)
    );
    (globalThis as any).fetch = fetchMock;

    const result = await uploadFile(testInputWithoutParent, userContext);

    expect(result.file.parents).toBeUndefined();

    // Verify request body doesn't include parents
    const calls = fetchMock.mock.calls;
    if (calls.length > 0) {
      const [, options] = calls[0] as unknown as [string, RequestInit];
      const requestBody = options.body as string;
      expect(requestBody).not.toContain('"parents"');
    }
  });

  it('should refresh expired access token before upload', async () => {
    // Create user with expired token
    const userResult = await db.insert(usersTable)
      .values(expiredTokenUser)
      .returning()
      .execute();

    const userId = userResult[0].id;
    const userContext: UserContext = {
      userId,
      googleId: expiredTokenUser.google_id,
      email: expiredTokenUser.email,
    };

    // Mock token refresh and upload calls
    let callCount = 0;
    const fetchMock = mock(() => {
      callCount++;
      if (callCount === 1) {
        // First call: token refresh
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTokenRefreshResponse),
        } as any);
      } else {
        // Second call: file upload
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSuccessfulUploadResponse),
        } as any);
      }
    });
    (globalThis as any).fetch = fetchMock;

    const result = await uploadFile(testInput, userContext);

    // Verify successful upload
    expect(result.file.id).toBe('test-file-id-123');

    // Verify both API calls were made
    expect(fetchMock).toHaveBeenCalledTimes(2);
    
    // First call should be token refresh
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBe(2);
    if (calls.length >= 2) {
      const [refreshUrl, refreshOptions] = calls[0] as unknown as [string, RequestInit];
      expect(refreshUrl).toBe('https://oauth2.googleapis.com/token');
      expect(refreshOptions.method).toBe('POST');
      
      // Second call should be upload with new token
      const [, uploadOptions] = calls[1] as unknown as [string, RequestInit];
      expect((uploadOptions.headers as any)['Authorization']).toBe('Bearer new-access-token-12345');
    }

    // Verify user token was updated in database
    const updatedUsers = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .execute();

    expect(updatedUsers[0].access_token).toBe('new-access-token-12345');
    expect(updatedUsers[0].token_expiry > new Date()).toBe(true);
  });

  it('should handle non-existent user', async () => {
    const userContext: UserContext = {
      userId: 999, // Non-existent user ID
      googleId: 'fake-google-id',
      email: 'fake@example.com',
    };

    await expect(uploadFile(testInput, userContext)).rejects.toThrow(/User not found/i);
  });

  it('should handle token refresh failure', async () => {
    // Create user with expired token
    const userResult = await db.insert(usersTable)
      .values(expiredTokenUser)
      .returning()
      .execute();

    const userContext: UserContext = {
      userId: userResult[0].id,
      googleId: expiredTokenUser.google_id,
      email: expiredTokenUser.email,
    };

    // Mock failed token refresh
    const fetchMock = mock(() => 
      Promise.resolve({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as any)
    );
    (globalThis as any).fetch = fetchMock;

    await expect(uploadFile(testInput, userContext)).rejects.toThrow(/Failed to refresh access token/i);
  });

  it('should handle Google Drive upload failure', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();

    const userContext: UserContext = {
      userId: userResult[0].id,
      googleId: testUser.google_id,
      email: testUser.email,
    };

    // Mock failed upload
    const fetchMock = mock(() => 
      Promise.resolve({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve('Insufficient permissions'),
      } as any)
    );
    (globalThis as any).fetch = fetchMock;

    await expect(uploadFile(testInput, userContext)).rejects.toThrow(/Upload failed: 403 Forbidden/i);
  });

  it('should handle files with null size from Google Drive', async () => {
    // Create test user
    const userResult = await db.insert(usersTable)
      .values(testUser)
      .returning()
      .execute();

    const userContext: UserContext = {
      userId: userResult[0].id,
      googleId: testUser.google_id,
      email: testUser.email,
    };

    // Mock response with null size (like Google Docs)
    const responseWithNullSize = {
      ...mockSuccessfulUploadResponse,
      size: null,
    };

    const fetchMock = mock(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(responseWithNullSize),
      } as any)
    );
    (globalThis as any).fetch = fetchMock;

    const result = await uploadFile(testInput, userContext);

    expect(result.file.size).toBe(null);
  });
});