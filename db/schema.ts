import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().unique(),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const trainingEntries = sqliteTable("training_entries", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  discipline: text("discipline").notNull(),
  sessionType: text("session_type").notNull(),
  rawEntry: text("raw_entry").notNull(),
  inputMethod: text("input_method").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_training_entries_owner_created").on(table.ownerId, table.createdAt)]);
