import { Router } from "express"

import { AuditController } from "../controller/auditController.js"
import { authRequired } from "../middleware/authRequired.js"

const router = Router()
const controller = new AuditController()

router.get("/", authRequired, (req, res) => controller.list(req, res))
router.get("/transaction/:transactionId", authRequired, (req, res) => controller.getByTransaction(req, res))

export default router
