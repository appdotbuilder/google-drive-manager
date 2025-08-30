import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { resetDB, createDB } from '../helpers';
import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type ListFilesInput, type UserContext } from '../schema';
import { listFiles } from '../handlers/list_files';
import { eq } from 'drizzle-orm';

// Mock fetch globally
const mockFetch = mock();
(global as any).fetch = mockFetch;

// Test data
const testUserContext: UserContext = {
  userId: 1,
  googleId: 'test-google-id',
  email: 'test@example.com',
};

const validUser = {
  google_id: 'test-google-id',
  email: 'test@example.com',
  name: 'Test User',
  access_token: 'valid-access-token',
  refresh_token: 'valid-refresh-token',
  token_expiry: new Date(Date.now() + 3600000), // 1 hour from now
};

const testInput: ListFilesInput = {
  folderId: 'test-folder-id',
  pageToken: 'next-page-token',
  pageSize: 50,
  query: 'test query',
};

const mockGoogleDriveResponse = {
  files: [
    {
      id: 'file-1',
      name: 'Test Document.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: '1024',
      createdTime: '2024-01-01T10:00:00.000Z',
      modifiedTime: '2024-01-02T12:00:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/file-1/view',
      webContentLink: 'https://drive.google.com/uc?id=file-1',
      parents: ['parent-folder-1'],
      trashed: false,
      kind: 'drive#file',
    },
    {
      id: 'file-2',
      name: 'Test Folder',
      mimeType: 'application/vnd.google-apps.folder',
      createdTime: '2024-01-01T09:00:00.000Z',
      modifiedTime: '2024-01-01T09:00:00.000Z',
      webViewLink: 'https://drive.google.com/drive/folders/file-2',
      parents: ['parent-folder-1'],
      trashed: false,
      kind: 'drive#file',
    },
  ],
  nextPageToken: 'next-token-123',
};

describe('listFiles', () => {
  beforeEach(async () => {
    await createDB();
    mockFetch.mockClear();
    
    // Create test user
    await db.insert(usersTable)
      .values(validUser)
      .execute();
  });
  
  afterEach(resetDB);

  it('should list files successfully with valid token', async () => {
    // Mock successful Google Drive API response
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockGoogleDriveResponse),
    });

    const result = await listFiles(testInput, testUserContext);

    // Verify API call was made with correct parameters
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    const [url, options] = fetchCall;
    expect(url).toMatch(/https:\/\/www\.googleapis\.com\/drive\/v3\/files/);
    expect(url).toContain('pageSize=50');
    expect(url).toContain('pageToken=next-page-token');
    expect(url).toContain('test-folder-id');
    expect(options.headers.Authorization).toBe('Bearer valid-access-token');

    // Verify response structure
    expect(result.files).toHaveLength(2);
    expect(result.nextPageToken).toBe('next-token-123');

    // Verify file transformation
    const file1 = result.files[0];
    expect(file1.id).toBe('file-1');
    expect(file1.name).toBe('Test Document.docx');
    expect(file1.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(file1.size).toBe('1024');
    expect(file1.createdTime).toBeInstanceOf(Date);
    expect(file1.modifiedTime).toBeInstanceOf(Date);
    expect(file1.webViewLink).toBe('https://drive.google.com/file/d/file-1/view');
    expect(file1.parents).toEqual(['parent-folder-1']);
    expect(file1.trashed).toBe(false);

    const file2 = result.files[1];
    expect(file2.id).toBe('file-2');
    expect(file2.name).toBe('Test Folder');
    expect(file2.mimeType).toBe('application/vnd.google-apps.folder');
    expect(file2.size).toBeNull();
  });

  it('should refresh access token when expired', async () => {
    // Update user with expired token
    await db.update(usersTable)
      .set({
        access_token: 'expired-token',
        token_expiry: new Date(Date.now() - 3600000), // 1 hour ago
      })
      .where(eq(usersTable.id, 1))
      .execute();

    // Mock token refresh response
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-access-token',
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGoogleDriveResponse),
      });

    const result = await listFiles(testInput, testUserContext);

    // Verify token refresh was called
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [refreshUrl, refreshOptions] = mockFetch.mock.calls[0];
    expect(refreshUrl).toBe('https://oauth2.googleapis.com/token');
    expect(refreshOptions.method).toBe('POST');

    // Verify Drive API was called with new token
    const [driveUrl, driveOptions] = mockFetch.mock.calls[1];
    expect(driveOptions.headers.Authorization).toBe('Bearer new-access-token');

    // Verify user token was updated in database
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, 1))
      .execute();
    
    expect(users[0].access_token).toBe('new-access-token');
    expect(users[0].token_expiry > new Date()).toBe(true);

    expect(result.files).toHaveLength(2);
  });

  it('should handle minimal input parameters', async () => {
    const minimalInput: ListFilesInput = {
      pageSize: 100, // Default will be applied by Zod
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        files: [],
        nextPageToken: undefined,
      }),
    });

    const result = await listFiles(minimalInput, testUserContext);

    // Verify query parameters
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('pageSize=100');
    expect(url).toContain('trashed'); // Query contains trashed parameter
    expect(url).not.toContain('pageToken');

    expect(result.files).toHaveLength(0);
    expect(result.nextPageToken).toBeUndefined();
  });

  it('should create audit log entry', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    });

    await listFiles(testInput, testUserContext);

    // Verify audit log was created
    const auditLogs = await db.select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.user_id, 1))
      .execute();

    expect(auditLogs).toHaveLength(1);
    const log = auditLogs[0];
    expect(log.action).toBe('list');
    expect(log.file_id).toBeNull();
    expect(log.file_name).toBeNull();
    expect(log.user_id).toBe(1);
    
    const metadata = JSON.parse(log.metadata!);
    expect(metadata.folderId).toBe('test-folder-id');
    expect(metadata.query).toBe('test query');
    expect(metadata.pageSize).toBe(50);
  });

  it('should handle Google Drive API errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });

    await expect(listFiles(testInput, testUserContext))
      .rejects.toThrow(/Google Drive API request failed: 403/);
  });

  it('should handle token refresh failures', async () => {
    // Update user with expired token
    await db.update(usersTable)
      .set({
        token_expiry: new Date(Date.now() - 3600000), // 1 hour ago
      })
      .where(eq(usersTable.id, 1))
      .execute();

    // Mock failed token refresh
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    });

    await expect(listFiles(testInput, testUserContext))
      .rejects.toThrow(/Failed to refresh access token/);
  });

  it('should handle non-existent user', async () => {
    const nonExistentUserContext: UserContext = {
      userId: 999,
      googleId: 'non-existent',
      email: 'nonexistent@example.com',
    };

    await expect(listFiles(testInput, nonExistentUserContext))
      .rejects.toThrow(/User not found/);
  });

  it('should build query correctly for different input combinations', async () => {
    const testCases = [
      {
        input: { pageSize: 100 },
        expectedQuery: 'trashed = false',
      },
      {
        input: { folderId: 'folder123', pageSize: 100 },
        expectedQuery: "'folder123' in parents and trashed = false",
      },
      {
        input: { query: 'search term', pageSize: 100 },
        expectedQuery: "name contains 'search term' and trashed = false",
      },
      {
        input: { folderId: 'folder123', query: 'search term', pageSize: 100 },
        expectedQuery: "'folder123' in parents and name contains 'search term' and trashed = false",
      },
    ];

    for (const testCase of testCases) {
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ files: [] }),
      });

      await listFiles(testCase.input as ListFilesInput, testUserContext);

      const [url] = mockFetch.mock.calls[0];
      const urlObj = new URL(url);
      const actualQuery = decodeURIComponent(urlObj.searchParams.get('q') || '');
      expect(actualQuery).toBe(testCase.expectedQuery);
    }
  });

  it('should handle files with missing optional fields', async () => {
    const minimalFileResponse = {
      files: [
        {
          id: 'minimal-file',
          name: 'Minimal File',
          mimeType: 'text/plain',
          createdTime: '2024-01-01T10:00:00.000Z',
          modifiedTime: '2024-01-02T12:00:00.000Z',
        },
      ],
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(minimalFileResponse),
    });

    const result = await listFiles(testInput, testUserContext);

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.id).toBe('minimal-file');
    expect(file.name).toBe('Minimal File');
    expect(file.size).toBeNull();
    expect(file.webViewLink).toBeNull();
    expect(file.webContentLink).toBeNull();
    expect(file.parents).toBeUndefined();
    expect(file.trashed).toBeUndefined();
    expect(file.kind).toBeUndefined();
  });
});