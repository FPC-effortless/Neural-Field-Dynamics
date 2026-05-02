import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runsRouter from "./runs";
import systemRouter from "./system";
import notesRouter from "./notes";
import baselinesRouter from "./baselines";
import hypothesesRouter from "./hypotheses";

const router: IRouter = Router();

router.use(healthRouter);
router.use(systemRouter);
router.use(notesRouter);
router.use(baselinesRouter);
router.use(hypothesesRouter);
router.use(runsRouter);

export default router;
