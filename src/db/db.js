import dotenv from "dotenv"

import { neon } from "@neondatabase/serverless"

dotenv.config()

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
	throw new Error("DATABASE_URL não definido no .env")
}

export const sql = neon(databaseUrl)
