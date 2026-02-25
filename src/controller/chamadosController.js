import { sql } from "../db/db.js"
import {
	auditAndNotify,
	extractAuditMeta,
	getActorInfo,
} from "../services/auditService.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getUserId = (req) => String(req?.auth?.sub || "").trim()

const getRole = (req) => {
	const r = Number(req?.auth?.role)
	if (Number.isNaN(r)) return 0
	if (r === 0) return 3
	return r
}

const isOperatorRole = (role) => role >= 2

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class ChamadosController {
	/**
	 * GET /chamados
	 * Clientes veem apenas os próprios; operadores/admins veem todos.
	 */
	async list(req, res) {
		try {
			const userId = getUserId(req)
			const role = getRole(req)

			let rows
			if (isOperatorRole(role)) {
				rows = await sql`
					SELECT
						c.id,
						c.codigo,
						c.titulo,
						c.descricao,
						c.prioridade,
						c.status,
						c.created_at  AS "criadoEm",
						c.updated_at  AS "atualizadoEm",
						u.name        AS "nomeUsuario",
						u.email       AS "emailUsuario"
					FROM chamados c
					JOIN users u ON u.id = c.user_id
					ORDER BY c.created_at DESC
				`
			} else {
				rows = await sql`
					SELECT
						c.id,
						c.codigo,
						c.titulo,
						c.descricao,
						c.prioridade,
						c.status,
						c.created_at AS "criadoEm",
						c.updated_at AS "atualizadoEm"
					FROM chamados c
					WHERE c.user_id = ${userId}
					ORDER BY c.created_at DESC
				`
			}

			return res.json({ ok: true, chamados: rows })
		} catch (err) {
			console.error("[ChamadosController.list]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao listar chamados." })
		}
	}

	/**
	 * GET /chamados/:id
	 * Retorna o chamado + histórico. Clientes só acessam os próprios.
	 */
	async get(req, res) {
		try {
			const userId = getUserId(req)
			const role = getRole(req)
			const chamadoId = String(req.params.id || "").trim()

			if (!chamadoId) {
				return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "ID inválido." })
			}

			const rows = await sql`
				SELECT
					c.id,
					c.codigo,
					c.user_id     AS "userId",
					c.titulo,
					c.descricao,
					c.prioridade,
					c.status,
					c.created_at  AS "criadoEm",
					c.updated_at  AS "atualizadoEm",
					u.name        AS "nomeUsuario",
					u.email       AS "emailUsuario"
				FROM chamados c
				JOIN users u ON u.id = c.user_id
				WHERE c.id = ${chamadoId}
				LIMIT 1
			`
			const chamado = rows?.[0]
			if (!chamado) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Chamado não encontrado." })
			}

			// Clientes só veem seus próprios chamados
			if (!isOperatorRole(role) && chamado.userId !== userId) {
				return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
			}

			// Buscar histórico
			const historico = await sql`
				SELECT
					h.id,
					h.status,
					h.comentario,
					h.created_at  AS "em",
					u.name        AS "autor"
				FROM chamado_historico h
				JOIN users u ON u.id = h.author_user_id
				WHERE h.chamado_id = ${chamadoId}
				ORDER BY h.created_at DESC
			`

			return res.json({ ok: true, chamado: { ...chamado, historico } })
		} catch (err) {
			console.error("[ChamadosController.get]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao buscar chamado." })
		}
	}

	/**
	 * POST /chamados
	 * Qualquer usuário autenticado pode abrir um chamado.
	 */
	async create(req, res) {
		try {
			const userId = getUserId(req)
			if (!userId) {
				return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Token inválido." })
			}

			const titulo = String(req.body?.titulo || "").trim()
			const descricao = String(req.body?.descricao || "").trim()
			const prioridade = String(req.body?.prioridade || "Média").trim()

			if (titulo.length < 3) {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Título deve ter pelo menos 3 caracteres." })
			}
			if (descricao.length < 10) {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Descrição deve ter pelo menos 10 caracteres." })
			}
			if (!["Baixa", "Média", "Alta"].includes(prioridade)) {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Prioridade inválida." })
			}

			// Gera código sequencial
			const seqRows = await sql`SELECT nextval('chamados_codigo_seq') AS seq`
			const seq = Number(seqRows?.[0]?.seq || 1)
			const codigo = `CH-${String(seq).padStart(3, "0")}`

			const inserted = await sql`
				INSERT INTO chamados (user_id, codigo, titulo, descricao, prioridade)
				VALUES (${userId}, ${codigo}, ${titulo}, ${descricao}, ${prioridade})
				RETURNING
					id,
					codigo,
					titulo,
					descricao,
					prioridade,
					status,
					created_at AS "criadoEm",
					updated_at AS "atualizadoEm"
			`

			const chamado = inserted?.[0]

			// Audit
			try {
				const actorInfo = await getActorInfo(userId)
				const meta = extractAuditMeta(req)
				await auditAndNotify({
					action: "chamado.created",
					entityType: "chamado",
					entityId: chamado?.id,
					actor: {
						userId,
						name: actorInfo?.name,
						email: actorInfo?.email,
						role: getRole(req),
					},
					ip: meta.ip,
					userAgent: meta.userAgent,
					emailDetails: [
						{ label: "Código", value: codigo, bold: true },
						{ label: "Título", value: titulo },
						{ label: "Prioridade", value: prioridade },
					],
				})
			} catch { /* non-blocking */ }

			return res.status(201).json({ ok: true, chamado })
		} catch (err) {
			console.error("[ChamadosController.create]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao criar chamado." })
		}
	}

	/**
	 * PUT /chamados/:id/status
	 * Operadores/admins podem alterar o status e adicionar comentário.
	 * Clientes podem cancelar seus próprios chamados.
	 */
	async updateStatus(req, res) {
		try {
			const userId = getUserId(req)
			const role = getRole(req)
			const chamadoId = String(req.params.id || "").trim()

			const novoStatus = String(req.body?.status || "").trim()
			const comentario = String(req.body?.comentario || "").trim()

			if (!chamadoId) {
				return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "ID inválido." })
			}
			if (!["Recebido", "Em análise", "Resolvido", "Cancelado"].includes(novoStatus)) {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Status inválido." })
			}
			if (comentario.length < 3) {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Comentário deve ter pelo menos 3 caracteres." })
			}

			// Buscar chamado atual
			const existing = await sql`
				SELECT id, user_id AS "userId", status, codigo
				FROM chamados
				WHERE id = ${chamadoId}
				LIMIT 1
			`
			const chamado = existing?.[0]
			if (!chamado) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Chamado não encontrado." })
			}

			// Permissões: operadores/admins podem tudo; clientes só cancelam os próprios
			if (!isOperatorRole(role)) {
				if (chamado.userId !== userId) {
					return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
				}
				if (novoStatus !== "Cancelado") {
					return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Clientes podem apenas cancelar chamados." })
				}
			}

			// Atualizar status
			await sql`
				UPDATE chamados
				SET status = ${novoStatus}, updated_at = now()
				WHERE id = ${chamadoId}
			`

			// Inserir histórico
			await sql`
				INSERT INTO chamado_historico (chamado_id, author_user_id, status, comentario)
				VALUES (${chamadoId}, ${userId}, ${novoStatus}, ${comentario})
			`

			// Audit
			try {
				const actorInfo = await getActorInfo(userId)
				const meta = extractAuditMeta(req)
				await auditAndNotify({
					action: "chamado.status_changed",
					entityType: "chamado",
					entityId: chamadoId,
					actor: {
						userId,
						name: actorInfo?.name,
						email: actorInfo?.email,
						role: getRole(req),
					},
					ip: meta.ip,
					userAgent: meta.userAgent,
					emailDetails: [
						{ label: "Código", value: chamado.codigo, bold: true },
						{ label: "Status anterior", value: chamado.status },
						{ label: "Novo status", value: novoStatus, bold: true },
						{ label: "Comentário", value: comentario },
					],
				})
			} catch { /* non-blocking */ }

			return res.json({ ok: true, status: novoStatus })
		} catch (err) {
			console.error("[ChamadosController.updateStatus]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao atualizar status." })
		}
	}
}
