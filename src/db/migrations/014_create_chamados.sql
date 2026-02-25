-- Tabelas para suportar a tela de Chamados (suporte)

CREATE SEQUENCE IF NOT EXISTS chamados_codigo_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS chamados (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	codigo text NOT NULL UNIQUE,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	titulo text NOT NULL,
	descricao text NOT NULL,
	prioridade text NOT NULL DEFAULT 'Média'
		CHECK (prioridade IN ('Baixa', 'Média', 'Alta')),
	status text NOT NULL DEFAULT 'Recebido'
		CHECK (status IN ('Recebido', 'Em análise', 'Resolvido', 'Cancelado')),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chamado_historico (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	chamado_id uuid NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
	author_user_id uuid NOT NULL REFERENCES users(id),
	status text NOT NULL,
	comentario text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chamados_user_id ON chamados(user_id);
CREATE INDEX IF NOT EXISTS idx_chamados_status ON chamados(status);
CREATE INDEX IF NOT EXISTS idx_chamado_historico_chamado_id ON chamado_historico(chamado_id);
