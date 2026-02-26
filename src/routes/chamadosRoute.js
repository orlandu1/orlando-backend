import { Router } from "express"
import multer from "multer"

import { ChamadosController } from "../controller/chamadosController.js"
import { authRequired } from "../middleware/authRequired.js"

const router = Router()
const controller = new ChamadosController()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

router.get("/users", authRequired, (req, res) => controller.listUsers(req, res))
router.get("/", authRequired, (req, res) => controller.list(req, res))
router.get("/:id", authRequired, (req, res) => controller.get(req, res))
router.post("/", authRequired, (req, res) => controller.create(req, res))
router.post("/:id/comentario", authRequired, (req, res) => controller.addComment(req, res))
router.post("/:id/anexo", authRequired, upload.single("file"), (req, res) => controller.uploadAnexo(req, res))
router.post("/:id/interessados", authRequired, (req, res) => controller.addInteressado(req, res))
router.delete("/:id/interessados/:userId", authRequired, (req, res) => controller.removeInteressado(req, res))
router.put("/:id/status", authRequired, (req, res) => controller.updateStatus(req, res))
router.put("/:id/responsavel", authRequired, (req, res) => controller.assignResponsavel(req, res))
router.put("/:id/reopen", authRequired, (req, res) => controller.reopen(req, res))

export default router
