import { sql } from "../db/db.js"

const getRole = (req) => {
	const r = Number(req?.auth?.role)
	if (Number.isNaN(r)) return 0
	// compat: role antigo 0 => admin
	if (r === 0) return 3
	return r
}

export class SettingsController {
	// GET /settings/apk-url (público - não requer auth)
	async getApkUrl(req, res) {
		try {
			const rows = await sql`
				SELECT value FROM app_settings WHERE key = 'apk_download_url'
			`
			const url = rows[0]?.value || ""
			return res.json({ ok: true, url })
		} catch (err) {
			console.error("Erro ao buscar APK URL:", err)
			return res.status(500).json({
				ok: false,
				error: "DB_ERROR",
				message: "Erro ao buscar configuração.",
			})
		}
	}

	// GET /settings (requer admin)
	async list(req, res) {
		const role = getRole(req)
		if (role < 3) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}

		try {
			const rows = await sql`
				SELECT key, value, description, updated_at
				FROM app_settings
				ORDER BY key
			`
			return res.json({ ok: true, settings: rows })
		} catch (err) {
			console.error("Erro ao listar settings:", err)
			return res.status(500).json({
				ok: false,
				error: "DB_ERROR",
				message: "Erro ao consultar configurações.",
			})
		}
	}

	// PUT /settings/:key (requer admin)
	async update(req, res) {
		const role = getRole(req)
		if (role < 3) {
			return res.status(403).json({
				ok: false,
				error: "FORBIDDEN",
				message: "Sem permissão.",
			})
		}

		const { key } = req.params
		const { value } = req.body || {}

		if (typeof value !== "string") {
			return res.status(400).json({
				ok: false,
				error: "INVALID_VALUE",
				message: "O campo 'value' é obrigatório.",
			})
		}

		try {
			const userId = req.auth?.sub || null
			const rows = await sql`
				UPDATE app_settings
				SET value = ${value}, updated_at = now(), updated_by = ${userId}
				WHERE key = ${key}
				RETURNING key, value, description, updated_at
			`

			if (rows.length === 0) {
				return res.status(404).json({
					ok: false,
					error: "NOT_FOUND",
					message: "Configuração não encontrada.",
				})
			}

			return res.json({ ok: true, setting: rows[0] })
		} catch (err) {
			console.error("Erro ao atualizar setting:", err)
			return res.status(500).json({
				ok: false,
				error: "DB_ERROR",
				message: "Erro ao atualizar configuração.",
			})
		}
	}
}
