-- Tabela de projetos + vínculo de usuários autorizados

CREATE TABLE IF NOT EXISTS projetos (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	nome text NOT NULL,
	is_default boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projetos_owner_user_id_idx ON projetos(owner_user_id);
CREATE INDEX IF NOT EXISTS projetos_created_at_idx ON projetos(created_at DESC);

-- Um único projeto default por usuário
DO $$
BEGIN
	BEGIN
		CREATE UNIQUE INDEX projetos_owner_default_uk
			ON projetos(owner_user_id)
			WHERE is_default;
	EXCEPTION
		WHEN duplicate_object THEN
			NULL;
	END;
END $$;

-- Usuários autorizados a acompanhar um projeto (escala para novos perfis)
CREATE TABLE IF NOT EXISTS projeto_usuarios (
	projeto_id uuid NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role text NOT NULL DEFAULT 'viewer',
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (projeto_id, user_id)
);

CREATE INDEX IF NOT EXISTS projeto_usuarios_user_id_idx ON projeto_usuarios(user_id);
