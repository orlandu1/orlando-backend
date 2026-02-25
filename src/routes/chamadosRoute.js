import { Router } from "express"

import { ChamadosController } from "../controller/chamadosController.js"
import { authRequired } from "../middleware/authRequired.js"

const router = Router()
const controller = new ChamadosController()

router.get("/users", authRequired, (req, res) => controller.listUsers(req, res))
router.get("/", authRequired, (req, res) => controller.list(req, res))
router.get("/:id", authRequired, (req, res) => controller.get(req, res))
router.post("/", authRequired, (req, res) => controller.create(req, res))
router.put("/:id/status", authRequired, (req, res) => controller.updateStatus(req, res))

export default router
