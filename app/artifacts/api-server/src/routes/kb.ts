import { Router } from "express";
import {
  getChapterByTitle,
  listChapterTitles,
} from "../lib/knowledge-base.js";

const router = Router();

router.get("/kb/chapters", (_req, res) => {
  res.json({ titles: listChapterTitles() });
});

router.get("/kb/chapter", (req, res) => {
  const title =
    typeof req.query.title === "string" ? req.query.title : undefined;
  if (!title) {
    res.status(400).json({ error: "Missing required query parameter: title" });
    return;
  }

  const chapter = getChapterByTitle(title);
  if (!chapter) {
    res.status(404).json({
      error: `Chapter not found: "${title}"`,
      titles: listChapterTitles(),
    });
    return;
  }

  res.json({ title: chapter.title, content: chapter.content });
});

export default router;
