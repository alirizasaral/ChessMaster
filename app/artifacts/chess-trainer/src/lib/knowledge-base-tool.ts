/**
 * Realtime session.tools schema for loading a knowledge-base chapter.
 * Keep in sync with api-server/src/lib/knowledge-base.ts get_chapter tool.
 */

export const GET_CHAPTER_TOOL_NAME = "get_chapter";

export function buildGetChapterRealtimeTool(titles: string[]) {
  return {
    type: "function" as const,
    name: GET_CHAPTER_TOOL_NAME,
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
  };
}

export async function fetchChapterTitles(baseUrl: string): Promise<string[]> {
  try {
    const resp = await fetch(`${baseUrl}api/kb/chapters`);
    if (!resp.ok) return [];
    const data = (await resp.json()) as { titles?: unknown };
    return Array.isArray(data.titles)
      ? data.titles.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

export async function fetchChapterContent(
  baseUrl: string,
  title: string,
): Promise<string> {
  try {
    const resp = await fetch(
      `${baseUrl}api/kb/chapter?title=${encodeURIComponent(title)}`,
    );
    if (!resp.ok) {
      const body = await resp.text();
      let message = `Chapter not found: "${title}"`;
      try {
        const parsed = JSON.parse(body) as {
          error?: string;
          titles?: string[];
        };
        if (parsed.error) message = parsed.error;
        if (parsed.titles?.length) {
          message += `. Valid titles: ${parsed.titles.join(", ")}`;
        }
      } catch {
        if (body) message = body;
      }
      return message;
    }
    const data = (await resp.json()) as { title?: string; content?: string };
    if (!data.title || !data.content) {
      return `Chapter not found: "${title}"`;
    }
    return `# ${data.title}\n\n${data.content}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Failed to load chapter "${title}": ${message}`;
  }
}

export function parseGetChapterTitle(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as { title?: unknown };
    return typeof parsed.title === "string" ? parsed.title : "";
  } catch {
    return "";
  }
}
