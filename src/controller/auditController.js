import { sql } from "../db/db.js"

const getUserId = (req) => String(req?.auth?.sub || "").trim()

const getRole = (req) => {
	const r = Number(req?.auth?.role)
	if (Number.isNaN(r)) return 0
	if (r === 0) return 3
	return r
}

const isAdminRole = (role) => role >= 3

export class AuditController {
	async list(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		if (!isAdminRole(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}

		const page = Math.max(1, Number(req.query?.page) || 1)
		const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50))
		const offset = (page - 1) * limit
		const projectId = req.query?.projectId ? String(req.query.projectId).trim() : null
		const action = req.query?.action ? String(req.query.action).trim() : null
		const entityId = req.query?.entityId ? String(req.query.entityId).trim() : null

		try {
			const rows = await sql`
				SELECT
					id,
					transaction_id AS "transactionId",
					action,
					entity_type AS "entityType",
					entity_id AS "entityId",
					project_id AS "projectId",
					actor_user_id AS "actorUserId",
					actor_name AS "actorName",
					actor_email AS "actorEmail",
					actor_role AS "actorRole",
					target_user_id AS "targetUserId",
					target_name AS "targetName",
					target_email AS "targetEmail",
					ip_address AS "ipAddress",
					ip_location AS "ipLocation",
					user_agent AS "userAgent",
					old_value AS "oldValue",
					new_value AS "newValue",
					metadata,
					email_sent AS "emailSent",
					email_error AS "emailError",
					created_at AS "createdAt"
				FROM audit_log
				WHERE
					(${projectId}::text IS NULL OR project_id = ${projectId})
					AND (${action}::text IS NULL OR action = ${action})
					AND (${entityId}::text IS NULL OR entity_id = ${entityId})
				ORDER BY created_at DESC
				LIMIT ${limit}
				OFFSET ${offset}
			`

			const countRows = await sql`
				SELECT COUNT(*)::int AS total
				FROM audit_log
				WHERE
					(${projectId}::text IS NULL OR project_id = ${projectId})
					AND (${action}::text IS NULL OR action = ${action})
					AND (${entityId}::text IS NULL OR entity_id = ${entityId})
			`

			const total = Number(countRows?.[0]?.total || 0)
			return res.json({ ok: true, logs: rows, total, page, limit })
		} catch (err) {
			console.error("[audit:list]", err)
			return res.status(500).json({ ok: false, error: "DB_ERROR", message: "Erro ao consultar o banco." })
		}
	}

	async getByTransaction(req, res) {
		const userId = getUserId(req)
		const role = getRole(req)
		if (!userId) {
			return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido ou expirado." })
		}
		if (!isAdminRole(role)) {
			return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
		}

		const transactionId = String(req.params.transactionId || "").trim()
		if (!transactionId) {
			return res.status(400).json({ ok: false, error: "VALIDATION_ERROR", message: "ID de transação inválido." })
		}

		try {
			const rows = await sql`
				SELECT
					id,
					transaction_id AS "transactionId",
					action,
					entity_type AS "entityType",
					entity_id AS "entityId",
					project_id AS "projectId",
					actor_user_id AS "actorUserId",
					actor_name AS "actorName",
					actor_email AS "actorEmail",
					actor_role AS "actorRole",
					target_user_id AS "targetUserId",
					target_name AS "targetName",
					target_email AS "targetEmail",
					ip_address AS "ipAddress",
					ip_location AS "ipLocation",
					user_agent AS "userAgent",
					old_value AS "oldValue",
					new_value AS "newValue",
					metadata,
					email_sent AS "emailSent",
					email_error AS "emailError",
					created_at AS "createdAt"
				FROM audit_log
				WHERE transaction_id = ${transactionId}::uuid
				ORDER BY created_at DESC
			`

			return res.json({ ok: true, logs: rows })
		} catch (err) {
			console.error("[audit:getByTransaction]", err)
			return res.status(500).json({ ok: false, error: "DB_ERROR", message: "Erro ao consultar o banco." })
		}
	}
}
