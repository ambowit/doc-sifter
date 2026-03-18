import { useState, useCallback } from "react";
import { mockChapters, mockUploadedFiles, type Chapter, type UploadedFile } from "@/lib/mockData";
import { ChapterStatus } from "@/lib/enums";

export interface MappingState {
  chapters: Chapter[];
  files: UploadedFile[];
  selectedChapterId: string | null;
  draggedFileId: string | null;
  isDragging: boolean;
}

// Deep clone chapters with updated matchedFiles
const updateChapterMapping = (
  chapters: Chapter[],
  chapterId: string,
  fileId: string,
  action: "add" | "remove"
): Chapter[] => {
  return chapters.map((chapter) => {
    if (chapter.id === chapterId) {
      const matchedFiles =
        action === "add"
          ? [...chapter.matchedFiles, fileId]
          : chapter.matchedFiles.filter((id) => id !== fileId);

      // Update status based on matched files
      let status: Chapter["status"];
      if (matchedFiles.length === 0) {
        status = ChapterStatus.UNMATCHED;
      } else if (matchedFiles.length >= 2) {
        status = ChapterStatus.MATCHED;
      } else {
        status = ChapterStatus.INSUFFICIENT_DATA;
      }

      return { ...chapter, matchedFiles, status };
    }
    if (chapter.children) {
      return {
        ...chapter,
        children: updateChapterMapping(chapter.children, chapterId, fileId, action),
      };
    }
    return chapter;
  });
};

// Calculate stats from chapters
const calculateStats = (chapters: Chapter[]) => {
  let matched = 0;
  let insufficient = 0;
  let unmatched = 0;

  const countStatus = (ch: Chapter) => {
    if (ch.status === ChapterStatus.MATCHED) matched++;
    else if (ch.status === ChapterStatus.INSUFFICIENT_DATA) insufficient++;
    else unmatched++;
    ch.children?.forEach(countStatus);
  };

  chapters.forEach(countStatus);
  const total = matched + insufficient + unmatched;
  return { matched, insufficient, unmatched, total };
};

export function useMappingStore() {
  const [chapters, setChapters] = useState<Chapter[]>(() => {
    // Deep clone initial chapters
    return JSON.parse(JSON.stringify(mockChapters));
  });
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>("CH-1");
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Find chapter by ID
  const findChapter = useCallback(
    (id: string): Chapter | null => {
      const search = (chapters: Chapter[]): Chapter | null => {
        for (const ch of chapters) {
          if (ch.id === id) return ch;
          if (ch.children) {
            const found = search(ch.children);
            if (found) return found;
          }
        }
        return null;
      };
      return search(chapters);
    },
    [chapters]
  );

  const selectedChapter = selectedChapterId ? findChapter(selectedChapterId) : null;

  // Get files for selected chapter
  const selectedFiles = selectedChapter
    ? mockUploadedFiles.filter((f) => selectedChapter.matchedFiles.includes(f.id))
    : [];

  // Get all linked file IDs
  const getAllLinkedFileIds = useCallback(() => {
    const linkedIds = new Set<string>();
    const collectIds = (chs: Chapter[]) => {
      chs.forEach((ch) => {
        ch.matchedFiles.forEach((id) => linkedIds.add(id));
        if (ch.children) collectIds(ch.children);
      });
    };
    collectIds(chapters);
    return linkedIds;
  }, [chapters]);

  // Add file to chapter mapping
  const addMapping = useCallback((chapterId: string, fileId: string) => {
    setChapters((prev) => updateChapterMapping(prev, chapterId, fileId, "add"));
  }, []);

  // Remove file from chapter mapping
  const removeMapping = useCallback((chapterId: string, fileId: string) => {
    setChapters((prev) => updateChapterMapping(prev, chapterId, fileId, "remove"));
  }, []);

  // Drag handlers
  const startDrag = useCallback((fileId: string) => {
    setDraggedFileId(fileId);
    setIsDragging(true);
  }, []);

  const endDrag = useCallback(() => {
    setDraggedFileId(null);
    setIsDragging(false);
  }, []);

  // Handle drop on chapter
  const handleDrop = useCallback(
    (chapterId: string) => {
      if (draggedFileId) {
        const chapter = findChapter(chapterId);
        if (chapter && !chapter.matchedFiles.includes(draggedFileId)) {
          addMapping(chapterId, draggedFileId);
        }
      }
      endDrag();
    },
    [draggedFileId, findChapter, addMapping, endDrag]
  );

  // Check if file is linked to selected chapter
  const isFileLinkedToSelected = useCallback(
    (fileId: string) => {
      return selectedChapter?.matchedFiles.includes(fileId) || false;
    },
    [selectedChapter]
  );

  const stats = calculateStats(chapters);
  const coveragePercent = Math.round((stats.matched / stats.total) * 100);

  return {
    chapters,
    files: mockUploadedFiles,
    selectedChapterId,
    selectedChapter,
    selectedFiles,
    draggedFileId,
    isDragging,
    stats,
    coveragePercent,
    setSelectedChapterId,
    addMapping,
    removeMapping,
    startDrag,
    endDrag,
    handleDrop,
    isFileLinkedToSelected,
    getAllLinkedFileIds,
    findChapter,
  };
}
