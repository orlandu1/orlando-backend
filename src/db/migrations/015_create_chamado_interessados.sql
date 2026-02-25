-- Tabela para vincular interessados a um chamado.
-- Interessados recebem notificações de atualizações do chamado.

CREATE TABLE IF NOT EXISTS chamado_interessados (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	chamado_id uuid NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (chamado_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chamado_interessados_chamado_id ON chamado_interessados(chamado_id);
CREATE INDEX IF NOT EXISTS idx_chamado_interessados_user_id ON chamado_interessados(user_id);
