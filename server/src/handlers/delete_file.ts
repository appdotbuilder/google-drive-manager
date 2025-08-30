import { db } from '../db';
import { usersTable, auditLogsTable } from '../db/schema';
import { type DeleteFileInput, type DeleteFileResponse, type UserContext } from '../schema';
import { eq } from 'drizzle-orm';

export async function deleteFile(input: DeleteFileInput, userContext: UserContext): Promise<DeleteFileResponse> {
  try {
    // 1. Get user's current token information
    const users = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, userContext.userId))
      .execute();

    if (users.length === 0) {
      throw new Error('User not found');
    }

    const user = users[0];
    let accessToken = user.access_token;

    // 2. Check if token needs refresh
    const now = new Date();
    if (user.token_expiry <= now) {
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

      const refreshData = await refreshResponse.json() as any;
      accessToken = refreshData.access_token;

      // Update user's access token and expiry
      const newExpiry = new Date();
      newExpiry.setSeconds(newExpiry.getSeconds() + refreshData.expires_in);

      await db.update(usersTable)
        .set({
          access_token: accessToken,
          token_expiry: newExpiry,
          updated_at: new Date(),
        })
        .where(eq(usersTable.id, userContext.userId))
        .execute();
    }

    // 3. Get file metadata to verify ownership and get file name
    const fileMetadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${input.fileId}?fields=id,name,parents,trashed,owners`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!fileMetadataResponse.ok) {
      if (fileMetadataResponse.status === 404) {
        throw new Error('File not found');
      }
      throw new Error('Failed to get file metadata');
    }

    const fileMetadata = await fileMetadataResponse.json() as any;

    // Verify the user owns the file or has permission
    const userOwnsFile = fileMetadata.owners?.some((owner: any) => 
      owner.emailAddress === userContext.email
    );

    if (!userOwnsFile) {
      throw new Error('You do not have permission to delete this file');
    }

    // Check if file is already trashed
    if (fileMetadata.trashed) {
      return {
        success: false,
        message: 'File is already in trash',
      };
    }

    // 4. Delete file from Google Drive (move to trash)
    const deleteResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${input.fileId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!deleteResponse.ok) {
      throw new Error('Failed to delete file from Google Drive');
    }

    // 5. Log the operation in audit logs
    await db.insert(auditLogsTable)
      .values({
        user_id: userContext.userId,
        action: 'delete',
        file_id: input.fileId,
        file_name: fileMetadata.name,
        metadata: JSON.stringify({
          parents: fileMetadata.parents,
          operation: 'move_to_trash',
        }),
        ip_address: null, // Would be populated from request context in real implementation
        user_agent: null, // Would be populated from request context in real implementation
      })
      .execute();

    return {
      success: true,
      message: `File "${fileMetadata.name}" deleted successfully`,
    };

  } catch (error) {
    console.error('File deletion failed:', error);
    
    // Log failed operation
    try {
      await db.insert(auditLogsTable)
        .values({
          user_id: userContext.userId,
          action: 'delete',
          file_id: input.fileId,
          file_name: null,
          metadata: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
            operation: 'delete_failed',
          }),
          ip_address: null,
          user_agent: null,
        })
        .execute();
    } catch (auditError) {
      console.error('Failed to log audit entry:', auditError);
    }

    throw error;
  }
}