import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import realtimeRouter from "./realtime";
import kbRouter from "./kb";

const router: IRouter = Router();

router.use(healthRouter);
router.use(coachRouter);
router.use(realtimeRouter);
router.use(kbRouter);

export default router;
