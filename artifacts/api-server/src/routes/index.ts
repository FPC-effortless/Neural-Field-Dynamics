import { Router, type IRouter } from "express";
import healthRouter from "./health";
import runsRouter from "./runs";
import systemRouter from "./system";
import notesRouter from "./notes";
import baselinesRouter from "./baselines";

const router: IRouter = Router();

router.use(healthRouter);
router.use(systemRouter);
router.use(notesRouter);
router.use(baselinesRouter);
router.use(runsRouter);

export default router;
