import { sql } from "../db/db.js"
import {
	auditAndNotify,
	extractAuditMeta,
	getActorInfo,
	getAdminEmails,
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
	 * GET /chamados/users
	 * Lista usuários disponíveis para selecionar como interessados.
	 * Somente operadores/admins.
	 */
	async listUsers(req, res) {
		try {
			const role = getRole(req)
			if (!isOperatorRole(role)) {
				return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
			}

			const rows = await sql`
				SELECT id, COALESCE(NULLIF(name, ''), username) AS name, email, role
				FROM users
				ORDER BY name ASC
			`

			return res.json({ ok: true, users: rows })
		} catch (err) {
			console.error("[ChamadosController.listUsers]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao listar usuários." })
		}
	}

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
				// Clientes veem seus próprios chamados + chamados em que são interessados
				rows = await sql`
					SELECT DISTINCT
						c.id,
						c.codigo,
						c.titulo,
						c.descricao,
						c.prioridade,
						c.status,
						c.created_at AS "criadoEm",
						c.updated_at AS "atualizadoEm"
					FROM chamados c
					LEFT JOIN chamado_interessados ci ON ci.chamado_id = c.id AND ci.user_id = ${userId}
					WHERE c.user_id = ${userId} OR ci.user_id IS NOT NULL
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

			// Clientes só veem seus próprios chamados ou chamados em que são interessados
			if (!isOperatorRole(role) && chamado.userId !== userId) {
				const isInteressado = await sql`
					SELECT 1 FROM chamado_interessados
					WHERE chamado_id = ${chamadoId} AND user_id = ${userId}
					LIMIT 1
				`
				if (!isInteressado || isInteressado.length === 0) {
					return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
				}
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

			// Buscar interessados
			const interessados = await sql`
				SELECT
					ci.user_id AS "userId",
					COALESCE(NULLIF(u.name, ''), u.username) AS name,
					u.email
				FROM chamado_interessados ci
				JOIN users u ON u.id = ci.user_id
				WHERE ci.chamado_id = ${chamadoId}
				ORDER BY u.name ASC
			`

			return res.json({ ok: true, chamado: { ...chamado, historico, interessados } })
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

			// Interessados (apenas operadores/admins podem definir)
			const role = getRole(req)
			let interessadosIds = []
			if (isOperatorRole(role) && Array.isArray(req.body?.interessados)) {
				interessadosIds = req.body.interessados
					.map((id) => String(id || "").trim())
					.filter(Boolean)
			}

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

			// Inserir interessados
			if (chamado?.id && interessadosIds.length > 0) {
				for (const intId of interessadosIds) {
					try {
						await sql`
							INSERT INTO chamado_interessados (chamado_id, user_id)
							VALUES (${chamado.id}, ${intId})
							ON CONFLICT (chamado_id, user_id) DO NOTHING
						`
					} catch { /* ignora duplicatas ou IDs inválidos */ }
				}
			}

			// Audit + Email (para o cliente e admins)
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
					target: {
						userId,
						name: actorInfo?.name,
						email: actorInfo?.email,
					},
					ip: meta.ip,
					userAgent: meta.userAgent,
					emailSubject: `[Novo Chamado] ${codigo} — ${titulo}`,
					emailDetails: [
						{ label: "Código", value: codigo, bold: true },
						{ label: "Título", value: titulo },
						{ label: "Prioridade", value: prioridade },
						{ label: "Descrição", value: descricao },
					],
				})
			} catch { /* non-blocking */ }

			// Notificar interessados sobre a criação do chamado
			if (chamado?.id && interessadosIds.length > 0) {
				try {
					const { sendEmail } = await import("../services/email/brevoEmail.js")
					const actorInfo = await getActorInfo(userId)
					const adminEmails = (await getAdminEmails()).map((a) => a.email)
					for (const intId of interessadosIds) {
						try {
							const intInfo = await getActorInfo(intId)
							if (!intInfo?.email) continue
							// Não duplicar para o criador ou admins (já notificados)
							if (intInfo.email === actorInfo?.email) continue
							if (adminEmails.includes(intInfo.email)) continue

							const greeting = intInfo.name ? `Olá, ${intInfo.name}!` : "Olá!"
							const introText = `Você foi adicionado(a) como interessado(a) no chamado ${codigo}.`
							await sendEmail({
								to: intInfo.name ? `${intInfo.name} <${intInfo.email}>` : intInfo.email,
								subject: `[Novo Chamado] ${codigo} — ${titulo}`,
								text: `${greeting}\n\n${introText}\n\nCódigo: ${codigo}\nTítulo: ${titulo}\nPrioridade: ${prioridade}\nDescrição: ${descricao}`,
								html: `<p>${greeting}</p><p>${introText}</p><p><strong>Código:</strong> ${codigo}<br><strong>Título:</strong> ${titulo}<br><strong>Prioridade:</strong> ${prioridade}<br><strong>Descrição:</strong> ${descricao}</p>`,
							})
						} catch { /* ignore individual email failures */ }
					}
				} catch { /* non-blocking */ }
			}

			return res.status(201).json({ ok: true, chamado })
		} catch (err) {
			console.error("[ChamadosController.create]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao criar chamado." })
		}
	}

	/**
	 * POST /chamados/:id/comentario
	 * Qualquer participante (dono, interessado, operador/admin) pode adicionar
	 * um comentário/mensagem ao chamado sem alterar o status.
	 */
	async addComment(req, res) {
		try {
			const userId = getUserId(req)
			const role = getRole(req)
			const chamadoId = String(req.params.id || "").trim()
			const comentario = String(req.body?.comentario || "").trim()

			if (!chamadoId) {
				return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "ID inválido." })
			}
			if (comentario.length < 3) {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Comentário deve ter pelo menos 3 caracteres." })
			}

			// Buscar chamado
			const existing = await sql`
				SELECT c.id, c.user_id AS "userId", c.status, c.codigo, c.titulo,
				       u.name AS "ownerName", u.email AS "ownerEmail"
				FROM chamados c
				JOIN users u ON u.id = c.user_id
				WHERE c.id = ${chamadoId}
				LIMIT 1
			`
			const chamado = existing?.[0]
			if (!chamado) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Chamado não encontrado." })
			}

			// Não permitir comentários em chamados encerrados
			if (chamado.status === "Resolvido" || chamado.status === "Cancelado") {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Não é possível comentar em chamados encerrados." })
			}

			// Permissão: operadores/admins podem sempre; clientes apenas no próprio ou se interessado
			if (!isOperatorRole(role)) {
				if (chamado.userId !== userId) {
					const isInteressado = await sql`
						SELECT 1 FROM chamado_interessados
						WHERE chamado_id = ${chamadoId} AND user_id = ${userId}
						LIMIT 1
					`
					if (!isInteressado || isInteressado.length === 0) {
						return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
					}
				}
			}

			// Inserir comentário no histórico (status = NULL indica comentário avulso)
			await sql`
				INSERT INTO chamado_historico (chamado_id, author_user_id, status, comentario)
				VALUES (${chamadoId}, ${userId}, NULL, ${comentario})
			`

			// Atualizar updated_at
			await sql`
				UPDATE chamados SET updated_at = now() WHERE id = ${chamadoId}
			`

			// Notificar dono do chamado + admins + interessados
			try {
				const actorInfo = await getActorInfo(userId)
				const meta = extractAuditMeta(req)
				const autorNome = actorInfo?.name || "Alguém"

				await auditAndNotify({
					action: "chamado.comment_added",
					entityType: "chamado",
					entityId: chamadoId,
					actor: {
						userId,
						name: actorInfo?.name,
						email: actorInfo?.email,
						role: getRole(req),
					},
					target: {
						userId: chamado.userId,
						name: chamado.ownerName,
						email: chamado.ownerEmail,
					},
					ip: meta.ip,
					userAgent: meta.userAgent,
					emailSubject: `[Chamado ${chamado.codigo}] Nova mensagem de ${autorNome}`,
					emailDetails: [
						{ label: "Código", value: chamado.codigo, bold: true },
						{ label: "Título", value: chamado.titulo },
						{ label: "Autor", value: autorNome },
						{ label: "Mensagem", value: comentario },
					],
				})

				// Notificar interessados
				try {
					const interessados = await sql`
						SELECT ci.user_id AS "userId", u.name, u.email
						FROM chamado_interessados ci
						JOIN users u ON u.id = ci.user_id
						WHERE ci.chamado_id = ${chamadoId}
					`
					if (interessados.length > 0) {
						const { sendEmail } = await import("../services/email/brevoEmail.js")
						const adminEmails = (await getAdminEmails()).map((a) => a.email)
						for (const int of interessados) {
							if (int.email === chamado.ownerEmail) continue
							if (int.userId === userId) continue
							if (adminEmails.includes(int.email)) continue
							if (!int.email) continue

							try {
								const greeting = int.name ? `Olá, ${int.name}!` : "Olá!"
								const introText = `Nova mensagem no chamado ${chamado.codigo} por ${autorNome}.`
								await sendEmail({
									to: int.name ? `${int.name} <${int.email}>` : int.email,
									subject: `[Chamado ${chamado.codigo}] Nova mensagem de ${autorNome}`,
									text: `${greeting}\n\n${introText}\n\nMensagem: ${comentario}`,
									html: `<p>${greeting}</p><p>${introText}</p><p><strong>Mensagem:</strong> ${comentario}</p>`,
								})
							} catch { /* ignore */ }
						}
					}
				} catch { /* non-blocking */ }
			} catch { /* non-blocking */ }

			return res.json({ ok: true })
		} catch (err) {
			console.error("[ChamadosController.addComment]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao adicionar comentário." })
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
				SELECT c.id, c.user_id AS "userId", c.status, c.codigo, c.titulo,
				       u.name AS "ownerName", u.email AS "ownerEmail"
				FROM chamados c
				JOIN users u ON u.id = c.user_id
				WHERE c.id = ${chamadoId}
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

			// Audit + Email (para o dono do chamado, admins e interessados)
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
					target: {
						userId: chamado.userId,
						name: chamado.ownerName,
						email: chamado.ownerEmail,
					},
					ip: meta.ip,
					userAgent: meta.userAgent,
					emailSubject: `[Chamado ${chamado.codigo}] Status: ${novoStatus}`,
					emailDetails: [
						{ label: "Código", value: chamado.codigo, bold: true },
						{ label: "Título", value: chamado.titulo },
						{ label: "Status anterior", value: chamado.status },
						{ label: "Novo status", value: novoStatus, bold: true, color: novoStatus === "Resolvido" ? "#059669" : novoStatus === "Cancelado" ? "#dc2626" : undefined },
						{ label: "Comentário", value: comentario },
					],
				})

				// Notificar interessados (além do dono e admins)
				try {
					const interessados = await sql`
						SELECT ci.user_id AS "userId", u.name, u.email
						FROM chamado_interessados ci
						JOIN users u ON u.id = ci.user_id
						WHERE ci.chamado_id = ${chamadoId}
					`
					if (interessados.length > 0) {
						const { sendEmail } = await import("../services/email/brevoEmail.js")
						const adminEmails = (await getAdminEmails()).map((a) => a.email)
						for (const int of interessados) {
							// Não duplicar para o dono ou admins (já notificados)
							if (int.email === chamado.ownerEmail) continue
							if (adminEmails.includes(int.email)) continue
							if (!int.email) continue

							try {
								const greeting = int.name ? `Olá, ${int.name}!` : "Olá!"
								const introText = `Você é um interessado no chamado ${chamado.codigo} e houve uma atualização de status.`
								await sendEmail({
									to: int.name ? `${int.name} <${int.email}>` : int.email,
									subject: `[Chamado ${chamado.codigo}] Status: ${novoStatus}`,
									text: `${greeting}\n\n${introText}\n\nCódigo: ${chamado.codigo}\nTítulo: ${chamado.titulo}\nStatus anterior: ${chamado.status}\nNovo status: ${novoStatus}\nComentário: ${comentario}`,
									html: `<p>${greeting}</p><p>${introText}</p><p><strong>Código:</strong> ${chamado.codigo}<br><strong>Título:</strong> ${chamado.titulo}<br><strong>Status anterior:</strong> ${chamado.status}<br><strong>Novo status:</strong> <strong>${novoStatus}</strong><br><strong>Comentário:</strong> ${comentario}</p>`,
								})
							} catch { /* ignore individual email failures */ }
						}
					}
				} catch { /* non-blocking */ }
			} catch { /* non-blocking */ }

			return res.json({ ok: true, status: novoStatus })
		} catch (err) {
			console.error("[ChamadosController.updateStatus]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao atualizar status." })
		}
	}
}
