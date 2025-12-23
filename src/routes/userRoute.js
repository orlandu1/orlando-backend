import { Router } from "express"

import { UserController } from "../controller/userController.js"
import { authRequired } from "../middleware/authRequired.js"

const router = Router()
const controller = new UserController()

router.get("/", authRequired, (req, res) => controller.list(req, res))
router.post("/", authRequired, (req, res) => controller.create(req, res))
router.put("/:id", authRequired, (req, res) => controller.update(req, res))
router.delete("/:id", authRequired, (req, res) => controller.remove(req, res))

export default router

