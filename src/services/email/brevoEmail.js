import nodemailer from "nodemailer"

let cachedTransporter = null
let warnedMisconfig = false

const truthy = (v) => {
	const s = String(v ?? "").trim().toLowerCase()
	return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on"
}

const isDebugEnabled = () => truthy(process.env.EMAIL_DEBUG)

const logDebug = (...args) => {
	if (!isDebugEnabled()) return
	console.log("[email:debug]", ...args)
}

const isEmailEnabled = () => {
	const raw = process.env.EMAIL_ENABLED
	if (raw === undefined) return true
	return truthy(raw)
}

const getConfig = () => {
	const host = String(process.env.BREVO_SMTP_HOST || "").trim()
	const port = Number(process.env.BREVO_SMTP_PORT || 587)
	const user = String(process.env.BREVO_SMTP_USER || "").trim()
	const pass = String(process.env.BREVO_SMTP_PASS || "").trim()
	const fromEmail = String(process.env.EMAIL_FROM || "").trim()
	const fromName = String(process.env.EMAIL_FROM_NAME || "").trim()

	return { host, port, user, pass, fromEmail, fromName }
}

const getTransporter = () => {
	if (!isEmailEnabled()) return null
	if (cachedTransporter) return cachedTransporter

	const { host, port, user, pass, fromEmail } = getConfig()
	logDebug("config", {
		host: host || null,
		port: Number.isFinite(port) ? port : null,
		user: user ? `${user.slice(0, 2)}***${user.slice(-2)}` : null,
		fromEmail: fromEmail || null,
	})
	const missing = []
	if (!host) missing.push("BREVO_SMTP_HOST")
	if (!port) missing.push("BREVO_SMTP_PORT")
	if (!user) missing.push("BREVO_SMTP_USER")
	if (!pass) missing.push("BREVO_SMTP_PASS")
	if (!fromEmail) missing.push("EMAIL_FROM")
	if (missing.length > 0) {
		if (!warnedMisconfig) {
			warnedMisconfig = true
			console.warn(
				`[email] Email desabilitado: variáveis ausentes (${missing.join(", ")}).`,
			)
		}
		logDebug("skip", { reason: "MISSING_ENV", missing })
		return null
	}

	cachedTransporter = nodemailer.createTransport({
		host,
		port,
		secure: false,
		requireTLS: true,
		auth: { user, pass },
	})

	logDebug("transporter_created")

	return cachedTransporter
}

const buildFrom = () => {
	const { fromEmail, fromName } = getConfig()
	return fromName ? `${fromName} <${fromEmail}>` : fromEmail
}

export const sendEmail = async ({ to, subject, text, html }) => {
	const transporter = getTransporter()
	if (!isEmailEnabled()) {
		logDebug("skip", { reason: "EMAIL_DISABLED" })
		return { ok: false, skipped: true, reason: "EMAIL_DISABLED" }
	}
	if (!transporter) {
		logDebug("skip", { reason: "NO_TRANSPORTER" })
		return { ok: false, skipped: true, reason: "NO_TRANSPORTER" }
	}

	logDebug("send_attempt", {
		to: String(to || ""),
		subject: String(subject || ""),
		hasHtml: Boolean(html),
		hasText: Boolean(text),
	})

	try {
		const info = await transporter.sendMail({
			from: buildFrom(),
			to,
			subject,
			text,
			html,
		})
		logDebug("send_success", {
			messageId: info?.messageId || null,
			accepted: info?.accepted || null,
			rejected: info?.rejected || null,
			response: info?.response || null,
		})
		return { ok: true, info }
	} catch (err) {
		console.error("[email] Falha ao enviar email", {
			message: err?.message || String(err),
			code: err?.code,
			response: err?.response,
			responseCode: err?.responseCode,
			command: err?.command,
		})
		logDebug("send_failure_raw", err)
		return { ok: false, error: err, message: err?.message }
	}
}

export const sendOrcamentoAprovadoEmail = async ({ toEmail, toName, codigo, servico, custo, projetoNome, isAdmin = false }) => {
	const subject = isAdmin
		? `Orçamento aprovado pelo cliente - Projeto: ${projetoNome || codigo}`
		: `Orçamento aprovado: ${codigo}`
	const nome = String(toName || "").trim()
	const greeting = nome ? `Olá, ${nome}!` : "Olá!"
	const custoFmt = custo === undefined || custo === null ? "Não informado" : `R$ ${Number(custo).toFixed(2).replace(".", ",")}`
	const dataAtual = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
	const horaAtual = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

	const introText = isAdmin
		? "O cliente aprovou o orçamento do serviço"
		: "Recebemos a aprovação do orçamento do serviço"

	const text = `${greeting}\n\n${introText}\n\nCódigo: ${codigo}\nServiço: ${servico || "(não informado)"}\nValor: ${custoFmt}${projetoNome ? `\nProjeto: ${projetoNome}` : ""}\nData: ${dataAtual} ${horaAtual}\n\nEm caso de dúvidas, responda este email.`
	
	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
		<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
			<table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5; padding: 40px 20px;">
				<tr>
					<td align="center">
						<table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
							<!-- Header -->
							<tr>
								<td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
									<h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">✓ Orçamento Aprovado</h1>
									<p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px; opacity: 0.95;">Comprovante de Aprovação</p>
								</td>
							</tr>
							
							<!-- Saudação -->
							<tr>
								<td style="padding: 30px 30px 20px 30px;">
									<p style="margin: 0; color: #374151; font-size: 16px;">${greeting}</p>
									<p style="margin: 12px 0 0 0; color: #6b7280; font-size: 15px; line-height: 1.5;">${introText}</p>
								</td>
							</tr>
							
							<!-- Card de informações -->
							<tr>
								<td style="padding: 0 30px 30px 30px;">
									<table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb;">
										<tr>
											<td style="padding: 20px;">
												<!-- Código -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Código:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">${codigo}</p>
														</td>
													</tr>
												</table>
												
												${projetoNome ? `
												<!-- Projeto -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Projeto:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">${projetoNome}</p>
														</td>
													</tr>
												</table>
												` : ""}
												
												<!-- Serviço -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px; vertical-align: top;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Serviço:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #111827; font-size: 15px; line-height: 1.5;">${servico || "(não informado)"}</p>
														</td>
													</tr>
												</table>
												
												<!-- Valor -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; padding-top: 16px; border-top: 1px solid #e5e7eb;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Valor:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #10b981; font-size: 20px; font-weight: 700;">${custoFmt}</p>
														</td>
													</tr>
												</table>
											</td>
										</tr>
									</table>
								</td>
							</tr>
							
							<!-- Data e hora -->
							<tr>
								<td style="padding: 0 30px 30px 30px;">
									<table role="presentation" style="width: 100%; border-collapse: collapse;">
										<tr>
											<td style="padding: 0; text-align: center;">
												<p style="margin: 0; color: #9ca3af; font-size: 13px;">
													📅 ${dataAtual} às ${horaAtual}
												</p>
											</td>
										</tr>
									</table>
								</td>
							</tr>
							
							<!-- Footer -->
							<tr>
								<td style="padding: 20px 30px; background-color: #f9fafb; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
									<p style="margin: 0; color: #6b7280; font-size: 13px; text-align: center; line-height: 1.6;">
										Em caso de dúvidas, responda este email.<br>
										<span style="color: #9ca3af;">Este é um comprovante automático de aprovação de orçamento.</span>
									</p>
								</td>
							</tr>
						</table>
					</td>
				</tr>
			</table>
		</body>
		</html>
	`

	return sendEmail({
		to: nome ? `${nome} <${toEmail}>` : toEmail,
		subject,
		text,
		html,
	})
}

export const sendServicoProntoEmail = async ({ toEmail, toName, codigo, servico, projetoNome, isAdmin = false }) => {
	const subject = isAdmin
		? `Serviço concluído - Projeto: ${projetoNome || codigo}`
		: `Serviço pronto: ${codigo}`
	const nome = String(toName || "").trim()
	const greeting = nome ? `Olá, ${nome}!` : "Olá!"
	const dataAtual = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
	const horaAtual = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

	const introText = isAdmin
		? "Um serviço foi marcado como pronto"
		: "Seu serviço foi marcado como pronto"

	const text = `${greeting}\n\n${introText}\n\nCódigo: ${codigo}\nServiço: ${servico || "(não informado)"}${projetoNome ? `\nProjeto: ${projetoNome}` : ""}\nData: ${dataAtual} ${horaAtual}\n\nEm caso de dúvidas, responda este email.`

	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
		<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
			<table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5; padding: 40px 20px;">
				<tr>
					<td align="center">
						<table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
							<!-- Header -->
							<tr>
								<td style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
									<h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">🎉 Serviço Concluído</h1>
									<p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px; opacity: 0.95;">Comprovante de Conclusão</p>
								</td>
							</tr>
							
							<!-- Saudação -->
							<tr>
								<td style="padding: 30px 30px 20px 30px;">
									<p style="margin: 0; color: #374151; font-size: 16px;">${greeting}</p>
									<p style="margin: 12px 0 0 0; color: #6b7280; font-size: 15px; line-height: 1.5;">${introText}</p>
								</td>
							</tr>
							
							<!-- Card de informações -->
							<tr>
								<td style="padding: 0 30px 30px 30px;">
									<table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb;">
										<tr>
											<td style="padding: 20px;">
												<!-- Código -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Código:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">${codigo}</p>
														</td>
													</tr>
												</table>
												
												${projetoNome ? `
												<!-- Projeto -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Projeto:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">${projetoNome}</p>
														</td>
													</tr>
												</table>
												` : ""}
												
												<!-- Serviço -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px; vertical-align: top;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Serviço:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #111827; font-size: 15px; line-height: 1.5;">${servico || "(não informado)"}</p>
														</td>
													</tr>
												</table>
												
												<!-- Status -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; padding-top: 16px; border-top: 1px solid #e5e7eb;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Status:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #3b82f6; font-size: 16px; font-weight: 700;">✓ Concluído</p>
														</td>
													</tr>
												</table>
											</td>
										</tr>
									</table>
								</td>
							</tr>
							
							<!-- Data e hora -->
							<tr>
								<td style="padding: 0 30px 30px 30px;">
									<table role="presentation" style="width: 100%; border-collapse: collapse;">
										<tr>
											<td style="padding: 0; text-align: center;">
												<p style="margin: 0; color: #9ca3af; font-size: 13px;">
													📅 ${dataAtual} às ${horaAtual}
												</p>
											</td>
										</tr>
									</table>
								</td>
							</tr>
							
							<!-- Footer -->
							<tr>
								<td style="padding: 20px 30px; background-color: #f9fafb; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
									<p style="margin: 0; color: #6b7280; font-size: 13px; text-align: center; line-height: 1.6;">
										Em caso de dúvidas, responda este email.<br>
										<span style="color: #9ca3af;">Este é um comprovante automático de conclusão de serviço.</span>
									</p>
								</td>
							</tr>
						</table>
					</td>
				</tr>
			</table>
		</body>
		</html>
	`

	return sendEmail({
		to: nome ? `${nome} <${toEmail}>` : toEmail,
		subject,
		text,
		html,
	})
}

export const sendNovoServicoEmail = async ({ toEmail, toName, codigo, servico, custo, projetoNome, isAdmin = false }) => {
	const subject = isAdmin 
		? `Novo serviço cadastrado no projeto: ${projetoNome}` 
		: `Novo serviço cadastrado no seu projeto: ${projetoNome}`
	const nome = String(toName || "").trim()
	const greeting = nome ? `Olá, ${nome}!` : "Olá!"
	const custoFmt = custo === undefined || custo === null ? "Não informado" : `R$ ${Number(custo).toFixed(2).replace(".", ",")}`
	const dataAtual = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
	const horaAtual = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

	const introText = isAdmin 
		? "Um novo serviço foi cadastrado no sistema"
		: "Um novo serviço foi cadastrado no seu projeto"

	const text = `${greeting}\n\n${introText}\n\nProjeto: ${projetoNome}\nCódigo: ${codigo}\nServiço: ${servico || "(não informado)"}\nValor: ${custoFmt}\nData: ${dataAtual} ${horaAtual}\n\nAguardando aprovação do cliente.\n\nEm caso de dúvidas, responda este email.`
	
	const html = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
		<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
			<table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5; padding: 40px 20px;">
				<tr>
					<td align="center">
						<table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
							<!-- Header -->
							<tr>
								<td style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
									<h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">📋 Novo Serviço</h1>
									<p style="margin: 8px 0 0 0; color: #ffffff; font-size: 14px; opacity: 0.95;">Orçamento Cadastrado</p>
								</td>
							</tr>
							
							<!-- Saudação -->
							<tr>
								<td style="padding: 30px 30px 20px 30px;">
									<p style="margin: 0; color: #374151; font-size: 16px;">${greeting}</p>
									<p style="margin: 12px 0 0 0; color: #6b7280; font-size: 15px; line-height: 1.5;">${introText}</p>
								</td>
							</tr>
							
							<!-- Card de informações -->
							<tr>
								<td style="padding: 0 30px 30px 30px;">
									<table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb;">
										<tr>
											<td style="padding: 20px;">
												<!-- Projeto -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Projeto:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">${projetoNome}</p>
														</td>
													</tr>
												</table>
												
												<!-- Código -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Código:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #111827; font-size: 15px; font-weight: 600;">${codigo}</p>
														</td>
													</tr>
												</table>
												
												<!-- Serviço -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px; vertical-align: top;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Serviço:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #111827; font-size: 15px; line-height: 1.5;">${servico || "(não informado)"}</p>
														</td>
													</tr>
												</table>
												
												<!-- Valor -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; padding-top: 16px; border-top: 1px solid #e5e7eb; margin-bottom: 16px;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Valor:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #f59e0b; font-size: 20px; font-weight: 700;">${custoFmt}</p>
														</td>
													</tr>
												</table>
												
												<!-- Status -->
												<table role="presentation" style="width: 100%; border-collapse: collapse; padding-top: 16px; border-top: 1px solid #e5e7eb;">
													<tr>
														<td style="padding: 0; width: 120px;">
															<p style="margin: 0; color: #6b7280; font-size: 13px; font-weight: 500;">Status:</p>
														</td>
														<td style="padding: 0;">
															<p style="margin: 0; color: #f59e0b; font-size: 16px; font-weight: 700;">⏳ Aguardando aprovação</p>
														</td>
													</tr>
												</table>
											</td>
										</tr>
									</table>
								</td>
							</tr>
							
							<!-- Data e hora -->
							<tr>
								<td style="padding: 0 30px 30px 30px;">
									<table role="presentation" style="width: 100%; border-collapse: collapse;">
										<tr>
											<td style="padding: 0; text-align: center;">
												<p style="margin: 0; color: #9ca3af; font-size: 13px;">
													📅 ${dataAtual} às ${horaAtual}
												</p>
											</td>
										</tr>
									</table>
								</td>
							</tr>
							
							<!-- Footer -->
							<tr>
								<td style="padding: 20px 30px; background-color: #f9fafb; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
									<p style="margin: 0; color: #6b7280; font-size: 13px; text-align: center; line-height: 1.6;">
										Em caso de dúvidas, responda este email.<br>
										<span style="color: #9ca3af;">Este é um comprovante automático de cadastro de serviço.</span>
									</p>
								</td>
							</tr>
						</table>
					</td>
				</tr>
			</table>
		</body>
		</html>
	`

	return sendEmail({
		to: nome ? `${nome} <${toEmail}>` : toEmail,
		subject,
		text,
		html,
	})
}
