import kb from "../data/knowledge-base.json" with { type: "json" };

export interface KnowledgeChapter {
  title: string;
  content: string;
}

interface KnowledgeBaseFile {
  version: number;
  description: string;
  chapters: KnowledgeChapter[];
}

const knowledgeBase = kb as KnowledgeBaseFile;

export function listChapterTitles(): string[] {
  return knowledgeBase.chapters.map((c) => c.title);
}

export function getChapterByTitle(title: string): KnowledgeChapter | null {
  return knowledgeBase.chapters.find((c) => c.title === title) ?? null;
}

/** OpenAI Chat Completions function tool for loading a KB chapter. */
export function buildGetChapterTool(titles: string[] = listChapterTitles()) {
  return {
    type: "function" as const,
    function: {
      name: "get_chapter",
      description:
        "Load the full content of a coaching knowledge-base chapter by exact title. Use when the student asks for deeper opening ideas, plans, or principles beyond the current Hint notes.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Exact chapter title from the available chapters list",
            ...(titles.length > 0 ? { enum: titles } : {}),
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  };
}

/** Convenience export for Chat Completions (titles baked from JSON). */
export const GET_CHAPTER_TOOL = buildGetChapterTool();

export function formatUnknownChapterError(requested: string): string {
  const titles = listChapterTitles();
  return `Chapter not found: "${requested}". Valid titles: ${titles.join(", ")}`;
}
