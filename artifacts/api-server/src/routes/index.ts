import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import ttsRouter from "./tts";
import quipRouter from "./quip";

const router: IRouter = Router();

router.use(healthRouter);
router.use(coachRouter);
router.use(ttsRouter);
router.use(quipRouter);

export default router;
