import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type ListFilesInput, type FileListResponse, type UserContext, type GoogleDriveFile } from '../schema';
import { eq } from 'drizzle-orm';

interface GoogleDriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
  trashed?: boolean;
  kind?: string;
}

interface GoogleDriveApiResponse {
  files: GoogleDriveApiFile[];
  nextPageToken?: string;
}

async function refreshAccessTokenIfNeeded(userId: number): Promise<string> {
  const users = await db.select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .execute();
  
  if (users.length === 0) {
    throw new Error('User not found');
  }
  
  const user = users[0];
  const now = new Date();
  
  // Check if token is expired (with 5 minute buffer)
  const tokenExpiryWithBuffer = new Date(user.token_expiry.getTime() - 5 * 60 * 1000);
  
  if (now < tokenExpiryWithBuffer) {
    return user.access_token;
  }
  
  // Refresh the token
  const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env['GOOGLE_CLIENT_ID']!,
      client_secret: process.env['GOOGLE_CLIENT_SECRET']!,
      refresh_token: user.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  
  if (!refreshResponse.ok) {
    throw new Error('Failed to refresh access token');
  }
  
  const refreshData = await refreshResponse.json() as { access_token: string; expires_in: number };
  const newExpiryTime = new Date(now.getTime() + (refreshData.expires_in * 1000));
  
  // Update user's access token
  await db.update(usersTable)
    .set({
      access_token: refreshData.access_token,
      token_expiry: newExpiryTime,
      updated_at: now,
    })
    .where(eq(usersTable.id, userId))
    .execute();
  
  return refreshData.access_token;
}

function buildGoogleDriveQuery(input: ListFilesInput): string {
  const queryParts: string[] = [];
  
  // Add folder filter if specified
  if (input.folderId) {
    queryParts.push(`'${input.folderId}' in parents`);
  }
  
  // Add search query if specified
  if (input.query) {
    queryParts.push(`name contains '${input.query}'`);
  }
  
  // Exclude trashed files by default
  queryParts.push('trashed = false');
  
  return queryParts.join(' and ');
}

function transformGoogleDriveFile(apiFile: GoogleDriveApiFile): GoogleDriveFile {
  return {
    id: apiFile.id,
    name: apiFile.name,
    mimeType: apiFile.mimeType,
    size: apiFile.size || null,
    createdTime: new Date(apiFile.createdTime),
    modifiedTime: new Date(apiFile.modifiedTime),
    webViewLink: apiFile.webViewLink || null,
    webContentLink: apiFile.webContentLink || null,
    parents: apiFile.parents,
    trashed: apiFile.trashed,
    kind: apiFile.kind,
  };
}

async function logAuditOperation(userContext: UserContext, input: ListFilesInput): Promise<void> {
  try {
    await db.insert(auditLogsTable)
      .values({
        user_id: userContext.userId,
        action: 'list',
        file_id: null,
        file_name: null,
        metadata: JSON.stringify({
          folderId: input.folderId,
          query: input.query,
          pageSize: input.pageSize,
        }),
        ip_address: null,
        user_agent: null,
      })
      .execute();
  } catch (error) {
    console.error('Failed to log audit operation:', error);
    // Don't throw - audit logging failures shouldn't break the main operation
  }
}

export async function listFiles(input: ListFilesInput, userContext: UserContext): Promise<FileListResponse> {
  try {
    // 1. Refresh user's Google access token if needed
    const accessToken = await refreshAccessTokenIfNeeded(userContext.userId);
    
    // 2. Build Google Drive API query
    const query = buildGoogleDriveQuery(input);
    
    // 3. Prepare API request parameters
    const params = new URLSearchParams({
      q: query,
      pageSize: input.pageSize.toString(),
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,parents,trashed,kind)',
      orderBy: 'modifiedTime desc',
    });
    
    if (input.pageToken) {
      params.append('pageToken', input.pageToken);
    }
    
    // 4. Call Google Drive API
    const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!driveResponse.ok) {
      const error = await driveResponse.text();
      console.error('Google Drive API error:', error);
      throw new Error(`Google Drive API request failed: ${driveResponse.status}`);
    }
    
    const driveData = await driveResponse.json() as GoogleDriveApiResponse;
    
    // 5. Transform Google Drive API response to match our schema
    const transformedFiles = driveData.files.map(transformGoogleDriveFile);
    
    // 6. Log the operation in audit logs
    await logAuditOperation(userContext, input);
    
    return {
      files: transformedFiles,
      nextPageToken: driveData.nextPageToken,
    };
  } catch (error) {
    console.error('List files operation failed:', error);
    throw error;
  }
}