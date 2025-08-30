import { serial, text, pgTable, timestamp, boolean } from 'drizzle-orm/pg-core';

// Users table for storing Google authentication data
export const usersTable = pgTable('users', {
  id: serial('id').primaryKey(),
  google_id: text('google_id').notNull().unique(), // Google user ID
  email: text('email').notNull(),
  name: text('name').notNull(),
  access_token: text('access_token').notNull(), // Google OAuth access token
  refresh_token: text('refresh_token').notNull(), // Google OAuth refresh token
  token_expiry: timestamp('token_expiry').notNull(), // When access token expires
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

// Session table for storing user sessions and JWT tokens
export const sessionsTable = pgTable('sessions', {
  id: serial('id').primaryKey(),
  user_id: serial('user_id').references(() => usersTable.id).notNull(),
  session_token: text('session_token').notNull().unique(), // JWT token for API access
  expires_at: timestamp('expires_at').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  is_active: boolean('is_active').notNull().default(true),
});

// API keys table for programmatic access (REST API)
export const apiKeysTable = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  user_id: serial('user_id').references(() => usersTable.id).notNull(),
  key_name: text('key_name').notNull(), // Human readable name for the key
  api_key: text('api_key').notNull().unique(), // The actual API key
  created_at: timestamp('created_at').defaultNow().notNull(),
  last_used_at: timestamp('last_used_at'),
  is_active: boolean('is_active').notNull().default(true),
});

// Audit log for file operations (optional for compliance/debugging)
export const auditLogsTable = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  user_id: serial('user_id').references(() => usersTable.id).notNull(),
  action: text('action').notNull(), // 'list', 'upload', 'download', 'delete', 'open'
  file_id: text('file_id'), // Google Drive file ID (nullable for list operations)
  file_name: text('file_name'), // File name at time of operation
  metadata: text('metadata'), // JSON string for additional operation details
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

// TypeScript types for the table schemas
export type User = typeof usersTable.$inferSelect; // For SELECT operations
export type NewUser = typeof usersTable.$inferInsert; // For INSERT operations

export type Session = typeof sessionsTable.$inferSelect;
export type NewSession = typeof sessionsTable.$inferInsert;

export type ApiKey = typeof apiKeysTable.$inferSelect;
export type NewApiKey = typeof apiKeysTable.$inferInsert;

export type AuditLog = typeof auditLogsTable.$inferSelect;
export type NewAuditLog = typeof auditLogsTable.$inferInsert;

// Export all tables for proper query building and relations
export const tables = {
  users: usersTable,
  sessions: sessionsTable,
  apiKeys: apiKeysTable,
  auditLogs: auditLogsTable,
};