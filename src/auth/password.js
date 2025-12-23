import bcrypt from "bcryptjs"

const DEFAULT_COST = 10

export const hashPassword = async (password) => {
	const passwordStr = (password ?? "").toString()
	if (!passwordStr) throw new Error("PASSWORD_REQUIRED")
	return bcrypt.hash(passwordStr, DEFAULT_COST)
}

export const verifyPassword = async (password, passwordHash) => {
	const passwordStr = (password ?? "").toString()
	const hashStr = (passwordHash ?? "").toString()
	if (!passwordStr || !hashStr) return false
	return bcrypt.compare(passwordStr, hashStr)
}
