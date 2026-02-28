-- Add number column to chapters table to store original chapter numbering
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS number TEXT;

-- Add comment
COMMENT ON COLUMN chapters.number IS 'Original chapter number from document (e.g., 一、, (一), 1.1)';