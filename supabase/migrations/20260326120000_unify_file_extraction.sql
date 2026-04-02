ALTER TABLE files
ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS extraction_method TEXT,
ADD COLUMN IF NOT EXISTS extraction_error TEXT,
ADD COLUMN IF NOT EXISTS extraction_completed_at TIMESTAMPTZ;

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_extraction_status_check;
ALTER TABLE files
  ADD CONSTRAINT files_extraction_status_check
  CHECK (extraction_status IN ('pending', 'processing', 'succeeded', 'failed', 'skipped'));

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_extraction_method_check;
ALTER TABLE files
  ADD CONSTRAINT files_extraction_method_check
  CHECK (extraction_method IS NULL OR extraction_method IN ('ocr', 'direct_text'));

UPDATE files
SET
  extraction_status = CASE
    WHEN ocr_processed = true AND COALESCE(text_summary, '') LIKE '暂不支持自动提取%' THEN 'skipped'
    WHEN ocr_processed = true THEN 'succeeded'
    ELSE 'pending'
  END,
  extraction_method = CASE
    WHEN ocr_processed = true AND (mime_type = 'application/pdf' OR mime_type LIKE 'image/%') THEN 'ocr'
    WHEN ocr_processed = true THEN 'direct_text'
    ELSE extraction_method
  END,
  extraction_error = CASE
    WHEN ocr_processed = true AND COALESCE(text_summary, '') LIKE '暂不支持自动提取%' THEN text_summary
    ELSE extraction_error
  END,
  extraction_completed_at = COALESCE(extraction_completed_at, ocr_processed_at)
WHERE extraction_status = 'pending'
   OR extraction_method IS NULL
   OR extraction_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_files_extraction_status ON files(extraction_status);

COMMENT ON COLUMN files.extracted_text IS 'Extracted text content from the file';
COMMENT ON COLUMN files.text_summary IS 'Summary of the extracted file content';
COMMENT ON COLUMN files.extracted_entities IS 'Extracted entities like company names, amounts, dates';
COMMENT ON COLUMN files.extraction_status IS 'Unified text extraction status';
COMMENT ON COLUMN files.extraction_method IS 'Method used to extract text content';
COMMENT ON COLUMN files.extraction_error IS 'Last extraction error or skip reason';
COMMENT ON COLUMN files.extraction_completed_at IS 'Timestamp when extraction completed';
