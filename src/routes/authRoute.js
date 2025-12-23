
import { Router } from "express"

import { AuthController } from "../controller/authController.js"
import { authRequired } from "../middleware/authRequired.js"

const router = Router()
const controller = new AuthController()

router.post("/login", (req, res) => controller.login(req, res))

router.post("/change-password", authRequired, (req, res) => controller.changePassword(req, res))

router.get("/me", authRequired, (req, res) => {
	return res.json({ ok: true, auth: req.auth })
})

export default router

