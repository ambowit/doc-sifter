-- Make template styles global (shared) instead of per-project
ALTER TABLE template_styles
  ALTER COLUMN project_id DROP NOT NULL;

-- Drop project seeding trigger and function (no longer needed)
DROP TRIGGER IF EXISTS projects_seed_template_styles ON projects;
DROP FUNCTION IF EXISTS handle_project_template_styles();

-- Update default style selector to use global styles
CREATE OR REPLACE FUNCTION set_default_template_style_on_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  style_id UUID;
BEGIN
  IF NEW.selected_style_id IS NULL THEN
    SELECT id INTO style_id
    FROM template_styles
    WHERE project_id IS NULL
      AND name = '经典宋体'
    ORDER BY created_at
    LIMIT 1;
    NEW.selected_style_id = style_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Ensure global styles exist (insert defaults if absent)
INSERT INTO template_styles (project_id, name, description, preview, styles, tables, page)
SELECT NULL, s.name, s.description, s.preview, s.styles, s.tables, s.page
FROM (
  VALUES
    (
      '经典宋体',
      '传统法律文书风格，使用宋体字体，正式规范',
      '{
        "primaryColor": "#000000",
        "secondaryColor": "#333333",
        "accentColor": "#333333",
        "fontFamily": "宋体",
        "headerStyle": "classic",
        "headerDecoration": "double-line",
        "sectionDivider": "simple",
        "quoteStyle": "border-left",
        "titleDecoration": "underline",
        "pageCorner": "none",
        "bulletStyle": "disc"
      }'::jsonb,
      '{
        "h1": {"font": "宋体", "sizePt": 18, "bold": true, "spaceBeforePt": 16, "spaceAfterPt": 8, "lineSpacing": 1.3, "color": "#111827"},
        "h2": {"font": "宋体", "sizePt": 14, "bold": true, "spaceBeforePt": 12, "spaceAfterPt": 6, "lineSpacing": 1.3, "color": "#1f2937"},
        "h3": {"font": "宋体", "sizePt": 12, "bold": true, "spaceBeforePt": 8, "spaceAfterPt": 4, "lineSpacing": 1.3, "color": "#374151"},
        "body": {"font": "宋体", "sizePt": 11, "bold": false, "spaceBeforePt": 0, "spaceAfterPt": 6, "lineSpacing": 1.6, "firstLineIndentCm": 0.75, "align": "justify", "color": "#111827"},
        "quote": {"font": "宋体", "sizePt": 10.5, "bold": false, "spaceBeforePt": 6, "spaceAfterPt": 6, "lineSpacing": 1.5, "indentLeftCm": 0.6, "borderLeft": true, "color": "#374151"},
        "caption": {"font": "宋体", "sizePt": 10, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 4, "lineSpacing": 1.3, "align": "center", "color": "#4b5563"},
        "footnote": {"font": "宋体", "sizePt": 9}
      }'::jsonb,
      '{
        "default": {"border": "single", "borderSizePt": 0.5, "headerFill": "#f3f4f6", "cellPaddingPt": 4, "headerBold": true, "align": "left", "font": "宋体", "sizePt": 10, "borderColor": "#d1d5db"}
      }'::jsonb,
      '{
        "size": "A4",
        "orientation": "portrait",
        "margin": {"top": 2.5, "bottom": 2.5, "left": 3, "right": 2.5, "unit": "cm"},
        "headerFooter": {"hasHeader": false, "hasFooter": true, "footerHasPageNumber": true, "pageNumberStyle": "center"}
      }'::jsonb
    ),
    (
      '现代黑体',
      '现代商务风格，使用黑体字体，简洁大方',
      '{
        "primaryColor": "#1a1a2e",
        "secondaryColor": "#16213e",
        "accentColor": "#16213e",
        "fontFamily": "黑体",
        "headerStyle": "modern",
        "headerDecoration": "gradient",
        "sectionDivider": "diamond",
        "quoteStyle": "background",
        "titleDecoration": "ribbon",
        "pageCorner": "fold",
        "bulletStyle": "arrow"
      }'::jsonb,
      '{
        "h1": {"font": "黑体", "sizePt": 18, "bold": true, "spaceBeforePt": 16, "spaceAfterPt": 8, "lineSpacing": 1.3, "color": "#1a1a2e"},
        "h2": {"font": "黑体", "sizePt": 14, "bold": true, "spaceBeforePt": 12, "spaceAfterPt": 6, "lineSpacing": 1.3, "color": "#1a1a2e"},
        "h3": {"font": "黑体", "sizePt": 12, "bold": true, "spaceBeforePt": 10, "spaceAfterPt": 4, "lineSpacing": 1.3, "color": "#333333"},
        "body": {"font": "仿宋", "sizePt": 11, "bold": false, "spaceBeforePt": 0, "spaceAfterPt": 8, "lineSpacing": 1.6, "firstLineIndentCm": 0.85, "align": "justify"},
        "quote": {"font": "仿宋", "sizePt": 10.5, "bold": false, "spaceBeforePt": 6, "spaceAfterPt": 6, "lineSpacing": 1.4, "indentLeftCm": 1, "borderLeft": true},
        "caption": {"font": "黑体", "sizePt": 10, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 8, "lineSpacing": 1.2, "align": "center"},
        "footnote": {"font": "仿宋", "sizePt": 8}
      }'::jsonb,
      '{
        "default": {"border": "single", "borderSizePt": 0.75, "headerFill": "#e8e8e8", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "仿宋", "sizePt": 10, "borderColor": "#333333"},
        "threeLines": {"border": "threeLines", "borderSizePt": 1.5, "headerFill": "transparent", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "仿宋", "sizePt": 10, "borderColor": "#1a1a2e"}
      }'::jsonb,
      '{
        "size": "A4",
        "orientation": "portrait",
        "margin": {"top": 2.54, "bottom": 2.54, "left": 3.17, "right": 3.17, "unit": "cm"},
        "headerFooter": {"hasHeader": false, "hasFooter": true, "footerHasPageNumber": true, "pageNumberStyle": "center"}
      }'::jsonb
    ),
    (
      '优雅楷体',
      '文雅书卷风格，使用楷体字体，适合高端客户',
      '{
        "primaryColor": "#2c3e50",
        "secondaryColor": "#34495e",
        "accentColor": "#34495e",
        "fontFamily": "楷体",
        "headerStyle": "classic",
        "headerDecoration": "double-line",
        "sectionDivider": "wave",
        "quoteStyle": "quotes",
        "titleDecoration": "badge",
        "pageCorner": "stamp",
        "bulletStyle": "circle"
      }'::jsonb,
      '{
        "h1": {"font": "楷体", "sizePt": 18, "bold": true, "spaceBeforePt": 14, "spaceAfterPt": 8, "lineSpacing": 1.4, "color": "#2c3e50"},
        "h2": {"font": "楷体", "sizePt": 15, "bold": true, "spaceBeforePt": 12, "spaceAfterPt": 6, "lineSpacing": 1.4, "color": "#2c3e50"},
        "h3": {"font": "楷体", "sizePt": 12, "bold": true, "spaceBeforePt": 10, "spaceAfterPt": 4, "lineSpacing": 1.4, "color": "#34495e"},
        "body": {"font": "楷体", "sizePt": 11.5, "bold": false, "spaceBeforePt": 0, "spaceAfterPt": 6, "lineSpacing": 1.7, "firstLineIndentCm": 0.74, "align": "justify"},
        "quote": {"font": "楷体", "sizePt": 10.5, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 4, "lineSpacing": 1.5, "indentLeftCm": 0.8, "borderLeft": true},
        "caption": {"font": "楷体", "sizePt": 10, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 8, "lineSpacing": 1.3, "align": "center"},
        "footnote": {"font": "楷体", "sizePt": 9}
      }'::jsonb,
      '{
        "default": {"border": "single", "borderSizePt": 0.5, "headerFill": "#ecf0f1", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "楷体", "sizePt": 10, "borderColor": "#2c3e50"},
        "threeLines": {"border": "threeLines", "borderSizePt": 1, "headerFill": "transparent", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "楷体", "sizePt": 10, "borderColor": "#2c3e50"}
      }'::jsonb,
      '{
        "size": "A4",
        "orientation": "portrait",
        "margin": {"top": 2.5, "bottom": 2.5, "left": 3, "right": 2.5, "unit": "cm"},
        "headerFooter": {"hasHeader": false, "hasFooter": true, "footerHasPageNumber": true, "pageNumberStyle": "center"}
      }'::jsonb
    ),
    (
      '简约清新',
      '极简设计风格，留白充足，阅读舒适',
      '{
        "primaryColor": "#2d3436",
        "secondaryColor": "#636e72",
        "accentColor": "#636e72",
        "fontFamily": "微软雅黑",
        "headerStyle": "minimal",
        "headerDecoration": "line",
        "sectionDivider": "none",
        "quoteStyle": "background",
        "titleDecoration": "none",
        "pageCorner": "none",
        "bulletStyle": "disc"
      }'::jsonb,
      '{
        "h1": {"font": "微软雅黑", "sizePt": 16, "bold": true, "spaceBeforePt": 18, "spaceAfterPt": 10, "lineSpacing": 1.5, "color": "#2d3436"},
        "h2": {"font": "微软雅黑", "sizePt": 13, "bold": true, "spaceBeforePt": 14, "spaceAfterPt": 8, "lineSpacing": 1.5, "color": "#2d3436"},
        "h3": {"font": "微软雅黑", "sizePt": 11, "bold": true, "spaceBeforePt": 10, "spaceAfterPt": 6, "lineSpacing": 1.5, "color": "#636e72"},
        "body": {"font": "微软雅黑", "sizePt": 10.5, "bold": false, "spaceBeforePt": 0, "spaceAfterPt": 8, "lineSpacing": 1.8, "firstLineIndentCm": 0, "align": "left"},
        "quote": {"font": "微软雅黑", "sizePt": 10, "bold": false, "spaceBeforePt": 8, "spaceAfterPt": 8, "lineSpacing": 1.6, "indentLeftCm": 1.2, "borderLeft": true},
        "caption": {"font": "微软雅黑", "sizePt": 9, "bold": false, "spaceBeforePt": 6, "spaceAfterPt": 10, "lineSpacing": 1.4, "align": "center"},
        "footnote": {"font": "微软雅黑", "sizePt": 8}
      }'::jsonb,
      '{
        "default": {"border": "single", "borderSizePt": 0.25, "headerFill": "#f5f6fa", "cellPaddingPt": 6, "headerBold": true, "align": "left", "font": "微软雅黑", "sizePt": 9.5, "borderColor": "#dcdde1"},
        "threeLines": {"border": "threeLines", "borderSizePt": 0.75, "headerFill": "transparent", "cellPaddingPt": 6, "headerBold": true, "align": "left", "font": "微软雅黑", "sizePt": 9.5, "borderColor": "#2d3436"}
      }'::jsonb,
      '{
        "size": "A4",
        "orientation": "portrait",
        "margin": {"top": 3, "bottom": 3, "left": 3, "right": 3, "unit": "cm"},
        "headerFooter": {"hasHeader": false, "hasFooter": true, "footerHasPageNumber": true, "pageNumberStyle": "center"}
      }'::jsonb
    ),
    (
      '专业英文',
      '国际化专业风格，适合涉外法律文书',
      '{
        "primaryColor": "#1e3a5f",
        "secondaryColor": "#3d5a80",
        "accentColor": "#3d5a80",
        "fontFamily": "Times New Roman",
        "headerStyle": "modern",
        "headerDecoration": "pattern",
        "sectionDivider": "dotted",
        "quoteStyle": "bracket",
        "titleDecoration": "box",
        "pageCorner": "watermark",
        "bulletStyle": "square"
      }'::jsonb,
      '{
        "h1": {"font": "Times New Roman", "sizePt": 16, "bold": true, "spaceBeforePt": 14, "spaceAfterPt": 8, "lineSpacing": 1.2, "color": "#1e3a5f"},
        "h2": {"font": "Times New Roman", "sizePt": 14, "bold": true, "spaceBeforePt": 12, "spaceAfterPt": 6, "lineSpacing": 1.2, "color": "#1e3a5f"},
        "h3": {"font": "Times New Roman", "sizePt": 12, "bold": true, "spaceBeforePt": 10, "spaceAfterPt": 4, "lineSpacing": 1.2, "color": "#3d5a80"},
        "body": {"font": "Times New Roman", "sizePt": 11, "bold": false, "spaceBeforePt": 0, "spaceAfterPt": 6, "lineSpacing": 1.5, "firstLineIndentCm": 1.27, "align": "justify"},
        "quote": {"font": "Times New Roman", "sizePt": 10, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 4, "lineSpacing": 1.3, "indentLeftCm": 1.27, "borderLeft": false},
        "caption": {"font": "Times New Roman", "sizePt": 10, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 8, "lineSpacing": 1.2, "align": "center"},
        "footnote": {"font": "Times New Roman", "sizePt": 9}
      }'::jsonb,
      '{
        "default": {"border": "single", "borderSizePt": 0.5, "headerFill": "#e8f4f8", "cellPaddingPt": 4, "headerBold": true, "align": "center", "font": "Times New Roman", "sizePt": 10, "borderColor": "#1e3a5f"},
        "threeLines": {"border": "threeLines", "borderSizePt": 1, "headerFill": "transparent", "cellPaddingPt": 4, "headerBold": true, "align": "center", "font": "Times New Roman", "sizePt": 10, "borderColor": "#1e3a5f"}
      }'::jsonb,
      '{
        "size": "Letter",
        "orientation": "portrait",
        "margin": {"top": 2.54, "bottom": 2.54, "left": 2.54, "right": 2.54, "unit": "cm"},
        "headerFooter": {"hasHeader": false, "hasFooter": true, "footerHasPageNumber": true, "pageNumberStyle": "center"}
      }'::jsonb
    ),
    (
      '红金商务',
      '高端商务风格，红金配色，彰显专业与品质',
      '{
        "primaryColor": "#8B0000",
        "secondaryColor": "#B8860B",
        "accentColor": "#B8860B",
        "fontFamily": "宋体",
        "headerStyle": "classic",
        "headerDecoration": "gradient",
        "sectionDivider": "diamond",
        "quoteStyle": "border-left",
        "titleDecoration": "ribbon",
        "pageCorner": "stamp",
        "bulletStyle": "check"
      }'::jsonb,
      '{
        "h1": {"font": "宋体", "sizePt": 18, "bold": true, "spaceBeforePt": 16, "spaceAfterPt": 10, "lineSpacing": 1.3, "color": "#8B0000"},
        "h2": {"font": "宋体", "sizePt": 14, "bold": true, "spaceBeforePt": 12, "spaceAfterPt": 6, "lineSpacing": 1.3, "color": "#8B0000"},
        "h3": {"font": "宋体", "sizePt": 12, "bold": true, "spaceBeforePt": 10, "spaceAfterPt": 4, "lineSpacing": 1.3, "color": "#B8860B"},
        "body": {"font": "宋体", "sizePt": 11, "bold": false, "spaceBeforePt": 0, "spaceAfterPt": 6, "lineSpacing": 1.6, "firstLineIndentCm": 0.74, "align": "justify"},
        "quote": {"font": "宋体", "sizePt": 10.5, "bold": false, "spaceBeforePt": 6, "spaceAfterPt": 6, "lineSpacing": 1.5, "indentLeftCm": 0.6, "borderLeft": true, "color": "#374151"},
        "caption": {"font": "宋体", "sizePt": 10, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 4, "lineSpacing": 1.3, "align": "center", "color": "#4b5563"},
        "footnote": {"font": "宋体", "sizePt": 9}
      }'::jsonb,
      '{
        "default": {"border": "single", "borderSizePt": 0.5, "headerFill": "#FDF5E6", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "宋体", "sizePt": 10, "borderColor": "#8B0000"},
        "threeLines": {"border": "threeLines", "borderSizePt": 1, "headerFill": "transparent", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "宋体", "sizePt": 10, "borderColor": "#8B0000"}
      }'::jsonb,
      '{
        "size": "A4",
        "orientation": "portrait",
        "margin": {"top": 2.5, "bottom": 2.5, "left": 3, "right": 2.5, "unit": "cm"},
        "headerFooter": {"hasHeader": false, "hasFooter": true, "footerHasPageNumber": true, "pageNumberStyle": "center"}
      }'::jsonb
    ),
    (
      '科技蓝灰',
      '现代科技风格，适合科技行业尽调报告',
      '{
        "primaryColor": "#0066CC",
        "secondaryColor": "#4A5568",
        "accentColor": "#4A5568",
        "fontFamily": "微软雅黑",
        "headerStyle": "modern",
        "headerDecoration": "pattern",
        "sectionDivider": "simple",
        "quoteStyle": "background",
        "titleDecoration": "box",
        "pageCorner": "fold",
        "bulletStyle": "arrow"
      }'::jsonb,
      '{
        "h1": {"font": "微软雅黑", "sizePt": 17, "bold": true, "spaceBeforePt": 14, "spaceAfterPt": 8, "lineSpacing": 1.4, "color": "#0066CC"},
        "h2": {"font": "微软雅黑", "sizePt": 14, "bold": true, "spaceBeforePt": 12, "spaceAfterPt": 6, "lineSpacing": 1.4, "color": "#0066CC"},
        "h3": {"font": "微软雅黑", "sizePt": 12, "bold": true, "spaceBeforePt": 10, "spaceAfterPt": 4, "lineSpacing": 1.4, "color": "#4A5568"},
        "body": {"font": "微软雅黑", "sizePt": 10.5, "bold": false, "spaceBeforePt": 0, "spaceAfterPt": 6, "lineSpacing": 1.7, "firstLineIndentCm": 0.74, "align": "justify"},
        "quote": {"font": "微软雅黑", "sizePt": 10, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 4, "lineSpacing": 1.4, "indentLeftCm": 0.8, "borderLeft": true},
        "caption": {"font": "微软雅黑", "sizePt": 9, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 8, "lineSpacing": 1.2, "align": "center"},
        "footnote": {"font": "微软雅黑", "sizePt": 8}
      }'::jsonb,
      '{
        "default": {"border": "single", "borderSizePt": 0.5, "headerFill": "#E6F2FF", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "微软雅黑", "sizePt": 9.5, "borderColor": "#0066CC"},
        "threeLines": {"border": "threeLines", "borderSizePt": 1, "headerFill": "transparent", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "微软雅黑", "sizePt": 9.5, "borderColor": "#0066CC"}
      }'::jsonb,
      '{
        "size": "A4",
        "orientation": "portrait",
        "margin": {"top": 2.5, "bottom": 2.5, "left": 2.5, "right": 2.5, "unit": "cm"},
        "headerFooter": {"hasHeader": false, "hasFooter": true, "footerHasPageNumber": true, "pageNumberStyle": "center"}
      }'::jsonb
    ),
    (
      '生态绿色',
      '清新环保风格，适合环保、农业相关项目',
      '{
        "primaryColor": "#2E7D32",
        "secondaryColor": "#558B2F",
        "accentColor": "#558B2F",
        "fontFamily": "仿宋",
        "headerStyle": "modern",
        "headerDecoration": "line",
        "sectionDivider": "wave",
        "quoteStyle": "quotes",
        "titleDecoration": "badge",
        "pageCorner": "none",
        "bulletStyle": "check"
      }'::jsonb,
      '{
        "h1": {"font": "黑体", "sizePt": 16, "bold": true, "spaceBeforePt": 14, "spaceAfterPt": 8, "lineSpacing": 1.3, "color": "#2E7D32"},
        "h2": {"font": "黑体", "sizePt": 14, "bold": true, "spaceBeforePt": 12, "spaceAfterPt": 6, "lineSpacing": 1.3, "color": "#2E7D32"},
        "h3": {"font": "黑体", "sizePt": 12, "bold": true, "spaceBeforePt": 10, "spaceAfterPt": 4, "lineSpacing": 1.3, "color": "#558B2F"},
        "body": {"font": "仿宋", "sizePt": 11, "bold": false, "spaceBeforePt": 0, "spaceAfterPt": 6, "lineSpacing": 1.6, "firstLineIndentCm": 0.74, "align": "justify"},
        "quote": {"font": "宋体", "sizePt": 10.5, "bold": false, "spaceBeforePt": 6, "spaceAfterPt": 6, "lineSpacing": 1.5, "indentLeftCm": 0.6, "borderLeft": true, "color": "#374151"},
        "caption": {"font": "宋体", "sizePt": 10, "bold": false, "spaceBeforePt": 4, "spaceAfterPt": 4, "lineSpacing": 1.3, "align": "center", "color": "#4b5563"},
        "footnote": {"font": "宋体", "sizePt": 9}
      }'::jsonb,
      '{
        "default": {"border": "single", "borderSizePt": 0.5, "headerFill": "#E8F5E9", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "仿宋", "sizePt": 10, "borderColor": "#2E7D32"},
        "threeLines": {"border": "threeLines", "borderSizePt": 1, "headerFill": "transparent", "cellPaddingPt": 5, "headerBold": true, "align": "center", "font": "仿宋", "sizePt": 10, "borderColor": "#2E7D32"}
      }'::jsonb,
      '{
        "size": "A4",
        "orientation": "portrait",
        "margin": {"top": 2.5, "bottom": 2.5, "left": 3, "right": 2.5, "unit": "cm"},
        "headerFooter": {"hasHeader": false, "hasFooter": true, "footerHasPageNumber": true, "pageNumberStyle": "center"}
      }'::jsonb
    )
) AS s(name, description, preview, styles, tables, page)
WHERE NOT EXISTS (
  SELECT 1 FROM template_styles ts WHERE ts.project_id IS NULL AND ts.name = s.name
);

-- Map existing selected_style_id to global style ids by name
UPDATE template_fingerprints tf
SET selected_style_id = gs.id
FROM template_styles ps
JOIN template_styles gs
  ON gs.project_id IS NULL AND gs.name = ps.name
WHERE tf.selected_style_id = ps.id;

-- Remove per-project styles
DELETE FROM template_styles WHERE project_id IS NOT NULL;

-- Unique index for global styles by name
DROP INDEX IF EXISTS idx_template_styles_project_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_template_styles_global_name
  ON template_styles (name)
  WHERE project_id IS NULL;

-- Update RLS policies to allow global styles
DROP POLICY IF EXISTS "Users can view template styles in own projects" ON template_styles;
CREATE POLICY "Users can view template styles"
  ON template_styles FOR SELECT
  USING (
    project_id IS NULL OR EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = template_styles.project_id
      AND projects.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create template styles in own projects" ON template_styles;
CREATE POLICY "Users can create template styles"
  ON template_styles FOR INSERT
  WITH CHECK (
    project_id IS NULL OR EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = template_styles.project_id
      AND projects.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update template styles in own projects" ON template_styles;
CREATE POLICY "Users can update template styles"
  ON template_styles FOR UPDATE
  USING (
    project_id IS NULL OR EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = template_styles.project_id
      AND projects.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete template styles in own projects" ON template_styles;
CREATE POLICY "Users can delete template styles"
  ON template_styles FOR DELETE
  USING (
    project_id IS NULL OR EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = template_styles.project_id
      AND projects.user_id = auth.uid()
    )
  );
