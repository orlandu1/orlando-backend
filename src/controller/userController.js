import { sql } from "../db/db.js"
import { hashPassword } from "../auth/password.js"

const getRole = (req) => {
	const r = Number(req?.auth?.role)
	if (Number.isNaN(r)) return 0
	// compat: role antigo 0 => admin
	if (r === 0) return 3
	return r
}

export class UserController {
	async list(req, res) {
		const role = getRole(req)
		if (role < 2) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}

		try {
			const rows = await sql`
				SELECT id, username, email, name, role, created_at
				FROM users
				ORDER BY created_at DESC
			`

			return res.json({ ok: true, users: rows })
		} catch (err) {
			return res.status(500).json({
				ok: false,
				error: "DB_ERROR",
				message: "Erro ao consultar o banco.",
			})
		}
	}

	async create(req, res) {
		const role = getRole(req)
		if (role < 3) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}

		const { username, email, name, role: bodyRole, password } = req.body || {}
		const emailStr = (email || "").toString().trim()
		const nameStr = (name || "").toString().trim()
		const usernameStr = (username || "").toString().trim()
		const roleNum = Number(bodyRole)
		const passwordStr = (password || "").toString()

		if (!emailStr || !passwordStr) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Informe e-mail e senha.",
			})
		}

		if (passwordStr.length < 6) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Senha deve ter no mínimo 6 caracteres.",
			})
		}

		const derivedUsername = emailStr.includes("@") ? emailStr.split("@")[0] : emailStr
		const finalUsername = (usernameStr || derivedUsername).slice(0, 64)
		const finalRole = Number.isFinite(roleNum) ? roleNum : 1

		try {
			const passwordHash = await hashPassword(passwordStr)
			const rows = await sql`
				INSERT INTO users (username, email, role, name, password_hash)
				VALUES (
					${finalUsername},
					${emailStr},
					${finalRole},
					${nameStr || null},
					${passwordHash}
				)
				RETURNING id, username, email, name, role, created_at
			`

			return res.status(201).json({ ok: true, user: rows[0] })
		} catch (err) {
			return res.status(400).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível criar o usuário.",
			})
		}
	}

	async update(req, res) {
		const role = getRole(req)
		if (role < 3) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}

		const { id } = req.params
		const { username, email, name, role: bodyRole, password } = req.body || {}
		const usernameStr = username === undefined ? undefined : (username || "").toString().trim()
		const emailStr = email === undefined ? undefined : (email || "").toString().trim()
		const nameStr = name === undefined ? undefined : (name || "").toString().trim()
		const roleNum = bodyRole === undefined ? undefined : Number(bodyRole)
		const passwordStr = password === undefined ? undefined : (password || "").toString()

		if (!id) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "ID inválido.",
			})
		}

		if (passwordStr !== undefined && passwordStr.length > 0 && passwordStr.length < 6) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "Senha deve ter no mínimo 6 caracteres.",
			})
		}

		try {
			const passwordHash =
				passwordStr !== undefined && passwordStr.length > 0
					? await hashPassword(passwordStr)
					: null

			const rows = await sql`
				UPDATE users
				SET
					username = COALESCE(${usernameStr ?? null}, username),
					email = COALESCE(${emailStr ?? null}, email),
					name = COALESCE(${nameStr ?? null}, name),
					role = COALESCE(${Number.isFinite(roleNum) ? roleNum : null}, role),
					password_hash = COALESCE(${passwordHash}, password_hash),
					updated_at = now()
				WHERE id = ${id}
				RETURNING id, username, email, name, role, created_at
			`

			if (!rows || rows.length === 0) {
				return res.status(404).json({
					ok: false,
					error: "NOT_FOUND",
					message: "Usuário não encontrado.",
				})
			}

			return res.json({ ok: true, user: rows[0] })
		} catch (err) {
			return res.status(400).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível atualizar o usuário.",
			})
		}
	}

	async remove(req, res) {
		const role = getRole(req)
		if (role < 3) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}

		const { id } = req.params
		if (!id) {
			return res.status(400).json({
				ok: false,
				error: "VALIDATION_ERROR",
				message: "ID inválido.",
			})
		}

		try {
			const rows = await sql`
				DELETE FROM users
				WHERE id = ${id}
				RETURNING id
			`

			if (!rows || rows.length === 0) {
				return res.status(404).json({
					ok: false,
					error: "NOT_FOUND",
					message: "Usuário não encontrado.",
				})
			}

			return res.json({ ok: true })
		} catch (err) {
			return res.status(500).json({
				ok: false,
				error: "DB_ERROR",
				message: "Não foi possível excluir o usuário.",
			})
		}
	}
}
