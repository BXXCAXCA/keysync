ALTER TABLE messages ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_sequence
  ON messages (conversation_id, sequence);
