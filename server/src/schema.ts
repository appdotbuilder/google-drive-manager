import { z } from 'zod';

// Google Drive file schema
export const googleDriveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  size: z.string().nullable(), // Google Drive returns size as string or null for folders
  createdTime: z.coerce.date(),
  modifiedTime: z.coerce.date(),
  webViewLink: z.string().nullable(),
  webContentLink: z.string().nullable(), // Download link
  parents: z.array(z.string()).optional(), // Parent folder IDs
  trashed: z.boolean().optional(),
  kind: z.string().optional(),
});

export type GoogleDriveFile = z.infer<typeof googleDriveFileSchema>;

// User schema for storing Google authentication data
export const userSchema = z.object({
  id: z.number(),
  google_id: z.string(),
  email: z.string().email(),
  name: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  token_expiry: z.coerce.date(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type User = z.infer<typeof userSchema>;

// Authentication schemas
export const googleAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string().optional(),
});

export type GoogleAuthCallback = z.infer<typeof googleAuthCallbackSchema>;

// File operation input schemas
export const listFilesInputSchema = z.object({
  folderId: z.string().optional(), // Optional parent folder ID
  pageToken: z.string().optional(), // For pagination
  pageSize: z.number().int().min(1).max(1000).optional().default(100),
  query: z.string().optional(), // Search query
});

export type ListFilesInput = z.infer<typeof listFilesInputSchema>;

export const uploadFileInputSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  parentId: z.string().optional(), // Parent folder ID
  content: z.string(), // Base64 encoded file content
});

export type UploadFileInput = z.infer<typeof uploadFileInputSchema>;

export const downloadFileInputSchema = z.object({
  fileId: z.string(),
});

export type DownloadFileInput = z.infer<typeof downloadFileInputSchema>;

export const deleteFileInputSchema = z.object({
  fileId: z.string(),
});

export type DeleteFileInput = z.infer<typeof deleteFileInputSchema>;

export const openWorkspaceDocInputSchema = z.object({
  fileId: z.string(),
});

export type OpenWorkspaceDocInput = z.infer<typeof openWorkspaceDocInputSchema>;

// Response schemas
export const fileListResponseSchema = z.object({
  files: z.array(googleDriveFileSchema),
  nextPageToken: z.string().optional(),
});

export type FileListResponse = z.infer<typeof fileListResponseSchema>;

export const uploadFileResponseSchema = z.object({
  file: googleDriveFileSchema,
});

export type UploadFileResponse = z.infer<typeof uploadFileResponseSchema>;

export const downloadFileResponseSchema = z.object({
  content: z.string(), // Base64 encoded file content
  mimeType: z.string(),
  name: z.string(),
});

export type DownloadFileResponse = z.infer<typeof downloadFileResponseSchema>;

export const deleteFileResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type DeleteFileResponse = z.infer<typeof deleteFileResponseSchema>;

export const workspaceDocUrlResponseSchema = z.object({
  editUrl: z.string(),
  viewUrl: z.string(),
});

export type WorkspaceDocUrlResponse = z.infer<typeof workspaceDocUrlResponseSchema>;

// Authentication response schemas
export const authUrlResponseSchema = z.object({
  authUrl: z.string(),
});

export type AuthUrlResponse = z.infer<typeof authUrlResponseSchema>;

export const authCallbackResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(), // JWT token for API access
});

export type AuthCallbackResponse = z.infer<typeof authCallbackResponseSchema>;

// Error response schema
export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// User context for authenticated requests
export const userContextSchema = z.object({
  userId: z.number(),
  googleId: z.string(),
  email: z.string(),
});

export type UserContext = z.infer<typeof userContextSchema>;