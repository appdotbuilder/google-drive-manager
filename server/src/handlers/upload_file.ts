import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type UploadFileInput, type UploadFileResponse, type UserContext, type GoogleDriveFile } from '../schema';
import { eq } from 'drizzle-orm';

export async function uploadFile(input: UploadFileInput, userContext: UserContext): Promise<UploadFileResponse> {
  try {
    // 1. Get user with current tokens
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userContext.userId))
      .execute();

    if (users.length === 0) {
      throw new Error('User not found');
    }

    const user = users[0];

    // 2. Check if access token needs refresh
    let accessToken = user.access_token;
    const now = new Date();
    
    if (user.token_expiry <= now) {
      // Refresh the access token
      const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: user.refresh_token,
          client_id: process.env['GOOGLE_CLIENT_ID'] || '',
          client_secret: process.env['GOOGLE_CLIENT_SECRET'] || '',
        }),
      });

      if (!refreshResponse.ok) {
        throw new Error('Failed to refresh access token');
      }

      const refreshData = await refreshResponse.json() as { access_token: string; expires_in: number };
      accessToken = refreshData.access_token;

      // Update user with new token and expiry
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

    // 3. Decode base64 content
    const fileContent = Buffer.from(input.content, 'base64');

    // 4. Prepare multipart upload data
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    // Metadata part
    const metadata = {
      name: input.name,
      mimeType: input.mimeType,
      ...(input.parentId && { parents: [input.parentId] }),
    };

    let multipartRequestBody = delimiter;
    multipartRequestBody += 'Content-Type: application/json\r\n\r\n';
    multipartRequestBody += JSON.stringify(metadata) + delimiter;
    multipartRequestBody += `Content-Type: ${input.mimeType}\r\n`;
    multipartRequestBody += 'Content-Transfer-Encoding: base64\r\n\r\n';

    // Convert buffer to base64 for upload
    const base64Content = fileContent.toString('base64');
    multipartRequestBody += base64Content;
    multipartRequestBody += closeDelimiter;

    // 5. Upload to Google Drive
    const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`,
        'Content-Length': multipartRequestBody.length.toString(),
      },
      body: multipartRequestBody,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Google Drive upload failed:', errorText);
      throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }

    const driveFile = await uploadResponse.json() as {
      id: string;
      name: string;
      mimeType: string;
      size?: string | null;
      createdTime: string;
      modifiedTime: string;
      webViewLink?: string | null;
      webContentLink?: string | null;
      parents?: string[];
      trashed?: boolean;
      kind: string;
    };

    // 6. Convert to our schema format
    const googleDriveFile: GoogleDriveFile = {
      id: driveFile.id,
      name: driveFile.name,
      mimeType: driveFile.mimeType,
      size: driveFile.size || null,
      createdTime: new Date(driveFile.createdTime),
      modifiedTime: new Date(driveFile.modifiedTime),
      webViewLink: driveFile.webViewLink || null,
      webContentLink: driveFile.webContentLink || null,
      parents: driveFile.parents,
      trashed: driveFile.trashed || false,
      kind: driveFile.kind,
    };

    // 7. Log the operation in audit logs
    await db.insert(auditLogsTable)
      .values({
        user_id: userContext.userId,
        action: 'upload',
        file_id: googleDriveFile.id,
        file_name: googleDriveFile.name,
        metadata: JSON.stringify({
          mimeType: googleDriveFile.mimeType,
          size: googleDriveFile.size,
          parentId: input.parentId,
        }),
        ip_address: null, // Would be passed from request context in real app
        user_agent: null, // Would be passed from request context in real app
      })
      .execute();

    return {
      file: googleDriveFile,
    };
  } catch (error) {
    console.error('File upload failed:', error);
    throw error;
  }
}