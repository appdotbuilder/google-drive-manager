import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type OpenWorkspaceDocInput, type WorkspaceDocUrlResponse, type UserContext } from '../schema';
import { eq } from 'drizzle-orm';

// Google Workspace MIME types mapping
const WORKSPACE_MIME_TYPES = {
  'application/vnd.google-apps.document': 'document',
  'application/vnd.google-apps.spreadsheet': 'spreadsheets',
  'application/vnd.google-apps.presentation': 'presentation',
  'application/vnd.google-apps.form': 'forms',
  'application/vnd.google-apps.drawing': 'drawings',
  'application/vnd.google-apps.site': 'sites',
  'application/vnd.google-apps.jam': 'jamboard',
} as const;

type WorkspaceType = typeof WORKSPACE_MIME_TYPES[keyof typeof WORKSPACE_MIME_TYPES];

export async function openWorkspaceDoc(input: OpenWorkspaceDocInput, userContext: UserContext): Promise<WorkspaceDocUrlResponse> {
  try {
    // 1. Get user's current access token from database
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userContext.userId))
      .execute();

    if (users.length === 0) {
      throw new Error('User not found');
    }

    const user = users[0];
    let accessToken = user.access_token;

    // 2. Check if access token needs refresh
    const now = new Date();
    if (user.token_expiry <= now) {
      accessToken = await refreshAccessToken(user.refresh_token, userContext.userId);
    }

    // 3. Get file metadata from Google Drive API
    const fileMetadata = await getFileMetadata(input.fileId, accessToken);

    // 4. Validate file type - must be a Google Workspace document
    if (!fileMetadata.mimeType || !(fileMetadata.mimeType in WORKSPACE_MIME_TYPES)) {
      throw new Error(`File is not a Google Workspace document. MIME type: ${fileMetadata.mimeType}`);
    }

    // 5. Generate edit and view URLs based on document type
    const workspaceType = WORKSPACE_MIME_TYPES[fileMetadata.mimeType as keyof typeof WORKSPACE_MIME_TYPES];
    const editUrl = `https://docs.google.com/${workspaceType}/d/${input.fileId}/edit`;
    const viewUrl = `https://docs.google.com/${workspaceType}/d/${input.fileId}/view`;

    // 6. Log the operation in audit logs
    await db.insert(auditLogsTable)
      .values({
        user_id: userContext.userId,
        action: 'open',
        file_id: input.fileId,
        file_name: fileMetadata.name,
        metadata: JSON.stringify({
          mimeType: fileMetadata.mimeType,
          workspaceType: workspaceType,
          editUrl: editUrl,
          viewUrl: viewUrl
        })
      })
      .execute();

    return {
      editUrl,
      viewUrl
    };
  } catch (error) {
    console.error('Open workspace document failed:', error);
    throw error;
  }
}

async function refreshAccessToken(refreshToken: string, userId: number): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env['GOOGLE_CLIENT_ID']!,
      client_secret: process.env['GOOGLE_CLIENT_SECRET']!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh access token: ${response.statusText}`);
  }

  const data = await response.json() as any;
  const newAccessToken = data.access_token;
  const expiresIn = data.expires_in || 3600; // Default to 1 hour
  const newTokenExpiry = new Date(Date.now() + expiresIn * 1000);

  // Update user's access token in database
  await db.update(usersTable)
    .set({
      access_token: newAccessToken,
      token_expiry: newTokenExpiry,
      updated_at: new Date()
    })
    .where(eq(usersTable.id, userId))
    .execute();

  return newAccessToken;
}

async function getFileMetadata(fileId: string, accessToken: string): Promise<{ name: string; mimeType: string }> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`File with ID ${fileId} not found`);
    }
    if (response.status === 403) {
      throw new Error(`Access denied to file ${fileId}`);
    }
    throw new Error(`Failed to get file metadata: ${response.statusText}`);
  }

  return await response.json() as { name: string; mimeType: string };
}