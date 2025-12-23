import { Router } from "express"
import multer from "multer"

import { OrcamentosController } from "../controller/orcamentosController.js"
import { authRequired } from "../middleware/authRequired.js"

const router = Router()
const controller = new OrcamentosController()

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 10 * 1024 * 1024, // 10MB
	},
})

router.get("/servicos", authRequired, (req, res) => controller.listServicos(req, res))
router.post("/servicos", authRequired, (req, res) => controller.createServico(req, res))
router.put("/servicos/:codigo", authRequired, (req, res) => controller.updateServico(req, res))
router.delete("/servicos/:codigo", authRequired, (req, res) => controller.deleteServico(req, res))

router.get("/pagamentos", authRequired, (req, res) => controller.listPagamentos(req, res))
router.post(
	"/pagamentos/upload-comprovante",
	authRequired,
	upload.single("file"),
	(req, res) => controller.uploadPagamentoComprovante(req, res),
)
router.post("/pagamentos", authRequired, (req, res) => controller.createPagamento(req, res))
router.put("/pagamentos/:codigo", authRequired, (req, res) => controller.updatePagamento(req, res))
router.delete("/pagamentos/:codigo", authRequired, (req, res) => controller.deletePagamento(req, res))

export default router
