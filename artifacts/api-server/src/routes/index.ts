import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import ttsRouter from "./tts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(coachRouter);
router.use(ttsRouter);

export default router;
