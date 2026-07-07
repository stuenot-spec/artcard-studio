import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originalImage: text("original_image").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const generatedCards = sqliteTable("generated_cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  cardType: text("card_type").notNull(), // "neutral_white", "gradient_beige", "dark_slate"
  imageData: text("image_data").notNull(),
  label: text("label").notNull(),
});

export const insertSessionSchema = createInsertSchema(sessions).omit({ id: true });
export const insertCardSchema = createInsertSchema(generatedCards).omit({ id: true });

export type Session = typeof sessions.$inferSelect;
export type GeneratedCard = typeof generatedCards.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type InsertCard = z.infer<typeof insertCardSchema>;
