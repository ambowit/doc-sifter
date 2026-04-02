import { DEFAULT_TEMPLATE_FINGERPRINT } from "@/lib/templateDefaults";

export interface TemplateStylePreview {
  primaryColor: string;
  secondaryColor?: string;
  accentColor: string;
  fontFamily: string;
  headerStyle: "classic" | "modern" | "minimal";
  headerDecoration?: "none" | "line" | "double-line" | "gradient" | "pattern";
  sectionDivider?: "none" | "simple" | "dotted" | "diamond" | "wave";
  quoteStyle?: "border-left" | "background" | "quotes" | "bracket";
  titleDecoration?: "none" | "underline" | "box" | "ribbon" | "badge";
  pageCorner?: "none" | "fold" | "stamp" | "watermark";
  bulletStyle?: "disc" | "circle" | "square" | "arrow" | "check" | "number";
}

export interface TemplateStyle {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  preview: TemplateStylePreview;
  styles: import("@/lib/reportTypes").TemplateFingerprint["styles"];
  tables: import("@/lib/reportTypes").TemplateFingerprint["tables"];
  page: import("@/lib/reportTypes").TemplateFingerprint["page"];
  createdAt?: string;
  updatedAt?: string;
}

export const DEFAULT_TEMPLATE_STYLE_PREVIEW: TemplateStylePreview = {
  primaryColor: "#111827",
  accentColor: "#374151",
  fontFamily: "宋体",
  headerStyle: "classic",
  headerDecoration: "none",
  sectionDivider: "simple",
  quoteStyle: "border-left",
  titleDecoration: "none",
  pageCorner: "none",
  bulletStyle: "disc",
};

const DEFAULT_STYLE_SHAPES = {
  styles: DEFAULT_TEMPLATE_FINGERPRINT.styles,
  tables: DEFAULT_TEMPLATE_FINGERPRINT.tables,
  page: DEFAULT_TEMPLATE_FINGERPRINT.page,
};

export function ensureTemplateStylePreview(
  preview?: Partial<TemplateStylePreview> | null
): TemplateStylePreview {
  return { ...DEFAULT_TEMPLATE_STYLE_PREVIEW, ...(preview || {}) };
}

export function normalizeTemplateStyle(style: TemplateStyle): TemplateStyle {
  const styles = style.styles || {};
  const tables = style.tables || {};
  const page = style.page || {};
  const mergedTables = {
    ...DEFAULT_STYLE_SHAPES.tables,
    ...tables,
    default: {
      ...DEFAULT_STYLE_SHAPES.tables.default,
      ...(tables as typeof DEFAULT_STYLE_SHAPES.tables).default,
    },
  };
  const mergedStyles = {
    ...DEFAULT_STYLE_SHAPES.styles,
    ...styles,
    h1: {
      ...DEFAULT_STYLE_SHAPES.styles.h1,
      ...(styles as typeof DEFAULT_STYLE_SHAPES.styles).h1,
    },
    h2: {
      ...DEFAULT_STYLE_SHAPES.styles.h2,
      ...(styles as typeof DEFAULT_STYLE_SHAPES.styles).h2,
    },
    h3: {
      ...DEFAULT_STYLE_SHAPES.styles.h3,
      ...(styles as typeof DEFAULT_STYLE_SHAPES.styles).h3,
    },
    body: {
      ...DEFAULT_STYLE_SHAPES.styles.body,
      ...(styles as typeof DEFAULT_STYLE_SHAPES.styles).body,
    },
    quote: {
      ...DEFAULT_STYLE_SHAPES.styles.quote,
      ...(styles as typeof DEFAULT_STYLE_SHAPES.styles).quote,
    },
    caption: {
      ...DEFAULT_STYLE_SHAPES.styles.caption,
      ...(styles as typeof DEFAULT_STYLE_SHAPES.styles).caption,
    },
    footnote: {
      ...DEFAULT_STYLE_SHAPES.styles.footnote,
      ...(styles as typeof DEFAULT_STYLE_SHAPES.styles).footnote,
    },
  };
  return {
    ...style,
    preview: ensureTemplateStylePreview(style.preview),
    styles: mergedStyles,
    tables: mergedTables,
    page: { ...DEFAULT_STYLE_SHAPES.page, ...page },
  };
}
