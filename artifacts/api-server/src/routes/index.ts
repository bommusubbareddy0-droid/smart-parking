import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import parkingRouter from "./parking";
import reservationsRouter from "./reservations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(parkingRouter);
router.use(reservationsRouter);

export default router;
