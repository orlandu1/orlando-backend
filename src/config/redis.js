/**
 * Configuração do cliente Redis
 * 
 * O Redis é usado para rate limiting e bloqueio progressivo de tentativas
 * de login. Usamos um serviço Redis gerenciado (Upstash ou Render Redis).
 * 
 * Variáveis de ambiente necessárias:
 * - REDIS_URL: URL de conexão do Redis
 *   - Upstash: rediss://default:senha@endpoint.upstash.io:6379 (TLS)
 *   - Render: redis://red-xxxx:6379 (internal URL)
 * 
 * IMPORTANTE: 
 * - URLs com "rediss://" (dois 's') usam TLS automaticamente
 * - O Redis gerenciado já vem protegido, não fica exposto publicamente
 * - Em desenvolvimento local, instale Redis ou use Upstash gratuito
 */

import { createClient } from "redis"

/**
 * Verifica se a URL do Redis está configurada
 */
const REDIS_URL = process.env.REDIS_URL

/**
 * Flag para habilitar/desabilitar rate limiting
 * Se Redis não estiver configurado, rate limiting é desabilitado graciosamente
 */
export const isRateLimitEnabled = Boolean(REDIS_URL)

// Configurações do Redis adaptadas para serviços gerenciados (Upstash/Render)
const REDIS_CONFIG = REDIS_URL ? {
	url: REDIS_URL,
	socket: {
		// Reconexão automática com backoff exponencial
		reconnectStrategy: (retries) => {
			if (retries > 10) {
				console.error("[Redis] Máximo de tentativas de reconexão atingido")
				return new Error("Máximo de tentativas de reconexão atingido")
			}
			// Backoff exponencial: 100ms, 200ms, 400ms, ...
			return Math.min(retries * 100, 3000)
		},
		// Timeout de conexão (maior para serviços cloud)
		connectTimeout: 15000,
	},
} : null

// Cliente Redis singleton
let redisClient = null
let isConnecting = false
let isConnected = false

/**
 * Obtém ou cria a instância do cliente Redis
 * Implementa padrão singleton para evitar múltiplas conexões
 * 
 * @returns {Promise<import('redis').RedisClientType | null>} Cliente Redis ou null se não configurado
 */
export async function getRedisClient() {
	// Se Redis não está configurado, retorna null (rate limiting desabilitado)
	if (!REDIS_CONFIG) {
		return null
	}

	// Se já está conectado, retorna o cliente
	if (redisClient && isConnected) {
		return redisClient
	}

	// Evita múltiplas tentativas de conexão simultâneas
	if (isConnecting) {
		// Aguarda a conexão existente
		await new Promise((resolve) => setTimeout(resolve, 100))
		return getRedisClient()
	}

	isConnecting = true

	try {
		redisClient = createClient(REDIS_CONFIG)

		// Handlers de eventos
		redisClient.on("error", (err) => {
			console.error("[Redis] Erro de conexão:", err.message)
			isConnected = false
		})

		redisClient.on("connect", () => {
			console.log("[Redis] Conectando...")
		})

		redisClient.on("ready", () => {
			console.log("[Redis] Conexão estabelecida e pronta")
			isConnected = true
		})

		redisClient.on("end", () => {
			console.log("[Redis] Conexão encerrada")
			isConnected = false
		})

		redisClient.on("reconnecting", () => {
			console.log("[Redis] Reconectando...")
		})

		// Conecta ao Redis
		await redisClient.connect()
		isConnected = true

		return redisClient
	} catch (err) {
		console.error("[Redis] Falha ao conectar:", err.message)
		isConnecting = false
		// Retorna null em vez de throw para fail-open
		return null
	} finally {
		isConnecting = false
	}
}

/**
 * Encerra a conexão com o Redis graciosamente
 * Use ao encerrar a aplicação
 */
export async function closeRedisConnection() {
	if (redisClient) {
		try {
			await redisClient.quit()
			console.log("[Redis] Conexão encerrada graciosamente")
		} catch (err) {
			console.error("[Redis] Erro ao encerrar conexão:", err.message)
		} finally {
			redisClient = null
			isConnected = false
		}
	}
}

/**
 * Verifica se o Redis está conectado e saudável
 */
export async function isRedisHealthy() {
	try {
		if (!redisClient || !isConnected) {
			return false
		}
		const pong = await redisClient.ping()
		return pong === "PONG"
	} catch {
		return false
	}
}

export default {
	getRedisClient,
	closeRedisConnection,
	isRedisHealthy,
}
