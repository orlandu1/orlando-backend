import { sql } from "../db/db.js"
import { signAccessToken } from "../auth/jwt.js"
import { verifyPassword } from "../auth/password.js"
import { hashPassword } from "../auth/password.js"
import { recordLoginFailure, recordLoginSuccess } from "../middleware/rateLimiter.js"

export class AuthController {
	async login(req, res) {
		const { username, email, password, remember } = req.body || {}
		const identifierRaw = (email || username || "").toString().trim()

		if (!identifierRaw || !password) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Informe usuário (ou e-mail) e senha.",
			})
		}

		try {
			const looksLikeEmail = identifierRaw.includes("@")
			const rows = looksLikeEmail
				? await sql`
					SELECT id, username, email, name, role, password_hash
					FROM users
					WHERE email = ${identifierRaw}
					LIMIT 1
				`
				: await sql`
					SELECT id, username, email, name, role, password_hash
					FROM users
					WHERE username = ${identifierRaw}
					LIMIT 1
				`

			if (!rows || rows.length === 0) {
				// Registra tentativa falha no rate limiter
				await recordLoginFailure(req)
				return res.status(401).json({
					ok: false,
					error: "INVALID_CREDENTIALS",
					message: "Credenciais inválidas.",
				})
			}

			const user = rows[0]
			const okPassword = await verifyPassword(password, user.password_hash)
			if (!okPassword) {
				// Registra tentativa falha no rate limiter
				await recordLoginFailure(req)
				return res.status(401).json({
					ok: false,
					error: "INVALID_CREDENTIALS",
					message: "Credenciais inválidas.",
				})
			}

			// Login bem-sucedido: reseta contador de tentativas
			await recordLoginSuccess(req)

			const token = signAccessToken(
				{
					sub: String(user.id),
					username: user.username,
					email: user.email,
					name: user.name,
					role: user.role,
				},
				{ expiresIn: remember ? "7d" : "1d" },
			)

			return res.json({
				ok: true,
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					name: user.name,
					role: user.role,
				},
				token,
			})
		} catch (err) {
			return res.status(500).json({
				ok: false,
				error: "DB_ERROR",
				message: "Erro ao consultar o banco.",
			})
		}
	}

	async changePassword(req, res) {
		const userId = String(req?.auth?.sub || "").trim()
		const { currentPassword, newPassword } = req.body || {}
		const currentPasswordStr = (currentPassword || "").toString()
		const newPasswordStr = (newPassword || "").toString()

		if (!userId) {
			return res.status(401).json({
				ok: false,
				error: "UNAUTHORIZED",
				message: "Token inválido ou expirado.",
			})
		}

		if (!currentPasswordStr || !newPasswordStr) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Informe a senha atual e a nova senha.",
			})
		}

		if (newPasswordStr.length < 6) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Nova senha deve ter no mínimo 6 caracteres.",
			})
		}

		try {
			const rows = await sql`
				SELECT id, password_hash
				FROM users
				WHERE id = ${userId}
				LIMIT 1
			`

			if (!rows || rows.length === 0) {
				return res.status(404).json({
					ok: false,
					error: "NOT_FOUND",
					message: "Usuário não encontrado.",
				})
			}

			const user = rows[0]
			const okPassword = await verifyPassword(currentPasswordStr, user.password_hash)
			if (!okPassword) {
				return res.status(401).json({
					ok: false,
					error: "INVALID_CREDENTIALS",
					message: "Senha atual inválida.",
				})
			}

			const passwordHash = await hashPassword(newPasswordStr)
			await sql`
				UPDATE users
				SET password_hash = ${passwordHash}, updated_at = now()
				WHERE id = ${userId}
			`

			return res.json({ ok: true })
		} catch {
			return res.status(500).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível atualizar a senha.",
			})
		}
	}
}

