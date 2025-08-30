import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type DownloadFileInput, type DownloadFileResponse, type UserContext } from '../schema';
import { eq } from 'drizzle-orm';

export async function downloadFile(input: DownloadFileInput, userContext: UserContext): Promise<DownloadFileResponse> {
  try {
    // 1. Get user's current tokens from database
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
    const tokenExpiry = new Date(user.token_expiry);
    
    if (now >= tokenExpiry) {
      // Refresh the access token
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

      const refreshData = await refreshResponse.json() as {
        access_token: string;
        expires_in: number;
      };
      accessToken = refreshData.access_token;
      
      // Update user's access token and expiry in database
      const newExpiry = new Date(now.getTime() + (refreshData.expires_in * 1000));
      await db.update(usersTable)
        .set({
          access_token: accessToken,
          token_expiry: newExpiry,
          updated_at: now,
        })
        .where(eq(usersTable.id, userContext.userId))
        .execute();
    }

    // 3. Get file metadata from Google Drive API
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${input.fileId}?fields=id,name,mimeType,size,webContentLink`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!metadataResponse.ok) {
      if (metadataResponse.status === 404) {
        throw new Error('File not found');
      }
      throw new Error('Failed to get file metadata');
    }

    const fileMetadata = await metadataResponse.json() as {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      webContentLink?: string;
    };
    
    // 4. Download file content using appropriate method
    let downloadUrl: string;
    let finalMimeType = fileMetadata.mimeType;
    let finalName = fileMetadata.name;

    // Handle Google Workspace documents by exporting to appropriate format
    const workspaceTypes: Record<string, { exportType: string; extension: string }> = {
      'application/vnd.google-apps.document': { exportType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' },
      'application/vnd.google-apps.spreadsheet': { exportType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx' },
      'application/vnd.google-apps.presentation': { exportType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx' },
      'application/vnd.google-apps.drawing': { exportType: 'image/png', extension: '.png' },
      'application/vnd.google-apps.script': { exportType: 'application/vnd.google-apps.script+json', extension: '.json' },
    };

    if (workspaceTypes[fileMetadata.mimeType]) {
      // Export Google Workspace document
      const exportInfo = workspaceTypes[fileMetadata.mimeType];
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${input.fileId}/export?mimeType=${encodeURIComponent(exportInfo.exportType)}`;
      finalMimeType = exportInfo.exportType;
      
      // Add appropriate extension if not present
      if (!finalName.endsWith(exportInfo.extension)) {
        finalName += exportInfo.extension;
      }
    } else {
      // Regular file download
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${input.fileId}?alt=media`;
    }

    // 5. Download the file content
    const downloadResponse = await fetch(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!downloadResponse.ok) {
      throw new Error('Failed to download file content');
    }

    // Get file content as buffer and convert to base64
    const fileBuffer = await downloadResponse.arrayBuffer();
    const base64Content = Buffer.from(fileBuffer).toString('base64');

    // 6. Log the operation in audit logs
    await db.insert(auditLogsTable)
      .values({
        user_id: userContext.userId,
        action: 'download',
        file_id: input.fileId,
        file_name: finalName,
        metadata: JSON.stringify({
          mimeType: finalMimeType,
          size: fileBuffer.byteLength,
          originalMimeType: fileMetadata.mimeType,
        }),
        created_at: new Date(),
      })
      .execute();

    return {
      content: base64Content,
      mimeType: finalMimeType,
      name: finalName,
    };
  } catch (error) {
    console.error('Download file failed:', error);
    throw error;
  }
}