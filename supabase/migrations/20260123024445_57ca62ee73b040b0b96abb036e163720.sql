-- Add columns to files table for OCR extracted content
ALTER TABLE files 
ADD COLUMN IF NOT EXISTS extracted_text TEXT,
ADD COLUMN IF NOT EXISTS text_summary TEXT,
ADD COLUMN IF NOT EXISTS extracted_entities JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS ocr_processed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ocr_processed_at TIMESTAMPTZ;

-- Add index for OCR processed status
CREATE INDEX IF NOT EXISTS idx_files_ocr_processed ON files(ocr_processed);

-- Add comment
COMMENT ON COLUMN files.extracted_text IS 'OCR extracted text content from the file';
COMMENT ON COLUMN files.text_summary IS 'AI generated summary of the file content';
COMMENT ON COLUMN files.extracted_entities IS 'Extracted entities like company names, amounts, dates';
COMMENT ON COLUMN files.ocr_processed IS 'Whether OCR processing has been completed';
COMMENT ON COLUMN files.ocr_processed_at IS 'Timestamp when OCR was processed';