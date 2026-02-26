import { sql } from "../db/db.js"
import { put, del } from "@vercel/blob"
import crypto from "node:crypto"
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

const safeFilename = (raw) => {
	const s = String(raw || "").trim()
	return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "arquivo"
}

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
						u.email       AS "emailUsuario",
						lm.comentario AS "ultimaMovimentacao",
						lm.created_at AS "ultimaMovimentacaoEm",
						lm_autor.name AS "ultimaMovimentacaoAutor"
					FROM chamados c
					JOIN users u ON u.id = c.user_id
					LEFT JOIN LATERAL (
						SELECT h.comentario, h.created_at, h.author_user_id
						FROM chamado_historico h
						WHERE h.chamado_id = c.id
						ORDER BY h.created_at DESC
						LIMIT 1
					) lm ON true
					LEFT JOIN users lm_autor ON lm_autor.id = lm.author_user_id
					ORDER BY c.created_at DESC
				`
			} else {
				// Clientes veem seus próprios chamados + chamados em que são interessados
				rows = await sql`
					SELECT DISTINCT ON (c.id)
						c.id,
						c.codigo,
						c.titulo,
						c.descricao,
						c.prioridade,
						c.status,
						c.created_at AS "criadoEm",
						c.updated_at AS "atualizadoEm",
						lm.comentario AS "ultimaMovimentacao",
						lm.created_at AS "ultimaMovimentacaoEm",
						lm_autor.name AS "ultimaMovimentacaoAutor"
					FROM chamados c
					LEFT JOIN chamado_interessados ci ON ci.chamado_id = c.id AND ci.user_id = ${userId}
					LEFT JOIN LATERAL (
						SELECT h.comentario, h.created_at, h.author_user_id
						FROM chamado_historico h
						WHERE h.chamado_id = c.id
						ORDER BY h.created_at DESC
						LIMIT 1
					) lm ON true
					LEFT JOIN users lm_autor ON lm_autor.id = lm.author_user_id
					WHERE c.user_id = ${userId} OR ci.user_id IS NOT NULL
					ORDER BY c.id, c.created_at DESC
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
					c.responsavel_user_id AS "responsavelUserId",
					c.created_at  AS "criadoEm",
					c.updated_at  AS "atualizadoEm",
					u.name        AS "nomeUsuario",
					u.email       AS "emailUsuario",
					resp.name     AS "responsavelNome"
				FROM chamados c
				JOIN users u ON u.id = c.user_id
				LEFT JOIN users resp ON resp.id = c.responsavel_user_id
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

			// Buscar anexos agrupados por histórico
			const anexos = await sql`
				SELECT
					a.id,
					a.historico_id AS "historicoId",
					a.nome,
					a.tipo,
					a.tamanho,
					a.url,
					a.created_at AS "criadoEm"
				FROM chamado_anexos a
				WHERE a.chamado_id = ${chamadoId}
				ORDER BY a.created_at ASC
			`

			// Vincular anexos ao histórico
			const historicoComAnexos = historico.map((h) => ({
				...h,
				anexos: anexos.filter((a) => a.historicoId === h.id),
			}))

			// Anexos órfãos (sem histórico, e.g. da descrição original)
			const anexosGerais = anexos.filter((a) => !a.historicoId)

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

			// Marcar como lido
			try {
				await sql`
					INSERT INTO chamado_last_read (chamado_id, user_id, read_at)
					VALUES (${chamadoId}, ${userId}, now())
					ON CONFLICT (chamado_id, user_id)
					DO UPDATE SET read_at = now()
				`
			} catch { /* non-blocking */ }

			return res.json({ ok: true, chamado: { ...chamado, historico: historicoComAnexos, interessados, anexos: anexosGerais } })
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

	/**
	 * POST /chamados/:id/anexo
	 * Upload de arquivo anexo ao chamado (Vercel Blob Storage).
	 * Qualquer participante pode anexar enquanto o chamado estiver aberto.
	 */
	async uploadAnexo(req, res) {
		try {
			const userId = getUserId(req)
			const role = getRole(req)
			const chamadoId = String(req.params.id || "").trim()
			const historicoId = String(req.body?.historicoId || "").trim() || null

			if (!chamadoId) {
				return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "ID inválido." })
			}
			if (!process.env.BLOB_READ_WRITE_TOKEN) {
				return res.status(500).json({ ok: false, error: "SERVER_MISCONFIG", message: "Blob Storage não configurado." })
			}

			const file = req.file
			if (!file || !file.buffer || !file.originalname) {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Envie um arquivo no campo 'file'." })
			}

			// Buscar chamado
			const existing = await sql`
				SELECT c.id, c.user_id AS "userId", c.status, c.codigo
				FROM chamados c WHERE c.id = ${chamadoId} LIMIT 1
			`
			const chamado = existing?.[0]
			if (!chamado) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Chamado não encontrado." })
			}

			if (chamado.status === "Resolvido" || chamado.status === "Cancelado") {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Não é possível anexar em chamados encerrados." })
			}

			// Permissão
			if (!isOperatorRole(role) && chamado.userId !== userId) {
				const isInt = await sql`SELECT 1 FROM chamado_interessados WHERE chamado_id = ${chamadoId} AND user_id = ${userId} LIMIT 1`
				if (!isInt || isInt.length === 0) {
					return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
				}
			}

			const original = safeFilename(file.originalname)
			const blobId = crypto.randomUUID()
			const pathname = `chamados/${chamado.codigo}/${blobId}-${original}`
			const contentType = String(file.mimetype || "application/octet-stream")

			const result = await put(pathname, file.buffer, {
				access: "public",
				contentType,
				token: process.env.BLOB_READ_WRITE_TOKEN,
			})

			const inserted = await sql`
				INSERT INTO chamado_anexos (chamado_id, historico_id, uploader_user_id, nome, tipo, tamanho, url, pathname)
				VALUES (${chamadoId}, ${historicoId}, ${userId}, ${file.originalname}, ${contentType}, ${Number(file.size) || 0}, ${result.url}, ${result.pathname})
				RETURNING id, nome, tipo, tamanho, url, created_at AS "criadoEm"
			`

			// Atualizar updated_at do chamado
			await sql`UPDATE chamados SET updated_at = now() WHERE id = ${chamadoId}`

			return res.status(201).json({ ok: true, anexo: inserted?.[0] })
		} catch (err) {
			console.error("[ChamadosController.uploadAnexo]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao enviar anexo." })
		}
	}

	/**
	 * POST /chamados/:id/interessados
	 * Adicionar interessado (operadores/admins).
	 */
	async addInteressado(req, res) {
		try {
			const role = getRole(req)
			if (!isOperatorRole(role)) {
				return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
			}

			const chamadoId = String(req.params.id || "").trim()
			const targetUserId = String(req.body?.userId || "").trim()

			if (!chamadoId || !targetUserId) {
				return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "Dados inválidos." })
			}

			// Verificar se chamado existe
			const existing = await sql`
				SELECT c.id, c.codigo, c.titulo FROM chamados c WHERE c.id = ${chamadoId} LIMIT 1
			`
			if (!existing?.[0]) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Chamado não encontrado." })
			}

			await sql`
				INSERT INTO chamado_interessados (chamado_id, user_id)
				VALUES (${chamadoId}, ${targetUserId})
				ON CONFLICT (chamado_id, user_id) DO NOTHING
			`

			// Notificar o novo interessado
			try {
				const { sendEmail } = await import("../services/email/brevoEmail.js")
				const intInfo = await getActorInfo(targetUserId)
				if (intInfo?.email) {
					const chamado = existing[0]
					const greeting = intInfo.name ? `Olá, ${intInfo.name}!` : "Olá!"
					await sendEmail({
						to: intInfo.name ? `${intInfo.name} <${intInfo.email}>` : intInfo.email,
						subject: `[Chamado ${chamado.codigo}] Você foi adicionado como interessado`,
						text: `${greeting}\n\nVocê foi adicionado(a) como interessado(a) no chamado ${chamado.codigo} — ${chamado.titulo}.`,
						html: `<p>${greeting}</p><p>Você foi adicionado(a) como interessado(a) no chamado <strong>${chamado.codigo}</strong> — ${chamado.titulo}.</p>`,
					})
				}
			} catch { /* non-blocking */ }

			return res.json({ ok: true })
		} catch (err) {
			console.error("[ChamadosController.addInteressado]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao adicionar interessado." })
		}
	}

	/**
	 * DELETE /chamados/:id/interessados/:userId
	 * Remover interessado (operadores/admins).
	 */
	async removeInteressado(req, res) {
		try {
			const role = getRole(req)
			if (!isOperatorRole(role)) {
				return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
			}

			const chamadoId = String(req.params.id || "").trim()
			const targetUserId = String(req.params.userId || "").trim()

			if (!chamadoId || !targetUserId) {
				return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "Dados inválidos." })
			}

			await sql`
				DELETE FROM chamado_interessados
				WHERE chamado_id = ${chamadoId} AND user_id = ${targetUserId}
			`

			return res.json({ ok: true })
		} catch (err) {
			console.error("[ChamadosController.removeInteressado]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao remover interessado." })
		}
	}

	/**
	 * PUT /chamados/:id/responsavel
	 * Designar operador responsável (operadores/admins).
	 */
	async assignResponsavel(req, res) {
		try {
			const role = getRole(req)
			if (!isOperatorRole(role)) {
				return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Sem permissão." })
			}

			const chamadoId = String(req.params.id || "").trim()
			const responsavelUserId = req.body?.userId ? String(req.body.userId).trim() : null

			if (!chamadoId) {
				return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "ID inválido." })
			}

			await sql`
				UPDATE chamados
				SET responsavel_user_id = ${responsavelUserId}, updated_at = now()
				WHERE id = ${chamadoId}
			`

			return res.json({ ok: true })
		} catch (err) {
			console.error("[ChamadosController.assignResponsavel]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao designar responsável." })
		}
	}

	/**
	 * PUT /chamados/:id/reopen
	 * Reabrir chamado resolvido/cancelado (operadores/admins).
	 */
	async reopen(req, res) {
		try {
			const userId = getUserId(req)
			const role = getRole(req)
			if (!isOperatorRole(role)) {
				return res.status(403).json({ ok: false, error: "FORBIDDEN", message: "Apenas operadores/admins podem reabrir chamados." })
			}

			const chamadoId = String(req.params.id || "").trim()
			const comentario = String(req.body?.comentario || "Chamado reaberto.").trim()

			if (!chamadoId) {
				return res.status(400).json({ ok: false, error: "BAD_REQUEST", message: "ID inválido." })
			}

			const existing = await sql`
				SELECT c.id, c.status, c.codigo, c.titulo,
				       c.user_id AS "userId", u.name AS "ownerName", u.email AS "ownerEmail"
				FROM chamados c
				JOIN users u ON u.id = c.user_id
				WHERE c.id = ${chamadoId} LIMIT 1
			`
			const chamado = existing?.[0]
			if (!chamado) {
				return res.status(404).json({ ok: false, error: "NOT_FOUND", message: "Chamado não encontrado." })
			}
			if (chamado.status !== "Resolvido" && chamado.status !== "Cancelado") {
				return res.status(400).json({ ok: false, error: "VALIDATION", message: "Somente chamados encerrados podem ser reabertos." })
			}

			const novoStatus = "Recebido"
			await sql`
				UPDATE chamados SET status = ${novoStatus}, updated_at = now() WHERE id = ${chamadoId}
			`
			await sql`
				INSERT INTO chamado_historico (chamado_id, author_user_id, status, comentario)
				VALUES (${chamadoId}, ${userId}, ${novoStatus}, ${comentario})
			`

			// Notificar
			try {
				const actorInfo = await getActorInfo(userId)
				const meta = extractAuditMeta(req)
				await auditAndNotify({
					action: "chamado.reopened",
					entityType: "chamado",
					entityId: chamadoId,
					actor: { userId, name: actorInfo?.name, email: actorInfo?.email, role },
					target: { userId: chamado.userId, name: chamado.ownerName, email: chamado.ownerEmail },
					ip: meta.ip,
					userAgent: meta.userAgent,
					emailSubject: `[Chamado ${chamado.codigo}] Reaberto`,
					emailDetails: [
						{ label: "Código", value: chamado.codigo, bold: true },
						{ label: "Título", value: chamado.titulo },
						{ label: "Status anterior", value: chamado.status },
						{ label: "Novo status", value: novoStatus, bold: true },
						{ label: "Comentário", value: comentario },
					],
				})
			} catch { /* non-blocking */ }

			return res.json({ ok: true, status: novoStatus })
		} catch (err) {
			console.error("[ChamadosController.reopen]", err)
			return res.status(500).json({ ok: false, error: "INTERNAL", message: "Erro ao reabrir chamado." })
		}
	}
}
