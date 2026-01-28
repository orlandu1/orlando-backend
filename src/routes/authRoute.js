
import { Router } from "express"

import { AuthController } from "../controller/authController.js"
import { authRequired } from "../middleware/authRequired.js"
import { rateLimitMiddleware } from "../middleware/rateLimiter.js"

const router = Router()
const controller = new AuthController()

/**
 * POST /auth/login
 * 
 * Endpoint de autenticação protegido por rate limiting.
 * Após 5 tentativas inválidas, o cliente é bloqueado temporariamente.
 * 
 * O bloqueio é progressivo:
 * - 1º bloqueio: 1 minuto
 * - 2º bloqueio: 5 minutos
 * - 3º bloqueio: 15 minutos
 * - 4º bloqueio: 1 hora
 * - 5º+ bloqueio: 24 horas
 * 
 * IMPORTANTE: A resposta é sempre genérica ("Credenciais inválidas")
 * para não revelar se o usuário existe ou se está bloqueado.
 */
router.post("/login", rateLimitMiddleware("login"), (req, res) => controller.login(req, res))

router.post("/change-password", authRequired, (req, res) => controller.changePassword(req, res))

router.get("/me", authRequired, (req, res) => {
	return res.json({ ok: true, auth: req.auth })
})

export default router

