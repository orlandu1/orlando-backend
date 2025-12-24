-- Cria projetos default para usuários existentes + liga registros existentes

INSERT INTO projetos (owner_user_id, nome, is_default)
SELECT
	u.id,
	COALESCE(NULLIF(u.name, ''), u.username),
	TRUE
FROM users u
WHERE NOT EXISTS (
	SELECT 1
	FROM projetos p
	WHERE p.owner_user_id = u.id AND p.is_default = TRUE
);

UPDATE orcamento_servicos s
SET project_id = p.id
FROM projetos p
WHERE s.project_id IS NULL
	AND p.owner_user_id = s.user_id
	AND p.is_default = TRUE;

UPDATE orcamento_pagamentos pg
SET project_id = p.id
FROM projetos p
WHERE pg.project_id IS NULL
	AND p.owner_user_id = pg.user_id
	AND p.is_default = TRUE;

DO $$
BEGIN
	BEGIN
		ALTER TABLE orcamento_servicos
			ALTER COLUMN project_id SET NOT NULL;
	EXCEPTION
		WHEN undefined_column THEN
			NULL;
	END;

	BEGIN
		ALTER TABLE orcamento_pagamentos
			ALTER COLUMN project_id SET NOT NULL;
	EXCEPTION
		WHEN undefined_column THEN
			NULL;
	END;
END $$;
