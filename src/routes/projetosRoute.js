import { Router } from "express"

import { ProjetosController } from "../controller/projetosController.js"
import { authRequired } from "../middleware/authRequired.js"

const router = Router()
const controller = new ProjetosController()

router.get("/default", authRequired, (req, res) => controller.getDefault(req, res))
router.get("/", authRequired, (req, res) => controller.list(req, res))

router.get("/:id/stats", authRequired, (req, res) => controller.stats(req, res))
router.get("/:id", authRequired, (req, res) => controller.getOne(req, res))
router.post("/", authRequired, (req, res) => controller.create(req, res))
router.put("/:id", authRequired, (req, res) => controller.update(req, res))
router.delete("/:id", authRequired, (req, res) => controller.remove(req, res))

router.get("/:id/members", authRequired, (req, res) => controller.listMembers(req, res))
router.post("/:id/members", authRequired, (req, res) => controller.addMember(req, res))
router.delete("/:id/members/:userId", authRequired, (req, res) => controller.removeMember(req, res))

router.get("/:id/servicos", authRequired, (req, res) => controller.listServicos(req, res))
router.post("/:id/servicos", authRequired, (req, res) => controller.createServico(req, res))
router.put("/:id/servicos/:codigo", authRequired, (req, res) => controller.updateServico(req, res))
router.delete("/:id/servicos/:codigo", authRequired, (req, res) => controller.deleteServico(req, res))

router.get("/:id/pagamentos", authRequired, (req, res) => controller.listPagamentos(req, res))
router.post("/:id/pagamentos", authRequired, (req, res) => controller.createPagamento(req, res))
router.put("/:id/pagamentos/:codigo", authRequired, (req, res) => controller.updatePagamento(req, res))
router.delete("/:id/pagamentos/:codigo", authRequired, (req, res) => controller.deletePagamento(req, res))

export default router
