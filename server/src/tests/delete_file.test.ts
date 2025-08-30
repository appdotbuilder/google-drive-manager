import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type DeleteFileInput, type UserContext } from '../schema';
import { deleteFile } from '../handlers/delete_file';
import { eq } from 'drizzle-orm';

// Mock environment variables
process.env['GOOGLE_CLIENT_ID'] = 'test-client-id';
process.env['GOOGLE_CLIENT_SECRET'] = 'test-client-secret';

// Test data
const testUser = {
  google_id: 'test-google-id-123',
  email: 'test@example.com',
  name: 'Test User',
  access_token: 'valid-access-token',
  refresh_token: 'refresh-token-123',
  token_expiry: new Date(Date.now() + 3600000), // 1 hour from now
};

const testUserContext: UserContext = {
  userId: 1,
  googleId: 'test-google-id-123',
  email: 'test@example.com',
};

const testInput: DeleteFileInput = {
  fileId: 'test-file-id-123',
};

// Mock Google API responses
const mockFileMetadata = {
  id: 'test-file-id-123',
  name: 'test-document.txt',
  parents: ['parent-folder-id'],
  trashed: false,
  owners: [
    {
      emailAddress: 'test@example.com',
      displayName: 'Test User',
    },
  ],
};

const mockRefreshTokenResponse = {
  access_token: 'new-access-token',
  expires_in: 3600,
  token_type: 'Bearer',
};

// Mock fetch function
const mockFetch = mock();

describe('deleteFile', () => {
  beforeEach(async () => {
    await createDB();
    
    // Insert test user
    await db.insert(usersTable)
      .values(testUser)
      .execute();

    // Reset fetch mock
    mockFetch.mockReset();
    (global as any).fetch = mockFetch;
  });

  afterEach(resetDB);

  it('should delete a file successfully', async () => {
    // Mock file metadata request
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockFileMetadata),
      } as Response)
    );

    // Mock delete request
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
      } as Response)
    );

    const result = await deleteFile(testInput, testUserContext);

    expect(result.success).toBe(true);
    expect(result.message).toContain('test-document.txt');
    expect(result.message).toContain('deleted successfully');

    // Verify API calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
    
    // Check file metadata call
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://www.googleapis.com/drive/v3/files/test-file-id-123?fields=id,name,parents,trashed,owners',
      {
        headers: {
          Authorization: 'Bearer valid-access-token',
        },
      }
    );

    // Check delete call
    expect(mockFetch).toHaveBeenNthCalledWith(2,
      'https://www.googleapis.com/drive/v3/files/test-file-id-123',
      {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer valid-access-token',
        },
      }
    );
  });

  it('should log successful operation in audit logs', async () => {
    // Mock successful API calls
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockFileMetadata),
      } as Response)
    );

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
      } as Response)
    );

    await deleteFile(testInput, testUserContext);

    // Check audit log was created
    const auditLogs = await db.select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.user_id, testUserContext.userId))
      .execute();

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe('delete');
    expect(auditLogs[0].file_id).toBe('test-file-id-123');
    expect(auditLogs[0].file_name).toBe('test-document.txt');
    
    const metadata = JSON.parse(auditLogs[0].metadata!);
    expect(metadata.parents).toEqual(['parent-folder-id']);
    expect(metadata.operation).toBe('move_to_trash');
  });

  it('should refresh access token when expired', async () => {
    // Update user with expired token
    await db.update(usersTable)
      .set({
        token_expiry: new Date(Date.now() - 1000), // 1 second ago
      })
      .where(eq(usersTable.id, testUserContext.userId))
      .execute();

    // Mock token refresh
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockRefreshTokenResponse),
      } as Response)
    );

    // Mock file metadata request
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockFileMetadata),
      } as Response)
    );

    // Mock delete request
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
      } as Response)
    );

    const result = await deleteFile(testInput, testUserContext);

    expect(result.success).toBe(true);

    // Verify token refresh call
    expect(mockFetch).toHaveBeenNthCalledWith(1,
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: expect.any(URLSearchParams),
      }
    );

    // Verify token was updated in database
    const updatedUsers = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, testUserContext.userId))
      .execute();

    expect(updatedUsers[0].access_token).toBe('new-access-token');
    expect(updatedUsers[0].token_expiry > new Date()).toBe(true);
  });

  it('should throw error when file not found', async () => {
    // Mock 404 response
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    );

    await expect(deleteFile(testInput, testUserContext))
      .rejects.toThrow(/file not found/i);

    // Verify error was logged
    const auditLogs = await db.select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.user_id, testUserContext.userId))
      .execute();

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe('delete');
    expect(auditLogs[0].file_id).toBe('test-file-id-123');
    expect(auditLogs[0].file_name).toBe(null);
    
    const metadata = JSON.parse(auditLogs[0].metadata!);
    expect(metadata.operation).toBe('delete_failed');
    expect(metadata.error).toContain('File not found');
  });

  it('should throw error when user does not own file', async () => {
    const unauthorizedFileMetadata = {
      ...mockFileMetadata,
      owners: [
        {
          emailAddress: 'other@example.com',
          displayName: 'Other User',
        },
      ],
    };

    // Mock file metadata request
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(unauthorizedFileMetadata),
      } as Response)
    );

    await expect(deleteFile(testInput, testUserContext))
      .rejects.toThrow(/do not have permission/i);
  });

  it('should handle already trashed files', async () => {
    const trashedFileMetadata = {
      ...mockFileMetadata,
      trashed: true,
    };

    // Mock file metadata request
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(trashedFileMetadata),
      } as Response)
    );

    const result = await deleteFile(testInput, testUserContext);

    expect(result.success).toBe(false);
    expect(result.message).toBe('File is already in trash');

    // Should not make delete request
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should throw error when token refresh fails', async () => {
    // Update user with expired token
    await db.update(usersTable)
      .set({
        token_expiry: new Date(Date.now() - 1000),
      })
      .where(eq(usersTable.id, testUserContext.userId))
      .execute();

    // Mock failed token refresh
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 400,
      } as Response)
    );

    await expect(deleteFile(testInput, testUserContext))
      .rejects.toThrow(/failed to refresh access token/i);
  });

  it('should throw error when user not found', async () => {
    const nonExistentUserContext: UserContext = {
      userId: 999,
      googleId: 'non-existent',
      email: 'nonexistent@example.com',
    };

    await expect(deleteFile(testInput, nonExistentUserContext))
      .rejects.toThrow(/user not found/i);
  });

  it('should throw error when Google Drive delete fails', async () => {
    // Mock file metadata request
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockFileMetadata),
      } as Response)
    );

    // Mock failed delete request
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      } as Response)
    );

    await expect(deleteFile(testInput, testUserContext))
      .rejects.toThrow(/failed to delete file from google drive/i);

    // Verify error was logged
    const auditLogs = await db.select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.user_id, testUserContext.userId))
      .execute();

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe('delete');
    
    const metadata = JSON.parse(auditLogs[0].metadata!);
    expect(metadata.operation).toBe('delete_failed');
  });
});