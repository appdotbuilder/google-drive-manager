import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type DownloadFileInput, type UserContext } from '../schema';
import { downloadFile } from '../handlers/download_file';
import { eq } from 'drizzle-orm';

// Mock fetch globally
const originalFetch = globalThis.fetch;
let mockFetch: any;

// Test data
const testUserContext: UserContext = {
  userId: 1,
  googleId: 'test-google-id',
  email: 'test@example.com',
};

const testDownloadInput: DownloadFileInput = {
  fileId: 'test-file-id-123',
};

const mockFileMetadata = {
  id: 'test-file-id-123',
  name: 'test-document.txt',
  mimeType: 'text/plain',
  size: '1024',
  webContentLink: 'https://drive.google.com/uc?id=test-file-id-123',
};

const mockGoogleDocMetadata = {
  id: 'test-doc-id-456',
  name: 'test-document',
  mimeType: 'application/vnd.google-apps.document',
  size: null,
};

describe('downloadFile', () => {
  beforeEach(async () => {
    await createDB();
    
    // Create test user with valid tokens
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 1); // Token expires in 1 hour
    
    await db.insert(usersTable)
      .values({
        google_id: testUserContext.googleId,
        email: testUserContext.email,
        name: 'Test User',
        access_token: 'valid-access-token',
        refresh_token: 'valid-refresh-token',
        token_expiry: futureDate,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    // Setup fetch mock
    mockFetch = mock(() => {});
    globalThis.fetch = mockFetch;
  });

  afterEach(async () => {
    await resetDB();
    globalThis.fetch = originalFetch;
  });

  it('should download a regular file successfully', async () => {
    // Mock file metadata response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockFileMetadata,
    });

    // Mock file content download response
    const testContent = 'This is test file content';
    const testBuffer = Buffer.from(testContent, 'utf-8');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => testBuffer.buffer,
    });

    const result = await downloadFile(testDownloadInput, testUserContext);

    // Verify response
    expect(result.name).toEqual('test-document.txt');
    expect(result.mimeType).toEqual('text/plain');
    expect(result.content).toEqual(testBuffer.toString('base64'));
    expect(typeof result.content).toBe('string');

    // Verify fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
    
    // First call should be for metadata
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://www.googleapis.com/drive/v3/files/test-file-id-123?fields=id,name,mimeType,size,webContentLink',
      expect.objectContaining({
        headers: {
          'Authorization': 'Bearer valid-access-token',
        },
      })
    );

    // Second call should be for file content
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://www.googleapis.com/drive/v3/files/test-file-id-123?alt=media',
      expect.objectContaining({
        headers: {
          'Authorization': 'Bearer valid-access-token',
        },
      })
    );
  });

  it('should export Google Workspace documents correctly', async () => {
    // Mock Google Doc metadata response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoogleDocMetadata,
    });

    // Mock exported content response
    const exportedContent = 'Exported document content';
    const exportBuffer = Buffer.from(exportedContent, 'utf-8');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => exportBuffer.buffer,
    });

    const result = await downloadFile(testDownloadInput, testUserContext);

    // Verify response - should be exported as DOCX
    expect(result.name).toEqual('test-document.docx');
    expect(result.mimeType).toEqual('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.content).toEqual(exportBuffer.toString('base64'));

    // Verify export URL was called
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://www.googleapis.com/drive/v3/files/test-file-id-123/export?mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document',
      expect.objectContaining({
        headers: {
          'Authorization': 'Bearer valid-access-token',
        },
      })
    );
  });

  it('should refresh access token when expired', async () => {
    // Update user with expired token
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 1); // Token expired 1 hour ago
    
    await db.update(usersTable)
      .set({
        token_expiry: pastDate,
      })
      .where(eq(usersTable.id, 1))
      .execute();

    // Mock token refresh response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600,
      }),
    });

    // Mock file metadata response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockFileMetadata,
    });

    // Mock file content response
    const testBuffer = Buffer.from('test content', 'utf-8');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => testBuffer.buffer,
    });

    await downloadFile(testDownloadInput, testUserContext);

    // Verify token refresh was called first
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    );

    // Verify new token was used in subsequent calls
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      expect.stringContaining('googleapis.com'),
      expect.objectContaining({
        headers: {
          'Authorization': 'Bearer new-access-token',
        },
      })
    );

    // Verify database was updated with new token
    const updatedUsers = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, 1))
      .execute();
    
    expect(updatedUsers[0].access_token).toEqual('new-access-token');
    expect(updatedUsers[0].token_expiry > new Date()).toBe(true);
  });

  it('should log download operation in audit logs', async () => {
    // Mock responses
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockFileMetadata,
    });

    const testBuffer = Buffer.from('test content', 'utf-8');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => testBuffer.buffer,
    });

    await downloadFile(testDownloadInput, testUserContext);

    // Verify audit log was created
    const auditLogs = await db.select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.user_id, testUserContext.userId))
      .execute();

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toEqual('download');
    expect(auditLogs[0].file_id).toEqual(testDownloadInput.fileId);
    expect(auditLogs[0].file_name).toEqual('test-document.txt');
    
    const metadata = JSON.parse(auditLogs[0].metadata!);
    expect(metadata.mimeType).toEqual('text/plain');
    expect(metadata.size).toEqual(testBuffer.byteLength);
    expect(metadata.originalMimeType).toEqual('text/plain');
  });

  it('should handle file not found error', async () => {
    // Mock 404 response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(downloadFile(testDownloadInput, testUserContext))
      .rejects.toThrow(/file not found/i);
  });

  it('should handle user not found error', async () => {
    const nonExistentUserContext: UserContext = {
      userId: 999,
      googleId: 'non-existent',
      email: 'nonexistent@example.com',
    };

    await expect(downloadFile(testDownloadInput, nonExistentUserContext))
      .rejects.toThrow(/user not found/i);
  });

  it('should handle metadata API failure', async () => {
    // Mock failed metadata response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(downloadFile(testDownloadInput, testUserContext))
      .rejects.toThrow(/failed to get file metadata/i);
  });

  it('should handle download content failure', async () => {
    // Mock successful metadata response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockFileMetadata,
    });

    // Mock failed download response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    await expect(downloadFile(testDownloadInput, testUserContext))
      .rejects.toThrow(/failed to download file content/i);
  });

  it('should handle token refresh failure', async () => {
    // Update user with expired token
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 1);
    
    await db.update(usersTable)
      .set({
        token_expiry: pastDate,
      })
      .where(eq(usersTable.id, 1))
      .execute();

    // Mock failed token refresh response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
    });

    await expect(downloadFile(testDownloadInput, testUserContext))
      .rejects.toThrow(/failed to refresh access token/i);
  });
});