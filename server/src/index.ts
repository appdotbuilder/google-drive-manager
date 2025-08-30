import { initTRPC, TRPCError } from '@trpc/server';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import 'dotenv/config';
import cors from 'cors';
import superjson from 'superjson';
import { z } from 'zod';

// Import schemas
import {
  googleAuthCallbackSchema,
  listFilesInputSchema,
  uploadFileInputSchema,
  downloadFileInputSchema,
  deleteFileInputSchema,
  openWorkspaceDocInputSchema,
  type UserContext
} from './schema';

// Import handlers
import { getAuthUrl } from './handlers/auth_url';
import { handleAuthCallback } from './handlers/auth_callback';
import { listFiles } from './handlers/list_files';
import { uploadFile } from './handlers/upload_file';
import { downloadFile } from './handlers/download_file';
import { deleteFile } from './handlers/delete_file';
import { openWorkspaceDoc } from './handlers/open_workspace_doc';
import { validateSession } from './handlers/validate_session';
import { validateApiKey } from './handlers/validate_api_key';
import { createApiKey, type CreateApiKeyInput } from './handlers/create_api_key';

// TRPC context type
interface Context {
  user?: UserContext;
  headers?: Record<string, string | string[] | undefined>;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const publicProcedure = t.procedure;
const router = t.router;

// Middleware for session authentication (JWT)
const requireAuth = t.middleware(async ({ ctx, next }) => {
  const authHeader = ctx.headers?.['authorization'];
  const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!authValue || !authValue.startsWith('Bearer ')) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'No valid authorization token provided',
    });
  }

  const token = authValue.substring(7); // Remove "Bearer " prefix
  const userContext = await validateSession(token);
  
  if (!userContext) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired session token',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: userContext,
    },
  });
});

// Middleware for API key authentication
const requireApiKey = t.middleware(async ({ ctx, next }) => {
  const apiKey = ctx.headers?.['x-api-key'] as string;
  if (!apiKey) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'API key required',
    });
  }

  const userContext = await validateApiKey(apiKey);
  
  if (!userContext) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Invalid API key',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: userContext,
    },
  });
});

const protectedProcedure = publicProcedure.use(requireAuth);
const apiKeyProcedure = publicProcedure.use(requireApiKey);

const appRouter = router({
  // Health check
  healthcheck: publicProcedure.query(() => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }),

  // Authentication routes
  auth: router({
    // Get Google OAuth URL for user consent
    getAuthUrl: publicProcedure
      .query(() => getAuthUrl()),

    // Handle OAuth callback and create user session
    callback: publicProcedure
      .input(googleAuthCallbackSchema)
      .mutation(({ input }) => handleAuthCallback(input)),

    // Create API key for programmatic access
    createApiKey: protectedProcedure
      .input(z.object({ keyName: z.string() }))
      .mutation(({ input, ctx }) => createApiKey(input as CreateApiKeyInput, ctx.user!)),
  }),

  // File management routes (session-based authentication)
  files: router({
    // List files in Google Drive
    list: protectedProcedure
      .input(listFilesInputSchema)
      .query(({ input, ctx }) => listFiles(input, ctx.user!)),

    // Upload file to Google Drive
    upload: protectedProcedure
      .input(uploadFileInputSchema)
      .mutation(({ input, ctx }) => uploadFile(input, ctx.user!)),

    // Download file from Google Drive
    download: protectedProcedure
      .input(downloadFileInputSchema)
      .query(({ input, ctx }) => downloadFile(input, ctx.user!)),

    // Delete file from Google Drive
    delete: protectedProcedure
      .input(deleteFileInputSchema)
      .mutation(({ input, ctx }) => deleteFile(input, ctx.user!)),

    // Open Google Workspace document in editor
    openWorkspaceDoc: protectedProcedure
      .input(openWorkspaceDocInputSchema)
      .query(({ input, ctx }) => openWorkspaceDoc(input, ctx.user!)),
  }),

  // REST API-like routes (API key authentication)
  api: router({
    // List files - REST API endpoint
    listFiles: apiKeyProcedure
      .input(listFilesInputSchema)
      .query(({ input, ctx }) => listFiles(input, ctx.user!)),

    // Upload file - REST API endpoint
    uploadFile: apiKeyProcedure
      .input(uploadFileInputSchema)
      .mutation(({ input, ctx }) => uploadFile(input, ctx.user!)),

    // Download file - REST API endpoint
    downloadFile: apiKeyProcedure
      .input(downloadFileInputSchema)
      .query(({ input, ctx }) => downloadFile(input, ctx.user!)),

    // Delete file - REST API endpoint
    deleteFile: apiKeyProcedure
      .input(deleteFileInputSchema)
      .mutation(({ input, ctx }) => deleteFile(input, ctx.user!)),
  }),
});

export type AppRouter = typeof appRouter;

async function start() {
  const port = process.env['SERVER_PORT'] || 2022;
  const server = createHTTPServer({
    middleware: (req, res, next) => {
      cors({
        origin: process.env['CLIENT_URL'] || '*',
        credentials: true,
      })(req, res, next);
    },
    router: appRouter,
    createContext({ req }) {
      return {
        headers: req.headers,
      };
    },
  });
  
  server.listen(port);
  console.log(`🚀 TRPC server listening at port: ${port}`);
  console.log(`📁 Google Drive integration ready`);
  console.log(`🔑 Authentication: Session tokens and API keys supported`);
}

start().catch(console.error);