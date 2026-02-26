-- Melhorias no sistema de chamados:
-- 1. Tabela de anexos (arquivos no Vercel Blob Storage)
-- 2. Coluna de responsável (operador designado)
-- 3. Coluna last_read para rastrear não-lidos

-- Anexos vinculados ao histórico do chamado
CREATE TABLE IF NOT EXISTS chamado_anexos (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	chamado_id uuid NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
	historico_id uuid REFERENCES chamado_historico(id) ON DELETE SET NULL,
	uploader_user_id uuid NOT NULL REFERENCES users(id),
	nome text NOT NULL,
	tipo text NOT NULL DEFAULT 'application/octet-stream',
	tamanho integer NOT NULL DEFAULT 0,
	url text NOT NULL,
	pathname text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chamado_anexos_chamado_id ON chamado_anexos(chamado_id);
CREATE INDEX IF NOT EXISTS idx_chamado_anexos_historico_id ON chamado_anexos(historico_id);

-- Responsável pelo chamado (operador designado)
ALTER TABLE chamados ADD COLUMN IF NOT EXISTS responsavel_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Rastrear última leitura de cada usuário em cada chamado (para indicador de não-lido)
CREATE TABLE IF NOT EXISTS chamado_last_read (
	chamado_id uuid NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	read_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chamado_id, user_id)
);
