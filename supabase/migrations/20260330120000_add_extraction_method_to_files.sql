-- 添加 extraction_method 字段，记录文本提取方式
-- 可选值: docx, xlsx, pptx, txt, worker_ocr

ALTER TABLE files ADD COLUMN IF NOT EXISTS extraction_method TEXT;

COMMENT ON COLUMN files.extraction_method IS '文本提取方式: docx/xlsx/pptx/txt (本地提取) 或 worker_ocr (远程OCR)';
