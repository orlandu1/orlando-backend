import { Router } from "express"

import { SettingsController } from "../controller/settingsController.js"
import { authRequired } from "../middleware/authRequired.js"

const router = Router()
const controller = new SettingsController()

// Rota pública - buscar URL do APK (usada na tela de login)
router.get("/apk-url", (req, res) => controller.getApkUrl(req, res))

// Rotas protegidas - admin apenas
router.get("/", authRequired, (req, res) => controller.list(req, res))
router.put("/:key", authRequired, (req, res) => controller.update(req, res))

export default router
